# Hand-edited native config — reference copies

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
