# BitchatMesh

An iOS-only Expo local module implementing the `Native mesh module API` in `protocol/README.md`. `MeshBackend.swift` is the Foundation-only seam: another backend can implement it without changing the Expo or TypeScript API. The current implementation uses the team's BitChat fork at `04995f68e470a18d1fc99f86fa326c2a87bab4f2`; it has **not** been built with Xcode or tested on phones here.

## JavaScript use

```ts
import { start, stop, getPeers, sendPublic, sendPrivate, onMessage, onPeers, onState } from './modules/bitchat-mesh';

const subscriptions = [
  onPeers(({ peers }) => { /* replace the current peer list */ }),
  onMessage((message) => { /* inbound messages only */ }),
  onState(({ state, detail }) => { /* update link state */ }),
];
await start('responder');
const peers = await getPeers();
await sendPublic('Hello');
if (peers[0]) await sendPrivate(peers[0].id, 'Hello privately');
// On teardown: subscriptions.forEach((subscription) => subscription.remove()); await stop();
```

The default export also exposes the functions and Expo's typed `addListener('onMessage' | 'onPeers' | 'onState', listener)`. Subscribe before `start` to catch the initial state and peer events. `getPeers()` returns the current snapshot, including known but unreachable peers where the fork retains them. `onMessage` is inbound only; `receivedAt` is local receipt time in milliseconds. Duplicates with the same sender and message ID are suppressed in a bounded, in-memory window. A send resolves when BitChat accepts it into its local send/router path, **not** when the peer receives it. The fork can retain an unreachable private send in its encrypted outbox and retry it when reachability returns.

The coordinator's protocol-v2 decision limits a private message to **255 UTF-8 bytes**. Longer private sends reject with `code === 'MESSAGE_TOO_LONG'` and a message containing the actual byte count. The module neither splits nor truncates text. Public sends reject with the same code when the text exceeds **65,535 UTF-8 bytes** or **60,000 Swift characters**: the latter is the fork's actual `String.count` guard, not UTF-16 length. At the 65,535-byte boundary the module also checks whether BitChat can encode that exact frame, including its compression length field. `MESH_STOPPED` rejects a send before start; `INVALID_PEER_ID` rejects anything other than a 16-hex mesh peer ID; `INVALID_NICKNAME` rejects an invalid BitChat nickname. Bluetooth being off and asynchronous radio/delivery errors are reported by state or eventual absence of a reply, not by a delivery promise.

## Source build and fork patch

BitChat is an app target, not a reusable library. The three local podspecs compile separate `BitLogger` and `BitFoundation` modules and the `BitchatMesh` module. The initial fork globs, relative to `ios/`, are `../../../../bitchat/localPackages/BitLogger/Sources/**/*.swift`, `../../../../bitchat/localPackages/BitFoundation/Sources/BitFoundation/**/*.swift`, and the selected paths below `../../../../bitchat/bitchat/` listed in `ios/BitchatMesh.podspec`. CocoaPods' `PathList` only enumerates files inside a pod root; raw `../../..` patterns therefore match nothing. `prepare-sources.js` exposes each selected original file as an individual symlink under `ios/GeneratedSources/` and copies the three patched files there. The plugin runs this step before pods are installed. The podspecs glob the generated paths, and every symlink still points at the checked-out fork. Run `node modules/bitchat-mesh/prepare-sources.js` from `app/` after changing the checkout or patch; generated files are ignored. Do not edit them.

`bitchat-fork.patch` was produced with `git diff` against a scratch checkout at the pinned commit and is applied only to the generated copies. Its hunks:

1. `BLEService.swift` selects BitChat's release/mainnet service UUID in this module's Debug builds, so an Xcode Debug app can discover a stock release peer. It makes the Nostr identity bridge a `Never?` placeholder under `BITCHAT_MESH_EXPO` and omits the Nostr key from favorite notifications. Normal BitChat builds retain their original behavior.
2. `KeychainManager.swift` uses the host app's bundle ID rather than `BitchatApp.bundleID`, and omits the app's Debug-only preview keychain under the module build condition. Normal BitChat builds retain their existing paths.
3. `NostrCarrierPacket.swift` excludes only the `NostrEvent` conversion helpers under the module build condition. The opaque carrier encoding and relaying code remain available to the mesh.

