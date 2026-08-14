# Hand-edited native config — reference copies

## Shipping a change (the runbook)

There are **two** places the app lives, and they update by different routes.

`capacitor.config.json` sets no `server.url`, so the native app does **not**
load carzinc.ai — `cap sync` copies `dist/` into `ios/App/App/public` and the
app runs that copy. The consequence is the thing people get wrong: **a Vercel
deploy does not reach the installed iPhone app.** Even a one-line web change
needs a new TestFlight build to get there.

### 1. Web — carzinc.ai, and the home-screen PWA

```sh
cd inspection-app
npx vercel --prod --archive=tgz          # --archive=tgz or the upload dies on EPIPE
```

Live immediately; browsers and the home-screen PWA pick it up on next load.
Anything server-side (`api/`, `vercel.json`) only exists after this.

### 2. iPhone app — TestFlight

**Bump the build number first.** App Store Connect rejects an upload whose build
number it has already seen, and it doesn't tell you kindly. `MARKETING_VERSION`
is the version humans read (1.0); `CURRENT_PROJECT_VERSION` is the build counter
and is the one that has to go up **every single upload**.

**Screenshot dimensions.** App Store Connect rejects the listing with "the
dimensions of one or more screenshots are wrong" unless every image is exactly
one of: 1242 × 2688, 2688 × 1242, 1284 × 2778, or 2778 × 1284 px. A simulator
screenshot from the wrong device is the usual cause — iPhone 11 Pro Max or 12
Pro Max give you these sizes.

```sh
grep -n CURRENT_PROJECT_VERSION ios/App/App.xcodeproj/project.pbxproj   # appears twice, bump both
npm run build:native                     # vite build + cap sync + pod install
```

`cap sync` must report **11** Capacitor plugins for ios. Ten means SPM ate the
speech-recognition plugin — see the CocoaPods section below.

Then, in Xcode (open `ios/App/App.xcworkspace`, **never** the `.xcodeproj`):

1. Destination: **Any iOS Device (arm64)**. Archive is greyed out on a simulator.
2. **Product → Archive**
3. Organizer opens → **Distribute App → TestFlight & App Store Connect**

Take the **first** option and not "TestFlight Internal Only", which sits right
under it and sounds safer. It isn't a privacy setting — it permanently marks the
*build* as internal-only, so that upload can never be promoted to external
testers or submitted to the App Store. Undoing it means a new build number and a
fresh upload.

"TestFlight & App Store Connect" does **not** publish anything publicly. It puts
the build in App Store Connect, where TestFlight hands it to testers; releasing
to the App Store is a separate submission made later against the same build.

Or from the command line:

```sh
cd ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/carzbuild/CarzIMS.xcarchive archive -allowProvisioningUpdates

xcodebuild -exportArchive -archivePath /tmp/carzbuild/CarzIMS.xcarchive \
  -exportPath /tmp/carzbuild/export \
  -exportOptionsPlist ../../ios-config/ExportOptions.plist -allowProvisioningUpdates
```

The export step is not a formality — it re-signs for distribution. See the
comment in `ExportOptions.plist`.

Then the build processes in App Store Connect (usually 5–15 min, and it is not
in TestFlight until that finishes) — testers get the update after that. **If
nobody is being offered an update, it is almost always because no new build was
uploaded, or the one that was is still processing.**

Export compliance never prompts on upload: `ITSAppUsesNonExemptEncryption` is
already `false` in `Info.plist`. Leave it there — remove it and every single
upload starts asking the encryption question again.

### Internal vs external testers

Nothing in the upload picks this; it's set afterwards in App Store Connect by
adding the build to a tester group.

- **Internal** — up to 100 people who have App Store Connect access. No review.
  They can install as soon as processing finishes.
- **External** — up to 10,000, by email or public link. Needs **Beta App Review**
  first (typically ~a day). Later builds of the same version usually clear
  automatically unless much has changed.

**The thing that gets external builds rejected here: Carz IMS is behind login,
and new accounts need admin approval** (see the approval-gate work). A reviewer
signing up gets parked waiting for an approval that never comes, and reports the
app as broken. Put a **working demo account** in Test Information — already
approved, with real data visible — before submitting for external review.

### When the build breaks with `Unable to resolve module dependency: 'Capacitor'`

Check the pods are actually in sync before believing anything else:

```sh
cd ios/App && diff Pods/Manifest.lock Podfile.lock && echo in-sync
```

If they match and `node_modules/@capacitor/ios` exists, nothing is missing — it
is a stale module cache, and this clears it:

```sh
rm -rf ~/Library/Developer/Xcode/DerivedData/App-*
cd inspection-app && npm run build:native
```

Xcode will not notice on its own; close and reopen the workspace afterwards.

---

## Hand-edited files

`ios/` and `android/` are **generated** by Capacitor. Running `npx cap add ios`
or `npx cap add android` again (to switch package manager, recover a broken
project, or onboard a new machine) recreates them from a template and **silently
discards** every hand edit. Capacitor has no hook for these files.

The two files here are reference copies of the only native files we've hand
edited. After any regeneration, diff and re-apply:

```sh
diff ios-config/Info.plist.reference          ios/App/App/Info.plist
diff ios-config/AndroidManifest.xml.reference android/app/src/main/AndroidManifest.xml
```

## What's in them and why

