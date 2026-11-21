# phone/app — the React Native phone app (Talk / Locate / Ask)

Bare React Native + TypeScript skeleton for the offline disaster-mesh app in
this repo (see `PLAN.md` and `BLUEPRINT_1.md` at the repo root). iPhone only.

## What is here

- `src/transport/Transport.ts` — the one small interface the UI sits on
  (PLAN.md section 4): `send(to: peerId | "public", text)`, an incoming-message
  subscription, and a `peers()` view. Data shapes: `Peer`, `MeshMessage`.
- `src/transport/SimulatedTransport.ts` — an in-memory simulated mesh with a
  mock hub implementing the exact two-message protocol from BLUEPRINT_1.md
  (ack "Received. Working on an answer." first, answer after a delay), plus a
  hub-unreachable mode (`hubOnline: false`) that never replies, so the timeout
  state can be exercised. This is what the app runs on until the BitChat
  native module lands.
- `src/ask/askStateMachine.ts` — the per-question state machine as pure code:
  `sent -> receivedByHub -> answered`, and `sent -> hubNotReachable` on
  timeout with retry back to `sent`. Timeouts configurable.
- `src/locate/locLine.ts` — format/parse for the `loc: <lat>,<lon>` line.
- `src/locate/tiles.ts` — London demo region and the bundled-tiles check.
- `src/screens/` — Talk (peer list, public channel, 1:1, "no one nearby"),
  Locate (offline map, own position, Share location, received pins, and the
  no-fix / permission-denied / map-not-downloaded states), Ask (suggested
  questions, free text, optional loc: attachment, four states with Retry, AI
  answer label).
- `src/theme/tokens.ts` — calm palette, 56pt tap targets, high contrast,
  scalable text.
- `__tests__/` — jest tests for the ask state machine, the loc: line round
  trip, and the simulated transport (ack-then-answer and hub-unreachable).

## Map dependency tradeoff

Locate uses `react-native-maps` with a `LocalTile` source for the bundled
London tiles: one dependency, and it gives the user-location marker and
overlays on Apple Maps for free. The tradeoff vs maplibre + PMTiles is that
PMTiles packs a whole offline region into one compact file and renders fully
custom styles, which scales better for larger areas; react-native-maps needs a
per-tile directory in the bundle. For the London demo region the simpler
dependency wins; switching later only touches `LocateScreen`.

## Not in this PR

- The BitChat native module (Xcode wiring, CocoaPods) — the app runs on
  `SimulatedTransport` until then.
- Real satellite positioning and permission flow (a simulated stand-in is in
  `src/locate/usePosition.ts`).
- The actual London tile download.
- React Navigation — tabs are plain state to keep dependencies minimal.

## Commands

```sh
npm install
npx tsc --noEmit   # typecheck
npm test           # jest
npm start          # metro (needs the native project from a later PR)
```
