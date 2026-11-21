# Run Mesh Help

Run the one-screen app built to the dark design in [`design/components.html`](../design/components.html) (the benchmark) and [`design/PRINCIPLES.md`](../design/PRINCIPLES.md), in Expo Go or a web browser. The default demo has an in-memory Phone B, an in-memory hub, example answers, and a labelled London position.

## Start on web

Use Node 22.13 or later and npm. From `app/`, run:

```sh
npm ci
npm run web
```

Open the URL printed by Expo. A small **Demo** tag stays visible at the top. No Bluetooth connection, hub, cloud API, account, or map download is needed.

To serve a production web export locally, run:

```sh
npx expo export --platform web
python3 -m http.server 9042 --directory dist
```

Open `http://localhost:9042`. `dist/` is ignored by git. The web version draws places on a plain schematic map, because MapLibre Native requires a development build.

## Start in Expo Go

Install Expo Go with SDK 58 support on your iPhone. Put the phone and the development computer on the same network, then run:

```sh
npm start -- --go
```

Scan Expo’s QR code with the iPhone camera. The simulator runs inside the app. The development server supplies the JavaScript, so this route needs a local network during development.

The demo position is Borough High Street, a short walk from the demo places. In **Demo controls → Your position**, choose **Device** to request location permission and use real GPS. Web geolocation requires localhost or HTTPS. An unavailable fix or denied permission has its own state.

## The screen

One screen, in the design's order of importance. There are no tabs.

- **What's going on?** One big line, one fact under it, then *What happened? / Why? / When will it be fixed?* Each answer is a fact with its source, or *Not known yet*. News that arrives replaces it and is tagged **New**.
- **What you can find.** Six topics with pictures: Water, Charge phone, Food, Family, Shelter, First aid. Each says whether there is anything to find yet. A place topic opens a sheet on the map with numbered pins, then a list with the walk distance and who said so. **First aid** has offline step-by-step guides that work with Bluetooth off. **Family** sends *I'm OK* / *I need help*, a typed message, or (after a confirm) where you are, to everyone nearby or one person.
- **Your messages.** Questions and what happened to them: three bars and a word (*Sending → Delivered → Answered*, or *Not sent yet* with a yellow clock). Answers are labelled *AI answer. Not verified emergency advice.* An answer about a place carries an **Open map** card. Messages, shared locations and SOS calls from people nearby appear here too.
- **The dock**, pinned under everything: a notice only when something needs doing (*Bluetooth is off* with a button, or *Not getting through right now* with *How does this work?*), the **SOS bar**, and **Ask anything** with an optional *include where I am* pin, off by default.

The app shows no connection status: no *online*, no peer counts, no *hub* or *mesh* wording (PRINCIPLES §2). It keeps trying by itself. A question asked before any answerer is in range waits as *Not sent yet* and goes automatically. An unacknowledged one is re-sent every `retryIntervalMs` (20 s), and at once when the answerer comes back. SOS works the same way. Unsent questions can be cancelled.

**SOS** asks once, then broadcasts `SOS — I need help` with your trailing `loc:` line to everyone nearby, so it lands as a pin on their maps. With nobody in range it waits and sends by itself. **Cancel SOS** after sending tells everyone `SOS cancelled — I am OK now`. It never claims to reach emergency services; there is no route to them yet.

The briefing, topics, places and first-aid guides are stored on the phone (`src/content/scenario.ts`), because the hub does not broadcast news or places over the mesh yet. Questions go to the hub for real answers.

## Walk through the demo

Open **Demo controls** at the bottom of the screen to set the story from the design.

1. Type *Where can I charge my phone?* and send it. Watch **Sending**, then **Delivered** after about 0.8 s, then **Answered** about 2.5 s later.
2. In **News**, choose **More known**. *Why?* gets an answer tagged **New**, and *Charge phone* now has 2 places. Ask about charging again and tap **Open map** on the answer.
3. Tap **Water**: the map opens with numbered pins and a list with walk distances.
4. In **Questions**, choose **Not getting through**, then ask something. After 30 s it shows **Not sent yet** and *Not getting through right now*. Choose **Getting through** and it sends by itself.
5. Choose **No answer** to see *No answer this time.* with **Ask again**.
6. Set **Bluetooth** to **Off**: *Bluetooth is off* appears with **Turn on Bluetooth**. Press **SOS**, then **Send SOS**: it waits as *SOS not sent yet*, then goes by itself when you turn Bluetooth back on.
7. Use the **Phone B** buttons to receive a message, a shared location (tap **Open map**), or an SOS.
8. Tap **Family**, pick **Phone B**, and send *I'm OK* or **Send where I am**.