### `Info.plist.reference`

- **`NSCameraUsageDescription`**, **`NSMicrophoneUsageDescription`**,
  **`NSSpeechRecognitionUsageDescription`**, **`NSPhotoLibraryUsageDescription`**,
  **`NSPhotoLibraryAddUsageDescription`** — iOS terminates the app on the spot if
  it touches one of these APIs with no matching string. App Review also rejects
  vague wording, so each one names what the app actually does with the
  permission.
- **`UIFileSharingEnabled`** + **`LSSupportsOpeningDocumentsInPlace`** — exports
  (inventory CSV, target buy list XLSX) are written to the app container and
  handed to the share sheet. Without these the user can't reach them from the
  Files app.

### `AndroidManifest.xml.reference`

- **`CAMERA`** / **`RECORD_AUDIO`** / **`VIBRATE`** — inspection photos, VIN
  scanning, hands-free lot walk, scan-confirm haptics.
- **`<uses-feature ... required="false">`** — the lot walk works without a
  camera (type-and-tap and voice both cover it), so don't let Play hide the app
  from camera-less devices.
- **`<queries>`** — Android 11+ package visibility. `App.openUrl` fires
  `ACTION_VIEW`, so `sms` must be declared under `VIEW`; declaring only
  `SENDTO`/`smsto` leaves the marketplace "text us" button reporting no handler
  even with Messages installed. Also covers `tel`, `https`, Custom Tabs (used by
  `openWeb`), and the speech `RecognitionService`.

## `project.pbxproj` — CODE_SIGN_IDENTITY must not stay on the template default

A third generated file carries a hand edit, and this one has no reference copy
here because a whole `.pbxproj` is too noisy to diff usefully. After any
regeneration, check it:

```sh
grep -n CODE_SIGN_IDENTITY ios/App/App.xcodeproj/project.pbxproj
```

The Capacitor template writes `CODE_SIGN_IDENTITY = "iPhone Developer"` into
**both** project-level configurations. `"iPhone Developer"` is the legacy name for
a *development* certificate, and setting it explicitly overrides automatic
signing — so `xcodebuild archive` goes looking for a development provisioning
profile and dies with:

```
error: No profiles for 'com.carzinc.ims' were found: Xcode couldn't find any
iOS App Development provisioning profiles matching 'com.carzinc.ims'.
```

The message is doubly misleading. It names the bundle ID, so it reads like the
identifier is unregistered; and when the team has no devices registered it is
preceded by "your team has no devices from which to generate a provisioning
profile", which reads like you must plug in a phone. Neither is the cause —
App Store distribution needs no devices at all. The build was simply asking for
the wrong *kind* of profile.

**The fix is to delete the key from both configurations, not to correct its
value.** Setting `Apple Distribution` on Release looks right and fails
differently:

```
error: App has conflicting provisioning settings. App is automatically signed
for development, but a conflicting code signing identity Apple Distribution has
been manually specified.
```

Under `CODE_SIGN_STYLE = Automatic`, Xcode picks the identity per action —
development to build and run, distribution to archive and export. *Any* explicit
`CODE_SIGN_IDENTITY` overrides that and conflicts. The project now has no
`CODE_SIGN_IDENTITY` at either project level, which is correct.

Note this does **not** on its own make `xcodebuild archive` work from the command
line: automatic signing still resolves a development profile first, which needs
at least one device registered to the team. See below.

## The team needs one registered device, even for a TestFlight-only build

`xcodebuild ... archive -allowProvisioningUpdates` fails with "your team has no
devices from which to generate a provisioning profile" until some device is
registered on the account — and it does **not** register a connected iPhone by
itself. Connecting the phone is not enough; it has to be trusted and prepared,
or its UDID added to the portal by hand.

This is counterintuitive, because App Store distribution genuinely needs no
devices. It's automatic signing insisting on resolving the development profile
along the way.

## Why this project is on CocoaPods, not SPM

**Don't "modernise" this to Swift Package Manager.** Capacitor 8 defaults to
SPM, and the first build of this app used it — but
`@capacitor-community/speech-recognition` ships a `.podspec` and **no
`Package.swift`**, so SPM silently drops it. The build succeeds, the app runs,
and voice entry on the lot walk just never appears on iPhone. `cap add` prints
a one-line warning that is very easy to read past:

```
[warn] @capacitor-community/speech-recognition does not have a Package.swift
[warn] Some installed Capacitor plugins are not compatible with SPM
```

The tell is the plugin count in the `cap sync` output: it must say **11**
Capacitor plugins for ios. Under SPM it said 10.

So the project is generated with:

```sh
npx cap add ios --packagemanager Cocoapods
```

which produces `ios/App/App.xcworkspace`. **Open the workspace, not the
`.xcodeproj`** — the `.xcodeproj` alone doesn't link the pods.

## Do not delete simulator runtimes

Copies of the same iOS simulator runtime share one backing disk image. Deleting
"duplicate" entries with `xcrun simctl runtime delete` removes that shared
image and takes the working runtime with it — leaving zero runtimes and an
8.5GB re-download. Duplicates are wasted disk, not a problem worth fixing.

They appear when two downloads race (e.g. `xcodebuild -downloadPlatform iOS`
started while Xcode > Settings > Components is already fetching it). Let one
finish; ignore the extra entries.
