# Carz IMS → Native App Store App

Plan to ship the existing web app as a downloadable iOS app (App Store) and Android app (Play Store).

Written 2026-08-03.

> **Status — Phases 1 and 2 are built.** Capacitor shell, native adapter layer, and
> every hard break in §4 are done and verified on the web build. What remains before
> a device install: Xcode + CocoaPods on this Mac, then `npm run ios`. See §10.

## Build commands

| Command | What it does |
|---|---|
| `npm run build` | Web build for Vercel — unchanged, still ships `public/training/` |
| `npm run build:native` | Native build (prunes 181MB training) + `cap sync` into ios/ and android/ |
| `npm run ios` | Native build, then opens Xcode |
| `npm run android` | Native build, then opens Android Studio |

Verified: web `dist` = 213MB with training intact; native `dist` = **1.9MB**.

---

## 1. What we're porting

`inspection-app/` — React 19 + Vite 8 + Tailwind 4 on Supabase. **33 pages, ~18,500 lines.**

| Area | Routes | Notes |
|---|---|---|
| Auth / onboarding | `/login` `/setup` `/pending` | Supabase phone + SMS OTP, admin approval gate |
| Dashboard | `/` | Stat strip, VIN search, tile grid |
| Inspection wizard | `/inspect/:id/{startup,exterior,interior,testdrive,photos,review}` | Camera, 675-line interactive SVG car diagram, damage modals |
| Inbound inspection | `/inbound` `/inbound/new` `/inbound/:id/{arrival,mechanical}` | Second wizard, 518-line mechanical form |
| Inventory | `/inventory` (1,535 lines) `/sold` `/unmatched` `/lot` | Biggest page in the app; lot walk uses camera scanner + voice |
| Reports & analytics | `/reports` `/reports/executive` `/sold-reports` `/analytics` `/front-lot-aging` | recharts + chart.js, xlsx export |
| Buying tools | `/buyer-match` `/list-builder` `/pull-list` `/vin-check` `/lookup` | CSV upload, clipboard-heavy |
| Public marketplace | `/listings` `/marketplace` `/marketplace/:id` | **No auth** — shareable buyer-facing links |
| Admin | `/admin` | User approval, roles |

Backend stays exactly as-is: Supabase (auth, Postgres, storage, 3 edge functions), `api/telegram.js` on Vercel, 10 SQL migrations. **Zero backend work in this project.**

---

## 2. Approach: Capacitor shell, not a React Native rewrite

**Recommendation: Capacitor.** The web app is compiled and loaded from inside a real native iOS/Android app, and native device APIs are called directly from the existing React code.

| | Capacitor wrap | React Native / Expo rewrite |
|---|---|---|
| Effort | ~8–10 weeks | ~4–6 months |
| Code reused | ~95% | ~30% (business logic only) |
| Feature work frozen during | ~2 weeks | ~5 months |
| Two codebases after? | No | Yes, or kill the web app |
| Feel | Native shell, web content | Fully native |
| iOS + Android | Same build | Same build |

Rewriting in React Native means re-authoring 675 lines of SVG car diagram, every recharts/chart.js dashboard, all Tailwind styling, the xlsx pipeline, and both inspection wizards — for an app that already runs at 60fps on a phone. Not worth it. If a specific screen ever feels sluggish natively, it can be replaced individually later.

**One real risk with Capacitor:** App Store Review Guideline **4.2 (Minimum Functionality)** rejects apps that are "just a repackaged website." Phase 3 exists specifically to defeat this — push notifications, biometric lock, offline photo queue, native scanner, share sheet, and haptics are all things a website cannot do, and they're each genuinely useful here. This is the difference between approval and a rejection loop.

---

## 3. Distribution decision

| Option | Who can install | Review scrutiny | Verdict |
|---|---|---|---|
| **Public App Store** | Anyone | Full, incl. 4.2 | **Recommended** — you have public marketplace pages, so a real consumer-facing surface exists |
| Custom App (Apple Business Manager) | Only your org, private link | Lighter | Fallback if 4.2 rejection sticks |
| Ad-hoc / TestFlight only | 100 devices / 10k testers | None / light | Good enough forever if you only ever want staff on it |

