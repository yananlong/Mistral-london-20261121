# Run Mesh Help

Run Talk, Locate, and Ask in Expo Go or a web browser. The default demo has an in-memory Phone B, an in-memory hub, canned answers, and a labelled London position.

## Start on web

Use Node 22.13 or later and npm. From `app/`, run:

```sh
npm ci
npm run web
```

Open the URL printed by Expo. The **Simulated link** badge stays visible. No Bluetooth connection, hub, cloud API, account, or map download is needed.

To serve a production web export locally, run:

```sh
npx expo export --platform web
python3 -m http.server 9042 --directory dist
```

Open `http://localhost:9042`. `dist/` is ignored by git. The web version lists coordinates and shared pins because MapLibre Native requires a development build.

## Start in Expo Go

Install Expo Go with SDK 58 support on your iPhone. Put the phone and the development computer on the same network, then run:

```sh
npm start -- --go
```

Scan Expo’s QR code with the iPhone camera. The simulator runs inside the app. The development server supplies the JavaScript, so this route needs a local network during development.

The demo starts at Westminster with **Demo position** visible. In Locate, tap **Use device position** to request location permission and use real GPS. Web geolocation requires localhost or HTTPS. An unavailable fix or denied permission has its own state.

## Walk through the demo

1. In Talk, choose **Phone B**, enter a message, and tap **Send message**. Choose **Public channel** to send publicly.
2. Open **Demo controls** and tap **Phone B sends a private message**. Open Phone B’s thread to read it.
3. Tap **Phone B shares a location**, then open its location row. Locate selects that location and lists Phone B’s latest pin.
4. In Locate, tap **Share location** and choose the public channel or Phone B. The hub is excluded from this picker.
5. In Ask, tap a suggested question. Watch **Sent**, **Received by hub** after about 0.8 seconds, and **Answered** about 2.5 seconds later. Multipart answers show their arrival progress.
6. Tap **Ask another question**. In Demo controls, choose **Hub offline**, then ask again. After 30 seconds, **Hub not reachable** appears.
7. Choose **Hub online** and tap **Retry**. The same question is sent again and receives an answer.
8. Choose **Hub error** to demonstrate **Hub could not answer**. Use the position controls to demonstrate a denied permission or no position fix.

**Attach my location** starts off for every new question. When enabled, it adds the exact trailing `loc:` line defined in [the protocol contract](../protocol/README.md). A real fix or the clearly labelled demo position is required. The AI disclaimer stays visible while the Ask content scrolls.

Questions are limited to 200 UTF-8 bytes and Talk messages to 255 UTF-8 bytes; the composer shows remaining bytes near the limit. A question sent to the hub from Talk uses the 200-byte question limit. The question limit leaves room for an attached location within the mesh's 255-byte message limit.

## Add the mesh and offline map on a Mac

Use a Mac with Xcode, an iOS signing identity, and an iPhone. Expo autolinks the included `modules/bitchat-mesh/` module, and `app.json` enables its config plugin. Initialize the BitChat submodule from the repository root before building:

```sh
git submodule update --init bitchat
```

Choose a unique `ios.bundleIdentifier` in `app.json` for signing. The module needs iOS 16 or later; Expo SDK 58's generated Podfile defaults to iOS 16.4. The module plugin prepares its BitChat sources during prebuild and adds the Bluetooth usage descriptions and background modes.

Build and start the native application:

```sh
npm ci
npx expo prebuild --platform ios --no-install
npx expo run:ios --device
```

