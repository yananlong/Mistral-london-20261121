# TestFlight readiness — phone app

What exists today, what is still missing, and the exact steps to get the
React Native app (`phone/app`) onto TestFlight once the backend (hub over
the mesh, then the post-MVP live backend) is connected.

Status: the JS app is ready (`phone/app`, React Native 0.74 + TypeScript,
typecheck and 51 jest tests green). The iOS *shell* (Xcode project) is not
scaffolded yet — `phone/ios` currently holds only the `MinistralKit` Swift
sources, no `.xcodeproj`.

## 1. Prerequisites (blocking)

- [ ] A Mac with Xcode (the native build needs it; see PLAN.md section 8 —
  confirm who has one).
- [ ] Apple Developer **Program** membership ($99/yr). PLAN.md section 3:
  a free Apple ID can install on ~3 devices via Xcode but **only the paid
  Program can use TestFlight**. Enroll at
  https://developer.apple.com/programs/ and wait for confirmation.
- [ ] An App Store Connect app record for the bundle ID (step 3).

## 2. Bundle ID and app identity (decide once)

- [ ] Pick the bundle ID, e.g. `com.<team>.firefish` (app.json name is
  `FrenchyApp`, display name "Frenchy" — rename consistently if the team
  picks a different product name).
- [ ] Set it in the Xcode project (`Signing & Capabilities` > Bundle
  Identifier) and keep `phone/app/app.json` `name` matching the Xcode
  product name. The bundle ID must stay stable: model files copied via
  `scripts/push_ios.sh` survive rebuilds only while team + bundle ID are
  unchanged (phone/ios/INSTALL.md).

## 3. Scaffold the Xcode shell around `phone/app`

`phone/app` has no `ios/` folder yet (the README notes metro "needs the
native project from a later PR"). Standard bare-RN way with RN 0.74:

```sh
# in a temp dir, same RN version as phone/app/package.json (0.74.5):
npx @react-native-community/cli@13.6.6 init FrenchyApp --version 0.74.5
# then move the generated ios/ into phone/app/ios (and android/ likewise),
# or generate in place and merge. Keep package.json name "FrenchyApp".
```

Then integrate the native pieces that already exist in this repo:

- [ ] Add the BitChat native module (wraps the Swift mesh code from our
  BitChat fork) to the Xcode project. It must register as
  `NativeModules.BitChatMesh` with `send(to, text): string`,
  `peers(): Peer[]` and an event listener API emitting `bitchatMessage` /
  `bitchatPeers` — that is the contract `phone/app/src/transport/NativeTransport.ts`
  expects. With the module linked, `src/config.ts` `transportMode: 'auto'`
  picks it up automatically; until then the app runs on the simulated mesh.
- [ ] Add the `MinistralKit` local Swift package per `phone/ios/README.md`
  section 1 (llama.cpp b12606 binary target), or defer the on-device model
  and keep questions going to the hub (fallback order, README section 6).
- [ ] `cd phone/app && npm install && npx pod-install` (or `cd ios && pod install`)
  so `react-native-maps` links.
- [ ] Bundle the offline map: add `phone/app/maptiles/` to the app target in
  Xcode as a folder reference (iOS), and copy it into
  `android/app/src/main/assets/` (Android). 393 OSM tiles, z11–z16, ~15 MB;
  regenerate with `python3 phone/app/scripts/fetch_map_tiles.py`. The app
  renders them via `LocalTile` (`src/locate/tiles.ts`) and shows the
  © OpenStreetMap attribution.

## 4. Signing, capabilities, Info.plist

- [ ] Signing & Capabilities: pick the paid Team, "Automatically manage
  signing", set the bundle ID from step 2.
- [ ] Capabilities: Push Notifications only if added later; Bluetooth is via
  CoreBluetooth (no capability needed, just the usage description).
- [ ] Info.plist keys (usage descriptions are required or the app crashes on
  first use; wording per feature):
  - `NSBluetoothAlwaysUsageDescription` — mesh messaging (Talk/Ask).
  - `NSLocationWhenInUseUsageDescription` — Locate + `loc:` line in Ask.
  - `NSCameraUsageDescription` — vision orientation (MinistralKit).
  - `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` —
    on-device speech (phone/ios/README.md section 4).
  - `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` — model and
    dataset files via Finder (phone/ios/INSTALL.md).
- [ ] Entitlements: optionally `com.apple.developer.kernel.increased-memory-limit`
  for the on-device model (may be unavailable on some setups — test without
  it first, phone/ios/README.md section 3).
- [ ] `react-native-maps` uses Apple Maps with bundled `LocalTile`s
  (LocateScreen), so **no Google Maps API key** is needed. If a Google
  provider is ever added, its key goes in `AppDelegate.mm` / Info.plist.

## 5. Versioning

- [ ] Set `MARKETING_VERSION` (e.g. 0.1.0) and `CURRENT_PROJECT_VERSION`
  (build number, bump every upload) in the Xcode project, or drive them with
  `agvtool`. TestFlight rejects an upload whose build number already exists
  for the version.

## 6. Archive and upload

```sh
# in Xcode: select "Any iOS Device (arm64)" (or a connected phone),
# Product > Archive with the Release scheme.
# Then in the Organizer: Distribute App > App Store Connect > Upload.
# Alternative without Xcode archive UI: EAS Build
#   npm install -g eas-cli && eas login && eas build --platform ios
# (needs an eas.json; not added yet — decide if the team wants EAS).
```

- [ ] Upload succeeds, then wait for processing in App Store Connect
  (minutes to ~an hour; an email confirms).

## 7. App Store Connect / TestFlight setup

- [ ] Create the app record (bundle ID from step 2, name, SKU).
- [ ] Export compliance: the app uses no non-exempt encryption → set
  `ITSAppUsesNonExemptEncryption` = NO in Info.plist (standard for
  HTTPS-only apps).
- [ ] Privacy nutrition label: the MVP collects no data and no question
  leaves the mesh for a cloud API — answer "No" to data collection.
- [ ] TestFlight tab: add Internal Testing group (team, up to 100, no review)
  and optionally an External Testing group (up to 10,000, needs Beta App
  Review: add beta app info, review contact, demo account if login exists).
- [ ] Add testers by email / public link; they install the TestFlight app
  and redeem the build.

## 8. Connecting the backend (JS side is ready)

- Mesh/hub backend: link the native module (step 3). `src/config.ts`
  `transportMode: 'auto'` then uses it; `'simulated'` forces the demo mesh.
  Ask-screen hub peer id and timeout live in `src/config.ts`
  (`hubPeerId`, `hubTimeoutMs`).
- Post-MVP HTTP backend (live alerts, "I'm safe" relay): set
  `config.apiBaseUrl` and use `src/api/client.ts` (`ApiClient.fromConfig()`).
  In the MVP build `apiBaseUrl` is null and the client fails loudly, so the
  offline claim stays true.

## 9. Pre-flight demo checks before a TestFlight build

- [ ] `cd phone/app && npx tsc --noEmit && npx jest` — green.
- [ ] Airplane mode on the test phone, Bluetooth on: Talk/Locate/Ask work
  over the real mesh (or simulated mesh if the native module is not linked).
- [ ] Every hub answer still carries the AI-generated label (AskScreen).
- [ ] Model files re-hashed / size-checked if the on-device model ships
  (phone/TEST_PLAN.md section 3 step 5).

## Sources

- https://developer.apple.com/testflight/
- https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices
- https://reactnative.dev/docs/publishing-to-app-store
- https://developer.apple.com/documentation/bundleresources/information_property_list/nsbluetoothalwaysusagedescription