Going public also means the marketplace listings become a real acquisition channel. Plan below assumes public App Store + Play Store.

---

## 4. Technical gaps found in the audit

These are things that work in Safari but **break or degrade inside a native webview**. Each is a concrete work item.

### Hard breaks (must fix)

| # | Issue | Fix shipped | ✓ |
|---|---|---|---|
| 1 | **File downloads don't work in WKWebView.** `createElement('a')` + `createObjectURL` silently does nothing — no download manager exists. | `src/native/files.js` — `saveFile`/`saveCsv`. Native writes to `Directory.Cache` then opens the OS share sheet; web keeps the anchor download byte-for-byte. Rewired in `xlsxWriter.js`, `Inventory.jsx`, `FrontLotAging.jsx`, `Marketplace.jsx`. | ✅ |
| 2 | **Web Speech API is unavailable in WKWebView.** `webkitSpeechRecognition` is undefined in an embedded webview. | `src/native/speech.js` — `createSpeechSession` wraps Web Speech and `@capacitor-community/speech-recognition` behind one interface with continuous listening and auto-restart (iOS caps a session at ~60s). `LotWalk.jsx` rewired; support now resolved async. | ✅ |
| 3 | **Auth sessions get evicted.** iOS purges webview `localStorage` under memory pressure → random logouts mid-shift. | `src/native/storage.js` — Preferences-backed async storage adapter passed to `createClient`. `undefined` on web, so existing browser sessions stay valid. | ✅ |
| 4 | **Service worker conflicts.** Capacitor serves from a custom scheme; the SW can pin the app to a stale bundle after an app update. | `main.jsx` — registers only on web; on native it actively unregisters any SW so an old cache can't outlive an update. | ✅ |
| 5 | **181MB of training PDFs** would be bundled into the app binary. | `vite.config.js` — `carz:drop-training-assets` plugin prunes `dist/training` when `VITE_NATIVE_BUILD=1`. **194MB → 1.9MB.** | ✅ |
| 6 | **Bottom nav sits under the home indicator.** | `viewport-fit=cover` in `index.html`; `--safe-*` vars + `.safe-*` / `.app-shell` classes in `index.css`; `BottomNav` and both `CameraCapture` overlay bars inset. | ✅ |

### Degraded (should fix)

| # | Issue | Fix | ✓ |
|---|---|---|---|
| 7 | `navigator.clipboard` is unreliable in webviews | `src/native/clipboard.js` — `copyText()` with a native → `navigator.clipboard` → `execCommand` fallback chain. **All 11 call sites** rewired across `BuyerMatch`, `BuyerAnalytics`, `VehicleQuickInfo`, `Inventory`, `ListBuilder`, `FrontLotAging`, `Marketplace`, `MarketplaceListing`. | ✅ |
| 8 | `window.open('sms:...')` won't launch Messages | `src/native/links.js` — `openExternal` + `smsUrl` (iOS wants `&body=`, Android `?body=`). `MarketplaceListing.jsx` rewired. Android `<queries>` added so the OS admits Messages exists. | ✅ |
| 9 | `getUserMedia` camera works but is slower and lower-res than native | Left on `getUserMedia` — it works in WKWebView and the custom outline overlay is worth keeping. Revisit only if device testing shows it's too slow. | ⏸ deferred by choice |
| 10 | `html5-qrcode` scanner works but drops frames | `@capacitor-mlkit/barcode-scanning` — Phase 3. | ⬜ |
| 11 | CSV/file pickers (`DamageModal`, `BulkLocationEdit`, `BuyerMatch`, `ListBuilder`, `PhotoCapture`) | `<input type="file">` works on iOS 14+; needs a real device pass. `@capawesome/capacitor-file-picker` if flaky. | ⬜ device test |