The mesh still compiles the BLE engine, Noise, identity/keychain, routing/outbox, gossip/sync, courier, prekey, board storage, and the models and protocol helpers they reference. It does not compile the BitChat app entry point, views, view models, Nostr implementation, or Arti/Tor. The fork's `Package.swift` declares `swift-secp256k1` 0.24.0 for its Nostr implementation; this selection and patch remove its `P256K` imports, so no SPM dependency or `spm_dependency` call is needed for this pod. `BitFoundation` depends on `BitLogger`; both are local CocoaPods, not remote packages. BitChat source selection and the generated symlink behavior must still be verified with a real CocoaPods/Xcode build.

## Build and first device check

1. At the repository root, run `git submodule update --init bitchat`. The generated patch is applied to copies; leave the submodule clean. Install the app's npm dependencies, and use `npx expo install @expo/config-plugins expo-build-properties` if the app does not already include them.
2. Add these entries to the app's existing `app.json` `expo.plugins` array (merge with any existing entries), and give the app a unique `expo.ios.bundleIdentifier`:

   ```json
   [
     ["expo-build-properties", { "ios": { "deploymentTarget": "16.0" } }],
     "./modules/bitchat-mesh/app.plugin.js"
   ]
   ```

   Expo autolinks the module under `app/modules/`; `expo-module.config.json` declares the three local podspecs and `BitchatMeshModule`. The plugin preserves existing Bluetooth descriptions/background modes and adds both Bluetooth usage strings and `bluetooth-central`/`bluetooth-peripheral`. The other usage descriptions in BitChat's app plist are for camera, geohash location, microphone and photos, not this text/BLE module.
3. From `app/`, run `npx expo prebuild --platform ios --no-install`, then `cd ios && pod install`. Open the resulting `.xcworkspace` in Xcode. The plugin prepares the source links and patched copies during prebuild; if running `pod install` without prebuild first, run `node ../modules/bitchat-mesh/prepare-sources.js` from `app/ios` first. No change to the BitChat git checkout is needed.
4. In Xcode select the app target, enable automatic signing, choose a team from your free Apple ID, select a unique bundle identifier and each attached iPhone, and build/run. Trust the developer certificate and enable Developer Mode on the phones if prompted. Free personal-team signing expires and needs periodic re-signing.
5. Install the app on two iPhones, enable airplane mode and then turn Bluetooth back on. Grant Bluetooth permission. Confirm both peers appear, exchange public and private messages in both directions, then exchange a private message with a stock release BitChat peer. Separately verify the hub's private reply and any multi-hop path; a two-phone direct exchange does not prove either.

## Grounding at fork commit `04995f6`

Paths below start at the `bitchat/` submodule root; line numbers are for the **unpatched** commit. The patch changes only the conditional build shape described above.

