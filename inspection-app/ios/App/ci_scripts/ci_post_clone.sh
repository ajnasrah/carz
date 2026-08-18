#!/bin/sh
# Xcode Cloud post-clone: build everything the checkout deliberately doesn't carry.
#
# WHY THIS IS NEEDED AT ALL
# ios/.gitignore excludes three things the Xcode build cannot start without:
#
#   App/Pods                     -> Pods-App.release.xcconfig, the exact file the
#                                   failing build reported it could not open
#   App/App/public               -> the entire web bundle the app runs
#   App/App/capacitor.config.json + config.xml
#
# All three are generated, and generating them is what `cap sync` does. That is
# correct for the repo — Pods is 100MB of vendored source and public/ is a build
# output — but it means a fresh clone is not buildable until this runs. Locally
# nobody notices, because `npm run build:native` is the documented step before
# opening Xcode (see ios-config/README.md).
#
# ORDER MATTERS: vite build produces dist/, cap sync copies dist/ into
# App/App/public AND runs pod install. Running pod install first would install
# pods for a project with no web assets, and the archive would ship an empty app.
#
# REQUIRED Xcode Cloud environment variables (set these in App Store Connect ->
# your workflow -> Environment; they cannot live in the repo):
#
#   VITE_SUPABASE_URL
#   VITE_SUPABASE_ANON_KEY
#
# They are inlined into the bundle at build time by Vite. Without them the app
# compiles and installs fine and then fails every request with "Invalid API key",
# which looks like a dead backend rather than a missing build variable — so fail
# loudly here instead.

set -e

echo "--- post-clone: $(pwd)"

if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$VITE_SUPABASE_ANON_KEY" ]; then
  echo "ERROR: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set in this workflow."
  echo "       Add them in App Store Connect -> Xcode Cloud -> Workflow -> Environment."
  echo "       Building without them produces an app that cannot reach Supabase."
  exit 1
fi

# Xcode Cloud images carry neither node nor CocoaPods.
echo "--- installing node + cocoapods"
brew install node cocoapods

# Derived from where this script lives, not from the working directory Xcode
# Cloud happens to invoke it in, and not from CI_PRIMARY_REPOSITORY_PATH either —
# both have bitten people. ci_scripts -> App -> ios -> inspection-app.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
APP_DIR=$(cd "$SCRIPT_DIR/../../.." && pwd)
cd "$APP_DIR"
echo "--- building in $APP_DIR"

npm ci

# Same command the runbook uses locally: native-variant vite build (strips the
# 181MB training PDFs, see vite.config.js) then cap sync, which copies dist into
# ios/App/App/public, writes capacitor.config.json + config.xml, and pod installs.
npm run build:native

# The plugin count is the tell that CocoaPods resolved everything: it must be 11.
# Ten means SPM ate @capacitor-community/speech-recognition, which builds fine and
# silently removes voice entry on the lot walk. See ios-config/README.md.
if [ ! -f "ios/App/Pods/Target Support Files/Pods-App/Pods-App.release.xcconfig" ]; then
  echo "ERROR: pod install did not produce Pods-App.release.xcconfig — the archive would fail."
  exit 1
fi
if [ ! -f "ios/App/App/public/index.html" ]; then
  echo "ERROR: no web bundle at ios/App/App/public — cap sync did not copy dist."
  exit 1
fi

echo "--- post-clone finished: pods and web bundle are in place"