### App Store compliance gaps

| # | Requirement | Status |
|---|---|---|
| 12 | **Guideline 5.1.1(v) — in-app account deletion.** Apps that create accounts must let users delete them in-app. | ❌ **Missing.** Must build (UI + Supabase RPC + storage cleanup) |
| 13 | Guideline 2.1 — demo account for reviewers (app is phone-OTP gated) | ❌ Need a pre-approved reviewer account with a phone the reviewer can't SMS → use a fixed test OTP or magic bypass account |
| 14 | Privacy policy + terms, publicly reachable | ✅ `public/privacy-policy.html`, `public/terms-of-service.html` already exist |
| 15 | Privacy Nutrition Labels (phone number, photos, coarse location, usage data) | ❌ Declare in App Store Connect |
| 16 | `Info.plist` usage strings: camera, microphone, speech recognition, photo library | ✅ Added in `ios/App/App/Info.plist` (plus `UIFileSharingEnabled` so exports are reachable from Files). Android permissions + `<queries>` added to `AndroidManifest.xml`. Wording is specific about *what the app does* with each — vague strings get rejected. |
| 17 | Sign in with Apple | ✅ Not required — phone OTP is first-party, no third-party social login |
| 18 | App Tracking Transparency | ✅ Not required — no cross-app tracking |

### Toolchain not yet installed on this Mac

- Xcode — **not installed** (~15GB download, 1–2 hrs). Blocks `npm run ios`.
- CocoaPods — **not installed** (`sudo gem install cocoapods`, or `brew install cocoapods`)
- Android Studio + SDK — **not installed**. Blocks `npm run android`.
- Node v22.18.0 ✅, Apple Silicon (arm64) ✅
- Capacitor 8.5 + 11 plugins ✅, `ios/` and `android/` scaffolded and synced ✅

---

## 5. New native features (Phase 3)

These both defeat Guideline 4.2 and are things the crew will actually use.

1. **Push notifications** (`@capacitor/push-notifications` + Firebase/APNs, triggered from a Supabase edge function)
   - New car needs dispatch
   - Car stuck >21 days
   - Inspection assigned to you
   - New buyer lead from the marketplace
   - Telegram intake photo landed
2. **Biometric app lock** (Face ID / fingerprint) — real value, the app shows cost and profit data
3. **Offline photo queue** — inspectors work in dead zones on the back lot. Photos captured offline queue locally and upload when signal returns. Currently a failed upload just loses the shot.
4. **Native VIN barcode scanner** — ML Kit reads windshield barcodes far faster than html5-qrcode
5. **Universal Links / App Links** — `carzinc.com/marketplace/:id` share links open in the app
6. **Native share sheet** — share a listing or an xlsx export to Messages/Mail/AirDrop
7. **Haptics** — damage tap, scan confirm, step complete
8. **Home screen widget (iOS, optional)** — cars on lot, needs-dispatch count

---

## 6. Phased plan & timeline

Assumes solo work with Claude Code, part-time alongside running the dealership. **Phase 0 runs in parallel from day 1 — start it before anything else, it's the long pole.**

### Phase 0 — Accounts & prerequisites · *Week 1, mostly waiting*
- **Apple Developer Program, Organization enrollment** — $99/yr. Requires a **D-U-N-S number** for Carz Inc. Getting/verifying a D-U-N-S is **1–2 weeks**, then Apple approval is another few days to 2 weeks. *Start this the same day you read this.*
  - Faster alternative: enroll as an Individual (no D-U-N-S, ~48hr approval), but the App Store seller name becomes your personal name, not "Carz Inc."
- **Google Play Console** — $25 one-time. Organization accounts skip the 12-tester/14-day closed-testing requirement that personal accounts now face.
- Install Xcode + CocoaPods + Android Studio
- Decide bundle IDs (`com.carzinc.ims`), app name, and whether the marketplace ships in the same app or a separate consumer app