Questions are limited to 200 UTF-8 bytes and messages to people to 255 UTF-8 bytes; the boxes stop accepting text at the limit. The question limit leaves room for an attached location within the mesh's 255-byte message limit.

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
4. Open any place topic and tap **Check for the street map**.

The map reads `pmtiles://file://…/london.pmtiles` directly. Its local style (`src/map/mapStyle.ts`) draws a full offline basemap from the Protomaps vector layers — land cover and land use (woods, parks, urban blocks), water bodies and waterways, building footprints with outlines, admin boundaries, and a road hierarchy (motorway down to paths) with casing and zoom-scaled widths. It requests no remote tiles, fonts, sprites, or styles, so there are no street-name label layers yet (that needs bundled glyph PBFs; pins are native markers with device text). The map is navigable: pan, pinch zoom, rotate and pitch are on, zoom is clamped to z10–z18, and on-map buttons zoom in/out or recenter on the selected position. The basemap uses the design's dark palette, so the numbered white pins stand out. A missing map, an out-of-region position, or a map load failure falls back to the schematic map, with the same pins in the right directions.

Device builds add the real mesh and native map. The simulated link alone does not demonstrate communication between two physical phones. No iOS build or device run was possible on this machine because Xcode is unavailable.

## Configure the transport and backend

`src/config.ts` holds the runtime configuration, ported from `phone/app` (PR #18):

- `transportMode`: `auto` (default) uses the native BitchatMesh module when it is linked and the simulated mesh otherwise. `simulated` always uses the simulated mesh. `native` throws at startup if the module is missing.
- `hubNickname`, `ackTimeoutMs`, `answerTimeoutMs`, `retryIntervalMs`: how Ask finds the hub, how long it waits, and how often it tries again.
- `apiBaseUrl`: the post-MVP live-information backend. It stays `null`, so the app makes no HTTP calls. `src/api/client.ts` fails loudly until it is set.

## Build for Android

`android/` is generated and ignored by git. From `app/`, regenerate it and run it on a device or emulator:

```sh
npx expo prebuild --platform android --clean
npx expo run:android
```

The BitchatMesh native module is iOS-only for now, so the Android build runs on the simulated link with the **Demo** tag visible.

## Run the checks

From `app/`, run:

```sh
npx tsc --noEmit
npx jest --ci
npx expo export --platform web
npx expo config --type prebuild
npx expo config --type introspect
```

The Jest suite reads the app-relevant vectors directly from `../protocol/vectors.json`, including all 48 Ask transitions and the simulated hub's answer composition. Screen tests run the simulated transport with fake timers. They cover the briefing and topics, the delivery states, queueing and automatic retry, cancel, out-of-order answers, byte limits, location attachment, place sheets, first aid, family messages, incoming messages and SOS, and the notices. Expo's `prebuild` config displays the configured plist values; `introspect` also executes the safe plist mods in memory to show their result.

The screens use one runtime context. Mesh peers, conversations, and the latest location per sender live in one event-fed store. Ask timers, sends, and multipart assembly live in a controller outside the pure transition reducer, so a question stays active while sheets open and close; finished questions move to the thread's history. Parts may arrive out of order or more than once; the answer is shown only after all parts and the final label arrive.

Messages and pins last for the current app session. The plain-text protocol has no question id. A stale answer after reset and another submission can belong to the new question, as described in the contract.

The canned demo text uses short paraphrases of [St John Ambulance bleeding guidance](https://www.sja.org.uk/first-aid-advice/severe-bleeding/), [NHS burns guidance](https://www.nhs.uk/conditions/burns-and-scalds/), [NHS carbon monoxide guidance](https://www.nhs.uk/conditions/carbon-monoxide-poisoning/), [FDA food safety during power outages](https://www.fda.gov/food/buy-store-serve-safe-food/food-and-water-safety-during-power-outages-and-floods), and [CDC boil-water guidance](https://www.cdc.gov/natural-disasters/psa-toolkit/boil-water-advisory.html). Demo answers remain labelled as unverified AI advice under the message contract.