| BitChat API used | Source |
| --- | --- |
| `KeychainManager`, `makeDefault()` | `bitchat/Services/KeychainManager.swift:62`, `:70` |
| `SecureIdentityStateManager`, `init(_:)` | `bitchat/Identity/SecureIdentityStateManager.swift:156`, `:197` |
| `BLEService`, `init(keychain:idBridge:identityManager:...)`, manager state | `bitchat/Services/BLE/BLEService.swift:182`, `:347`, `:503` |
| `Transport`, `eventDelegate`, `peerEventsDelegate`, `currentPeerSnapshots`, `myPeerID`, `setNickname`, `startServices`, `stopServices`, `isPeerReachable`, `peerNickname`, `sendMessage`, `sendPrivateMessage`, `sendDeliveryAck` | `bitchat/Services/Transport.swift:132`, `:134`, `:138`, `:141`, `:144`, `:146`, `:149`, `:150`, `:155`, `:169`, `:199`, `:201`, `:205` |
| `BLEService.suspendForPanicReset()` for closing radio admission on stop | `bitchat/Services/BLE/BLEService.swift:721` |
| `TransportPeerSnapshot` fields; `TransportPeerEventsDelegate.didUpdatePeerSnapshots` | `bitchat/Services/Transport.swift:8`, `:267`; production callback `bitchat/Services/BLE/BLEService.swift:6985` |
| `TransportEvent`, `TransportEventDelegate.didReceiveTransportEvent`, `.publicMessageReceived`, `.noisePayloadReceived`, `.peerConnected`, `.peerDisconnected`, `.peerListUpdated`, `.peerSnapshotsUpdated`, `.bluetoothStateUpdated` | `bitchat/Services/Transport.swift:68`, `:70`, `:71`, `:78`, `:79`, `:80`, `:81`, `:83`, `:121` |
| `PeerID`, `init(str:)`, `id`, `prefix`, `isShort` | `localPackages/BitFoundation/Sources/BitFoundation/PeerID.swift:12`, `:46`, `:52`, `:81`, `:236` |
| `InputValidator.validateNickname`, `Limits.maxMessageLength` | `bitchat/Utils/InputValidator.swift:10`, `:14`, `:44`; actual public send guard `bitchat/Services/BLE/BLEService.swift:846` |
| `MessageRouter.init(transports:...outboxStore:)`, `sendPrivate`, `courierBecameAvailable`, `markDelivered(_:from:)`, `flushOutbox(for:)` | `bitchat/Services/MessageRouter.swift:139`, `:192`, `:306`, `:406`, `:694`; `MessageOutboxStore.init(keychain:...)` `bitchat/Services/Courier/MessageOutboxStore.swift:145` |
| Router's connected/reachable path uses `Transport.sendPrivateMessage`; BLE queues pending messages, performs the Noise handshake, encrypts, and broadcasts | `bitchat/Services/MessageRouter.swift:201`, `:211`, `:239`; `bitchat/Services/BLE/BLEService.swift:1499`, `:5233`, `:5249`, `:5266` |
| `NoisePayloadType.privateMessage`, `.readReceipt`, `.delivered`; `PrivateMessagePacket.decode`, `messageID`, `content` | `bitchat/Protocols/BitchatProtocol.swift:76`, `:78`; `bitchat/Protocols/Packets.swift:242`, `:270` |
| Private packet's 255-byte content limit, and the app's decode plus delivery-ack behavior | `bitchat/Protocols/Packets.swift:251`, `:262`; `bitchat/ViewModels/ChatTransportEventCoordinator.swift:425`, `:433`, `:456` |
| Public packet default v1, 16-bit encoded payload limit, receive limit; compression can add a length field | `localPackages/BitFoundation/Sources/BitFoundation/BitchatPacket.swift:27`; `localPackages/BitFoundation/Sources/BitFoundation/BinaryProtocol.swift:137`, `:168`, `:172`; `bitchat/Services/BLE/BLEPublicMessageHandler.swift:115` |
| Bluetooth manager state event | `bitchat/Services/BLE/BLEService+LinkLayerCentralRole.swift:80` |

## Verification and remaining risks

On this machine: `swiftc -parse ios/*.swift` passed; `swiftc -typecheck` on `MeshBackend.swift` passed with an SDK overlay; `npx tsc --noEmit -p tsconfig.json` exited 0 with no output. An executable built from the real backend and fork sources passed boundary checks for 255/256-byte private messages, multibyte text, public size limits and stopped-state errors. The backend plus 132 generated fork source files typechecked in both release and `DEBUG` configurations with separately compiled `BitLogger`/`BitFoundation` Swift modules. The typecheck used the macOS SDK, not an iOS SDK, and did not compile the Expo glue. The installed command-line tools contain duplicate `SwiftBridging` module maps; the SDK overlay mapped the duplicate `bridging.modulemap` to an empty temporary file, without changing the system. Without that overlay even `import Foundation` fails on this machine. Expo autolinking 3.0.28 found all three pods and `BitchatMeshModule`; CocoaPods 1.16.2's `PathList` found 3 logger, 22 foundation and 135 mesh Swift files, all with existing targets. Full `pod install`, Xcode linking, code signing and radio behavior could not be run here.

Ranked first-build risks:

1. iOS-only branches, Expo Swift DSL/version compatibility, and CocoaPods linking were not compiled here. Confirm generated Swift sources, iOS 16 target, module provider, and the source symlinks in the first Xcode build.
2. CoreBluetooth authorization, restoration, stop/restart and background lifecycle have not run on iPhone. `running` means the central manager reports powered on; it does not guarantee advertising or delivery.
3. Real two-phone, stock-peer and multi-hop interoperability, Noise sessions, nickname discovery, and router retries/acknowledgements need device checks. In particular, outbox retries can arrive late or more than once; the UI's protocol logic must handle them.
4. The public frame near 65,535 bytes and the 60,000-character fork guard need an Xcode/device check. Short text is the intended mesh workload. The app and hub must implement the agreed protocol-v2 byte limits and answer-part handling independently.
5. The source subset retains coupled courier/media/board code and may need additional iOS-only dependencies or patch adjustments when the fork advances. The preparation script fails if the patch no longer applies.

Set a **two-hour Xcode/device timebox** starting with the first successful pod install. If, at its end, two of our phones in airplane mode cannot discover each other and exchange a public and a private message in both directions using this backend, switch the `MeshBackend` implementation to Multipeer Connectivity and accept the blueprint's loss of multi-hop and stock-BitChat interoperability. A simulator-only result does not satisfy the gate.