### Phase 1 — Capacitor shell + build pipeline · *Week 1–2 · ~3 days work*
- `npm i @capacitor/core @capacitor/cli && npx cap init`
- Add `ios` and `android` platforms
- Split the Vite build: native build excludes `public/training/`, points the training tab at the hosted URL
- Environment config so one codebase builds web (Vercel) and native (App Store) from the same source
- Get a debug build running on your actual iPhone
- **Exit criteria:** app launches on device, you can log in with SMS OTP, dashboard loads real data

### Phase 2 — Fix the native gaps · *Week 2–4 · ~8 days work*
Items 1–11 above. Roughly:
- Days 1–2: storage adapter, service worker, safe areas, viewport (items 3, 4, 6)
- Days 3–4: file download/share layer, rewire all 4 export call sites (item 1)
- Days 5–6: speech recognition, barcode scanner, camera (items 2, 9, 10)
- Days 7–8: clipboard, sms links, file pickers, full device pass on all 33 routes (items 7, 8, 11)
- **Exit criteria:** every route works on a real iPhone and a real Android phone with no console errors

### Phase 3 — Native features · *Week 4–6 · ~9 days work*
- Days 1–3: push notifications end-to-end (APNs + FCM certs, device token table, Supabase edge function triggers, notification tap → deep link)
- Days 4–5: offline photo queue with retry
- Day 6: biometric lock
- Day 7: universal links + app links (needs `apple-app-site-association` on the domain)
- Days 8–9: share sheet, haptics, polish
- **Exit criteria:** app does five things a website cannot

### Phase 4 — Store compliance & assets · *Week 5–6 · ~4 days work*
- Build in-app account deletion (item 12) — this is real work: UI, confirm flow, Supabase RPC to purge profile + inspections + storage photos
- Reviewer demo account (item 13)
- `Info.plist` usage strings, privacy nutrition labels, age rating
- App icon set, launch screen
- Screenshots: 6.9" and 6.5" iPhone, plus Android — 5–8 shots each, from real data (blur any customer PII)
- App Store description, keywords, support URL, marketing copy
- **Exit criteria:** App Store Connect listing 100% complete, build uploads clean

### Phase 5 — TestFlight beta with your crew · *Week 6–8 · ~4 days work + real-world soak*
- Internal TestFlight to inspectors, lot walkers, and yourself
- Run a full week of actual inspections and lot walks on the native build
- Crash reporting (Sentry or Firebase Crashlytics)
- Fix what the crew hits
- **Exit criteria:** one full week, zero blocking bugs, crew prefers it to the web version

### Phase 6 — Submit, review, launch · *Week 8–10*
- Submit iOS. First review: **24–48 hrs** typical, but budget for **one rejection cycle** — 4.2 and 5.1.1(v) are the likely hits, and each round trip is 2–5 days.
- Submit Android in parallel. Play review is slower for new developer accounts — **up to 7 days**.
- Respond to review feedback, resubmit
- **Exit criteria:** live on both stores

---

## 7. Timeline summary

| Phase | Calendar | Working days |
|---|---|---|
| 0 · Accounts (parallel) | Week 1–3 | ~1 |
| 1 · Capacitor shell | Week 1–2 | 3 |
| 2 · Native gap fixes | Week 2–4 | 8 |
| 3 · Native features | Week 4–6 | 9 |
| 4 · Store compliance | Week 5–6 | 4 |
| 5 · TestFlight beta | Week 6–8 | 4 + soak |
| 6 · Submit & review | Week 8–10 | 2 |
| **Total** | **~10 weeks** | **~31 days** |

**Realistic bands:**
- **Best case, 8 weeks** — Apple org enrollment clears fast, no rejections, few device surprises
- **Expected, 10 weeks** — one rejection cycle, normal friction
- **If D-U-N-S drags or you hit two rejections, 14 weeks**

**Fastest path to "on my phone from the App Store":** TestFlight after Phase 2 (~week 4). Your crew can install and use it well before the public listing exists. That's worth doing regardless — it de-risks everything downstream.

