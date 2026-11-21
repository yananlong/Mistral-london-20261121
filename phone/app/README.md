# phone/app — the React Native phone app (Talk / Locate / Ask)

Bare React Native + TypeScript skeleton for the offline disaster-mesh app in
this repo (see `PLAN.md` and `BLUEPRINT_1.md` at the repo root). iPhone only.

## What is here

- `src/config.ts` — the one place for runtime configuration: which transport
  to use (`auto` / `simulated` / `native`), the hub peer id, the Ask timeout,
  and `apiBaseUrl` for the post-MVP live backend (null in the offline MVP).
- `src/transport/Transport.ts` — the one small interface the UI sits on
  (PLAN.md section 4): `send(to: peerId | "public", text)`, an incoming-message
  subscription, and a `peers()` view. Data shapes: `Peer`, `MeshMessage`.
- `src/transport/SimulatedTransport.ts` — an in-memory simulated mesh with a
  mock hub implementing the exact two-message protocol from BLUEPRINT_1.md
  (ack "Received. Working on an answer." first, answer after a delay), plus a
  hub-unreachable mode (`hubOnline: false`) that never replies, so the timeout
  state can be exercised. This is what the app runs on until the BitChat
  native module lands.
- `src/transport/NativeTransport.ts` + `nativeBitChatModule.ts` — the seam for
  the real backend: `NativeTransport` adapts the native BitChat module
  (`NativeModules.BitChatMesh`: `send`, `peers`, `bitchatMessage` /
  `bitchatPeers` events) to the same `Transport` interface, and
  `createDefaultTransport()` picks native-when-linked / simulated via
  `config.transportMode`. Pure and unit-tested without the native runtime.
- `src/api/client.ts` — small typed HTTP client for the post-MVP backend
  (live alerts, "I'm safe" relay). Fails loudly while `config.apiBaseUrl` is
  null, so the MVP never makes a network call.
- `src/ask/askStateMachine.ts` — the per-question state machine as pure code:
  `sent -> receivedByHub -> answered`, and `sent -> hubNotReachable` on
  timeout with retry back to `sent`. Timeouts configurable.
- `src/locate/locLine.ts` — format/parse for the `loc: <lat>,<lon>` line.
- `src/locate/tiles.ts` — London demo region, the Web-Mercator tile math, the
  bundled-tile zoom range (z11–z16) and the coverage check.
- `maptiles/london/{z}/{x}/{y}.jpg` — the actual offline map: 393 standard
  OpenStreetMap raster tiles for the London demo region (~15 MB, JPEG q80),
  fetched once by `scripts/fetch_map_tiles.py` (see `maptiles/manifest.json`).
  Add `maptiles/` to the app bundle (Xcode target resources on iOS,
  `android/app/src/main/assets/` on Android — see `../TESTFLIGHT.md`).
  Map data © OpenStreetMap contributors; the map shows the attribution.
- `src/screens/` — Talk (peer list, public channel, 1:1, "no one nearby"),
  Locate (navigable offline map: pan/pinch zoom clamped to the bundled z11–z16
  pyramid, on-map +/− zoom and center-on-me buttons, own position, Share
  location, received pins, attribution, and the no-fix / permission-denied /
  map-not-downloaded states), Ask (suggested questions, free text, optional
  loc: attachment, four states with Retry, AI answer label).
- `src/theme/tokens.ts` — calm palette, 56pt tap targets, high contrast,
  scalable text.
- `__tests__/` — jest tests for the ask state machine, the loc: line round
  trip, and the simulated transport (ack-then-answer and hub-unreachable).

## Map dependency tradeoff

Locate uses `react-native-maps` with a `LocalTile` source for the bundled
London tiles (`maptiles/london/{z}/{x}/{y}.jpg`, standard OSM raster tiles
fetched by `scripts/fetch_map_tiles.py`): one dependency, and it gives the
user-location marker and overlays on Apple Maps for free. The tradeoff vs
maplibre + PMTiles is that PMTiles packs a whole offline region into one
compact file and renders fully custom styles, which scales better for larger
areas; react-native-maps needs a per-tile directory in the bundle. For the
London demo region the simpler dependency wins; switching later only touches
`LocateScreen` + `tiles.ts`. To re-fetch or extend the tiles:
`python3 scripts/fetch_map_tiles.py` (idempotent; throttled, with a proper
User-Agent — do not bulk-download large areas from tile.openstreetmap.org).

## Connecting the real backend

The JS side is ready for the backend to land:

1. Link the native BitChat module registering as `NativeModules.BitChatMesh`
   with the contract in `src/transport/NativeTransport.ts` (`send`, `peers`,
   `addListener` for `bitchatMessage` / `bitchatPeers`).
2. Leave `transportMode: 'auto'` in `src/config.ts` — the app then uses the
   native mesh automatically and falls back to `SimulatedTransport` when it is
   not linked (e.g. in jest or design work). `'simulated'` forces the fake
   mesh; `'native'` throws at startup if the module is missing.
3. Post-MVP HTTP backend (live information, family relay): set
   `config.apiBaseUrl` and call `ApiClient.fromConfig()` — see
   `src/api/client.ts`. The MVP keeps `apiBaseUrl: null` so no question ever
   goes to a network the phone does not have.

## TestFlight

`../TESTFLIGHT.md` is the checklist for shipping this app to TestFlight
(Apple Developer Program, bundle ID, Xcode shell scaffolding, signing,
Info.plist keys, archive/upload, App Store Connect). It lists what is
already done and what is still missing (the Xcode project shell).

## Not in this PR

- The BitChat native module (Xcode wiring, CocoaPods) — the app runs on
  `SimulatedTransport` until then; the `NativeTransport` adapter is the
  ready-made seam for it.
- Real satellite positioning and permission flow (a simulated stand-in is in
  `src/locate/usePosition.ts`).
- React Navigation — tabs are plain state to keep dependencies minimal.

## Commands

```sh
npm install
npx tsc --noEmit   # typecheck
npm test           # jest
npm start          # metro (needs the native project from a later PR)
```