When `requireOptionalNativeModule('BitchatMesh')` finds the module, the factory selects the thin BitChat adapter. Otherwise, including in Expo Go and on web, the app selects the simulated link. Native events and methods follow [the shared module API](../protocol/README.md#native-mesh-module-api). See the [module README](modules/bitchat-mesh/README.md) for source preparation, signing, first-device checks, and current limitations. Use a Release/mainnet hub build so its Bluetooth service UUID matches the phone module.

The MapLibre config plugin is already enabled. The lockfile pins MapLibre React Native 11.5.1, which selects MapLibre Native iOS 6.31.0. [MapLibre’s Expo setup](https://maplibre.org/maplibre-react-native/docs/setup/expo/) requires a rebuilt native app.

Prepare the London map before going offline:

1. From the repository root, run `datasets/scripts/fetch_all.sh`. This produces `datasets/phone/map/london.pmtiles` alongside other datasets.
2. Install and launch Mesh Help on the iPhone.
3. Copy `london.pmtiles` into Mesh Help’s **Documents** directory with Finder file sharing or the Files app. The app enables file sharing for this purpose.
4. In Locate, tap **Check for downloaded map** or reopen Locate.

The map reads `pmtiles://file://…/london.pmtiles` directly. Its local style (`src/map/mapStyle.ts`) draws a full offline basemap from the Protomaps vector layers — land cover and land use (woods, parks, urban blocks), water bodies and waterways, building footprints with outlines, admin boundaries, and a road hierarchy (motorway down to paths) with casing and zoom-scaled widths. It requests no remote tiles, fonts, sprites, or styles, so there are no street-name label layers yet (that needs bundled glyph PBFs; pins are native markers with device text). The map is navigable: pan, pinch zoom, rotate and pitch are on, zoom is clamped to z10–z18, and on-map buttons zoom in/out or recenter on the selected position. A missing map, an out-of-region position, or a map load failure leaves the coordinate list usable.

Device builds add the real mesh and native map. The simulated link alone does not demonstrate communication between two physical phones. No iOS build or device run was possible on this machine because Xcode is unavailable.

## Configure the transport and backend

`src/config.ts` holds the runtime configuration, ported from `phone/app` (PR #18):

- `transportMode`: `auto` (default) uses the native BitchatMesh module when it is linked and the simulated mesh otherwise. `simulated` always uses the simulated mesh. `native` throws at startup if the module is missing.
- `hubNickname`, `ackTimeoutMs`, `answerTimeoutMs`: how Ask finds the hub and how long it waits.
- `apiBaseUrl`: the post-MVP live-information backend. It stays `null`, so the app makes no HTTP calls. `src/api/client.ts` fails loudly until it is set.

## Build for Android

`android/` is generated and ignored by git. From `app/`, regenerate it and run it on a device or emulator:

```sh
npx expo prebuild --platform android --clean
npx expo run:android
```

The BitchatMesh native module is iOS-only for now, so the Android build runs on the simulated link with the **Simulated link** badge visible.

## Run the checks

From `app/`, run:

```sh
npx tsc --noEmit
npx jest --ci
npx expo export --platform web
npx expo config --type prebuild
npx expo config --type introspect
```

The Jest suite reads the app-relevant vectors directly from `../protocol/vectors.json`, including all 48 Ask transitions and the simulated hub's answer composition. Screen tests run the simulated transport with fake timers, including out-of-order answer delivery, retry, byte limits, location attachment, Talk threads, and Locate pins and permissions. Expo's `prebuild` config displays the configured plist values; `introspect` also executes the safe plist mods in memory to show their result.

The screens use one runtime context. Mesh peers, conversations, and the latest location per sender live in one event-fed store. Ask timers, sends, and multipart assembly live in a controller outside the pure transition reducer, so changing tabs keeps a question active. Parts may arrive out of order or more than once; the answer is shown only after all parts and the final label arrive.

Messages and pins last for the current app session. The plain-text protocol has no question id. A stale answer after reset and another submission can belong to the new question, as described in the contract.

The canned demo text uses short paraphrases of [St John Ambulance bleeding guidance](https://www.sja.org.uk/first-aid-advice/severe-bleeding/), [NHS burns guidance](https://www.nhs.uk/conditions/burns-and-scalds/), [NHS carbon monoxide guidance](https://www.nhs.uk/conditions/carbon-monoxide-poisoning/), [FDA food safety during power outages](https://www.fda.gov/food/buy-store-serve-safe-food/food-and-water-safety-during-power-outages-and-floods), and [CDC boil-water guidance](https://www.cdc.gov/natural-disasters/psa-toolkit/boil-water-advisory.html). Demo answers remain labelled as unverified AI advice under the message contract.

## Android hub link (dev, via Mac)

Android has no native BitChat mesh yet, so on Android the app uses `HubLinkTransport`: Ask questions go over plain HTTP to the hub's Ollama-compatible `POST /api/chat`. It is not a mesh, and the header says "Hub link (dev, via Mac)". Talk and Locate stay simulated. iOS is unchanged.

- Hub URL: `EXPO_PUBLIC_HUB_URL`, default `http://127.0.0.1:8081` (USB phone with `adb reverse`). Use `http://10.0.2.2:8081` on the emulator.
- Mac: `ssh -N -L 8081:127.0.0.1:8081 spark`, then `adb reverse tcp:8081 tcp:8081`. Metro must then run on another port (for example `npx expo start --port 8082`), because 8081 is taken by the tunnel.
- Cleartext HTTP is allowed by `plugins/withAndroidCleartextHub.js` (applied at prebuild / `npx expo run:android`). Debug builds already allow it.