---

## 8. Costs

| Item | Cost |
|---|---|
| Apple Developer Program | $99/yr |
| Google Play Console | $25 one-time |
| Push notifications (Firebase) | Free at this scale |
| Crash reporting (Sentry free tier / Crashlytics) | Free |
| Supabase / Vercel | No change |
| **Year 1** | **~$124** |

---

## 9. Open decisions

1. **One app or two?** Staff IMS and the public buyer marketplace are different audiences. Shipping both in one app is simpler and gives the reviewer a public surface to see. Splitting later is easy if the marketplace grows.
2. **Apple enrollment: Organization (D-U-N-S, slower, "Carz Inc" as seller) or Individual (fast, personal name)?**
3. **Android at the same time or after iOS?** Same Capacitor build — Android adds maybe 3 days total. Recommend same time.
4. **Does the training course (181MB of PDFs) belong in the app at all,** or stay a web-only link?

---

## 10. What's built vs. what's next

### Built and verified (2026-08-03)

**Shell**
- Capacitor 8.5, `com.carzinc.ims`, `capacitor.config.json` (dark status bar, splash, keyboard)
- `ios/` and `android/` scaffolded, 11 plugins linked, `cap sync` clean
- Split build: `npm run build` (web, training intact) vs `npm run build:native` (**1.9MB**)
- `ios`/`android` excluded from `.vercelignore` so web deploys don't carry ~40MB of shell

**`src/native/` adapter layer** — every module is web-safe and falls back to existing behaviour, so one bundle serves both targets:

| File | Purpose |
|---|---|
| `platform.js` | `isNative()` / `isIOS()` / `isAndroid()`, hosted training URL |
| `storage.js` | Preferences-backed Supabase auth storage + async `store` KV |
| `files.js` | `saveFile` / `saveCsv` → anchor download on web, Filesystem + share sheet on native |
| `clipboard.js` | `copyText` with three-tier fallback |
| `speech.js` | `createSpeechSession` over Web Speech *and* the native recognizer |
| `links.js` | `openExternal` / `openWeb` / `smsUrl` |
| `haptics.js` | tap / bump / success / warn / fail |
| `shell.js` | status bar, splash, deep links, Android back button |

**Verification run:** ESLint clean on all new and edited files (remaining repo errors are pre-existing). Web build passes. Native build passes and prunes training. Web app loads and renders `/login` and `/marketplace` with zero console errors.

### Next, in order

1. **Start Apple Developer enrollment today** — the D-U-N-S wait is the critical path and nothing else unblocks it. *(§6 Phase 0)*
2. **Install Xcode + CocoaPods**, then `npm run ios` → run on your iPhone. First device build is where webview-only assumptions surface.
3. **Device pass over all 33 routes** — especially the file pickers (gap 11), the camera at `/inspect/:id/photos`, and the scanner + voice on `/lot`.
4. **Phase 3 native features** — push notifications first; they're the strongest answer to Guideline 4.2.
5. **In-app account deletion (gap 12)** — Apple requires it and it does not exist yet. UI + Supabase RPC to purge profile, inspections, and storage photos.
6. **Reviewer demo account (gap 13)** — the app is phone-OTP gated; a reviewer with no US phone cannot get in, which is an automatic rejection.

### Known caveats to check on device

- **CORS**: Supabase requests will originate from `capacitor://localhost` (iOS) / `https://localhost` (Android) instead of the Vercel domain. Supabase's REST and auth endpoints send `Access-Control-Allow-Origin: *`, so this should just work — but it's the first thing to check if the dashboard loads empty.
- **Speech on iOS** routes through Apple's servers unless an on-device model is available — worth knowing on a dead-zone lot walk. `speechNeedsNetwork()` is exported for a UI warning if it turns out to matter.
- **`getUserMedia` on iOS** requires the app be served from a secure context; Capacitor's custom scheme qualifies, but camera permission is still gated on `NSCameraUsageDescription` being present (it now is).
