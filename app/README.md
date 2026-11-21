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
5. In Ask, tap a suggested question. Watch **Sent**, **Received by hub** after about 0.8 seconds, and **Answered** about 2.5 seconds later.
6. Tap **Ask another question**. In Demo controls, choose **Hub offline**, then ask again. After 30 seconds, **Hub not reachable** appears.
7. Choose **Hub online** and tap **Retry**. The same question is sent again and receives an answer.
8. Choose **Hub error** to demonstrate **Hub could not answer**. Use the position controls to demonstrate a denied permission or no position fix.

**Attach my location** starts off. When enabled, it adds the exact trailing `loc:` line defined in [the protocol contract](../protocol/README.md). A real fix or the clearly labelled demo position is required.

## Add the mesh and offline map on a Mac

Use a Mac with Xcode, an iOS signing identity, and an iPhone. Integrate the other worker’s module under `modules/bitchat-mesh/` before building. Expo autolinks local modules there. This app does not create or modify that directory.

Build and start the native application:

```sh
npm ci
npx expo run:ios --device
```

When `requireOptionalNativeModule('BitchatMesh')` finds the module, the factory selects the thin BitChat adapter. Otherwise the app selects the simulated link. Native events and methods follow [the shared module API](../protocol/README.md#native-mesh-module-api).

The MapLibre config plugin is already enabled. The lockfile pins MapLibre React Native 11.5.1, which selects MapLibre Native iOS 6.31.0. [MapLibre’s Expo setup](https://maplibre.org/maplibre-react-native/docs/setup/expo/) requires a rebuilt native app.

Prepare the London map before going offline:

1. From the repository root, run `datasets/scripts/fetch_all.sh`. This produces `datasets/phone/map/london.pmtiles` alongside other datasets.
2. Install and launch Mesh Help on the iPhone.
3. Copy `london.pmtiles` into Mesh Help’s **Documents** directory with Finder file sharing or the Files app. The app enables file sharing for this purpose.
4. In Locate, tap **Check for downloaded map** or reopen Locate.

The map reads `pmtiles://file://…/london.pmtiles` directly. Its local style draws land, water, roads, and buildings from the Protomaps vector layers. It requests no remote tiles, fonts, sprites, or styles. Coordinates identify pins without a font download. A missing map, an out-of-region position, or a map load failure leaves the coordinate list usable.

Device builds add the real mesh and native map. The simulated link alone does not demonstrate communication between two physical phones. No iOS build or device run was possible on this machine because Xcode is unavailable.

## Run the checks

From `app/`, run:

```sh
npx tsc --noEmit
npx jest --ci
npx expo export --platform web
```

The Jest suite reads the app-relevant vectors directly from `../protocol/vectors.json`, including all 48 Ask transitions. Screen tests run the real simulated transport with fake timers. They cover the successful Ask flow, both failure states, retry, location attachment, Talk threads, and Locate pins and permissions.

See [ARENA_NOTES.md](ARENA_NOTES.md) for design choices. The screens use one runtime context. Mesh peers, conversations, and the latest location per sender live in one event-fed store. Ask timers and sends live in a controller outside the pure transition reducer, so changing tabs keeps a question active.

Messages and pins last for the current app session. The plain-text protocol has no question id. A stale answer after reset and another submission can belong to the new question, as described in the contract.

The canned demo text uses short paraphrases of [St John Ambulance bleeding guidance](https://www.sja.org.uk/first-aid-advice/severe-bleeding/), [NHS burns guidance](https://www.nhs.uk/conditions/burns-and-scalds/), [NHS carbon monoxide guidance](https://www.nhs.uk/conditions/carbon-monoxide-poisoning/), [FDA food safety during power outages](https://www.fda.gov/food/buy-store-serve-safe-food/food-and-water-safety-during-power-outages-and-floods), and [CDC boil-water guidance](https://www.cdc.gov/natural-disasters/psa-toolkit/boil-water-advisory.html). Demo answers remain labelled as unverified AI advice under the message contract.
