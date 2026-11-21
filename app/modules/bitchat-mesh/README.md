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

Both sends reject text over **255 UTF-8 bytes** with `code === 'MESSAGE_TOO_LONG'` and the actual byte count in the error. The module neither splits nor truncates text. This is the project contract's limit for both channels: BitChat itself limits private content to 255 bytes (`bitchat/Protocols/Packets.swift:251-265`), but its public send guard allows 60,000 Swift characters (`bitchat/Utils/InputValidator.swift:10-14`, `bitchat/Services/BLE/BLEService.swift:846-859`) and its v1 frame allows up to 65,535 encoded payload bytes (`localPackages/BitFoundation/Sources/BitFoundation/BinaryProtocol.swift:137-172`). Compression can use part of that payload limit for an original-length field. The app and hub handle the agreed byte limits and multipart answers; the module sends each supplied message unchanged.

`MESH_STOPPED` rejects a send before start; `INVALID_PEER_ID` rejects anything other than a 16-hex mesh ID or a 64-hex Noise public key; `INVALID_NICKNAME` rejects an invalid BitChat nickname or one over 255 UTF-8 bytes. BitChat's announcement field has that byte limit even when the nickname passes its character-count check (`bitchat/Protocols/Packets.swift:42-50`). The module presents the 16-hex routing ID consistently, even when BitChat delivers couriered mail with a full Noise-key ID. Bluetooth being off and asynchronous radio/delivery errors are reported by state or eventual absence of a reply, not by a delivery promise.

## Source build and fork patch

BitChat is an app target, not a reusable library. The three local podspecs compile separate `BitLogger` and `BitFoundation` modules and the `BitchatMesh` module. The initial fork globs, relative to `ios/`, are `../../../../bitchat/localPackages/BitLogger/Sources/**/*.swift`, `../../../../bitchat/localPackages/BitFoundation/Sources/BitFoundation/**/*.swift`, and the selected paths below `../../../../bitchat/bitchat/` listed in `ios/BitchatMesh.podspec`. CocoaPods' `PathList` only enumerates files inside a pod root; raw `../../..` patterns therefore match nothing. `prepare-sources.js` exposes each selected original file as an individual symlink under `ios/GeneratedSources/` and copies the three patched files there. The plugin runs this step before pods are installed. The podspecs glob the generated paths, and every symlink still points at the checked-out fork. Run `node modules/bitchat-mesh/prepare-sources.js` from `app/` after changing the checkout or patch; generated files are ignored. Do not edit them.

`bitchat-fork.patch` was produced with `git diff` against a scratch checkout at the pinned commit and is applied only to the generated copies. `.gitattributes` exempts that patch from whitespace checks because its context must retain the fork's whitespace. Its hunks:

1. `BLEService.swift` selects BitChat's release/mainnet service UUID in this module's Debug builds, so an Xcode Debug app can discover a stock release peer. It makes the Nostr identity bridge a `Never?` placeholder under `BITCHAT_MESH_EXPO` and omits the Nostr key from favorite notifications. Normal BitChat builds retain their original behavior.
2. `KeychainManager.swift` uses the host app's bundle ID rather than `BitchatApp.bundleID`, and omits the app's Debug-only preview keychain under the module build condition. Normal BitChat builds retain their existing paths.
3. `NostrCarrierPacket.swift` excludes only the `NostrEvent` conversion helpers under the module build condition. The opaque carrier encoding and relaying code remain available to the mesh.

The mesh still compiles the BLE engine, Noise, identity/keychain, routing/outbox, gossip/sync, courier, prekey, board storage, and the models and protocol helpers they reference. It does not compile the BitChat app entry point, views, view models, Nostr implementation, or Arti/Tor. The fork's `Package.swift` declares `swift-secp256k1` 0.24.0 for its Nostr implementation; this selection and patch remove its `P256K` imports, so no SPM dependency or `spm_dependency` call is needed for this pod. `BitFoundation` depends on `BitLogger`; both are local CocoaPods, not remote packages. The mesh pod also declares the Apple frameworks imported by its retained sources, including AVFoundation (`bitchat/Features/voice/VoiceRecorder.swift:2`), UniformTypeIdentifiers and ImageIO (`bitchat/Features/media/ImageUtils.swift:2-3`). BitChat source selection and the generated symlink behavior must still be verified with a real CocoaPods/Xcode build.

## Build and first device check

1. At the repository root, run `git submodule update --init bitchat`. The generated patch is applied to copies; leave the submodule clean. Install the app's npm dependencies; the plugin uses `expo/config-plugins` from the installed Expo package.
2. Add the following line to the app's existing `app.json` `expo.plugins` array, and give the app a unique `expo.ios.bundleIdentifier`:

   ```json
   "./modules/bitchat-mesh/app.plugin.js"
   ```

   Expo autolinks the module under `app/modules/`; `expo-module.config.json` declares the three local podspecs and `BitchatMeshModule`. The plugin preserves existing Bluetooth descriptions/background modes and adds both Bluetooth usage strings and `bluetooth-central`/`bluetooth-peripheral`. The other usage descriptions in BitChat's app plist are for camera, geohash location, microphone and photos, not this text/BLE module. The iOS deployment target must be at least 16.0; Expo SDK 58's generated Podfile defaults to 16.4. If the app targets an older iOS version, run `npx expo install expo-build-properties` and add this additional entry to `expo.plugins`:

   ```json
   ["expo-build-properties", { "ios": { "deploymentTarget": "16.0" } }]
   ```
3. From `app/`, run `npx expo prebuild --platform ios --no-install`, then `cd ios && pod install`. Open the resulting `.xcworkspace` in Xcode. This custom native module requires a development build; Expo Go does not include it. The plugin prepares the source links and patched copies during prebuild; if running `pod install` without prebuild first, run `node ../modules/bitchat-mesh/prepare-sources.js` from `app/ios` first. No change to the BitChat git checkout is needed.
4. In Xcode select the app target, enable automatic signing, choose a team from your free Apple ID, select a unique bundle identifier and each attached iPhone, and build/run. Trust the developer certificate and enable Developer Mode on the phones if prompted. Free personal-team signing expires and needs periodic re-signing.
5. Install the app on two iPhones, enable airplane mode and then turn Bluetooth back on. Grant Bluetooth permission. Confirm both peers appear, exchange public and private messages in both directions, then exchange a private message with a stock release BitChat peer. Restart a peer after establishing a private session and check that messages retained during session replacement arrive. Separately verify the hub's private reply and any multi-hop path; a two-phone direct exchange does not prove either. Run the hub's BitChat build in Release/mainnet mode: unpatched Debug builds use a different BLE service UUID and cannot discover this module.

## Grounding at fork commit `04995f6`

Paths below start at the `bitchat/` submodule root; line numbers are for the **unpatched** commit. The patch changes only the conditional build shape described above.

| BitChat API used | Source |
| --- | --- |
| `KeychainManager`, `makeDefault()` | `bitchat/Services/KeychainManager.swift:62`, `:70` |
| `SecureIdentityStateManager`, `init(_:)` | `bitchat/Identity/SecureIdentityStateManager.swift:156`, `:197` |
| `BLEService`, `init(keychain:idBridge:identityManager:...)`, `centralManager` | `bitchat/Services/BLE/BLEService.swift:182`, `:503`, `:347` |
| `Transport`, `eventDelegate`, `peerEventsDelegate`, `currentPeerSnapshots`, `myPeerID`, `setNickname`, `startServices`, `stopServices`, `isPeerReachable`, `peerNickname`, `sendMessage`, `sendPrivateMessage`, `sendDeliveryAck` | `bitchat/Services/Transport.swift:132`, `:136`, `:138`, `:141`, `:144`, `:146`, `:149`, `:150`, `:155`, `:169`, `:199`, `:201`, `:205` |
| `BLEService.sendMessage(_:mentions:)` and `suspendForPanicReset()` | `bitchat/Services/BLE/BLEService.swift:1490`, `:724` |
| `TransportPeerSnapshot` fields; `TransportPeerEventsDelegate.didUpdatePeerSnapshots` | `bitchat/Services/Transport.swift:8`, `:267`; production callback `bitchat/Services/BLE/BLEService.swift:6985` |
| `TransportEvent`, `TransportEventDelegate.didReceiveTransportEvent`, `.publicMessageReceived`, `.noisePayloadReceived`, `.peerConnected`, `.peerDisconnected`, `.peerListUpdated`, `.peerSnapshotsUpdated`, `.bluetoothStateUpdated` | `bitchat/Services/Transport.swift:68`, `:70`, `:71`, `:78`, `:79`, `:80`, `:81`, `:83`, `:121` |
| `PeerID`, `init(str:)`, `id`, `prefix`, `toShort()`, `routingData`, `isShort`, `isNoiseKeyHex` | `localPackages/BitFoundation/Sources/BitFoundation/PeerID.swift:12`, `:46`, `:52`, `:81`, `:137`, `:191`, `:236`, `:241` |
| `InputValidator.validateNickname`, `Limits.maxMessageLength`; announcement nickname byte limit | `bitchat/Utils/InputValidator.swift:10`, `:14`, `:44`; `bitchat/Protocols/Packets.swift:42-50`; actual public send guard `bitchat/Services/BLE/BLEService.swift:846` |
| `MessageRouter.init(transports:...outboxStore:)`, `sendPrivate`, `courierBecameAvailable`, `markDelivered(_:from:)`, `retrySecurePrivateMessagesAfterAuthentication(for:)`, `flushOutbox(for:)` | `bitchat/Services/MessageRouter.swift:139`, `:192`, `:306`, `:406`, `:592`, `:694`; `MessageOutboxStore.init(keychain:...)` `bitchat/Services/Courier/MessageOutboxStore.swift:145` |
| Router's connected/reachable path uses `Transport.sendPrivateMessage`; BLE queues pending messages, performs the Noise handshake, encrypts, and broadcasts | `bitchat/Services/MessageRouter.swift:201`, `:211`, `:239`; `bitchat/Services/BLE/BLEService.swift:1499`, `:5233`, `:5249`, `:5266` |
| `addPeerAuthenticatedObserver` and the app's retry after a replacement session | `bitchat/Services/Transport.swift:213`; `bitchat/Services/BLE/BLEService.swift:2923`; app usage `bitchat/ViewModels/ChatVerificationCoordinator.swift:259` |
| `NoisePayloadType.privateMessage`, `.readReceipt`, `.delivered`; `PrivateMessagePacket.decode`, `messageID`, `content` | `bitchat/Protocols/BitchatProtocol.swift:76`, `:78-80`; `bitchat/Protocols/Packets.swift:242-244`, `:270` |
| Private packet's 255-byte content limit, and the app's decode plus delivery-ack behavior | `bitchat/Protocols/Packets.swift:251`, `:262`; `bitchat/ViewModels/ChatTransportEventCoordinator.swift:425`, `:433`, `:456` |
| Public packet default v1, 16-bit encoded payload limit, receive limit; compression can add a length field | `localPackages/BitFoundation/Sources/BitFoundation/BitchatPacket.swift:27`; `localPackages/BitFoundation/Sources/BitFoundation/BinaryProtocol.swift:137`, `:168`, `:172`; `bitchat/Services/BLE/BLEPublicMessageHandler.swift:115` |
| Bluetooth manager state event | `bitchat/Services/BLE/BLEService+LinkLayerCentralRole.swift:80` |

## Verification and remaining risks

On this machine, `swiftc -parse ios/*.swift` and `swiftc -typecheck ios/MeshBackend.swift` passed. The latter needed an SDK overlay and an isolated compiler cache: the installed command-line tools have duplicate module maps, and the overlay maps the duplicate `SwiftBridging` map to an empty temporary file without changing the system.

```text
$ npx tsc --noEmit
# exit 0; no output
```

The Node 22 check used this module's `expo-modules-core` 3 types; a separate check against the app's Expo 58 types also passed. The real backend plus 132 generated fork files typechecked in both release and `DEBUG` configurations with separately compiled `BitLogger` and `BitFoundation` modules. An executable using those real sources passed 255/256-byte ASCII and Unicode boundary checks for both sends, invalid nickname and peer ID checks, and stopped-state checks. A second executable used a stub transport and the real private-packet decoder to check peer and message events, ID normalization, self-echo suppression, deduplication, acknowledgements and state changes. The Expo glue typechecked against a stub Expo module; the typechecks used the macOS SDK. An attempt targeting Mac Catalyst stopped at `no such module 'UIKit'`; this machine has no iOS SDK, so iOS-only branches remain uncompiled.

An Expo 58 scratch app ran `npx expo prebuild --platform ios --no-install`: the plugin generated the sources and the plist had both Bluetooth descriptions and background modes while preserving existing settings. Expo autolinking found all three pods and `BitchatMeshModule`; CocoaPods 1.16.2's `PathList` found 3 logger, 22 foundation and 135 mesh Swift files, all with existing targets. Full `pod install`, Xcode linking, code signing and radio behavior could not be run here.

Ranked first-build risks:

1. iOS-only branches, Expo Swift DSL/version compatibility, and CocoaPods linking were not compiled here. Confirm generated Swift sources, iOS 16 target, module provider, and the source symlinks in the first Xcode build.
2. CoreBluetooth authorization, restoration, stop/restart and background lifecycle have not run on iPhone. `running` means the central manager reports powered on; it does not guarantee advertising or delivery.
3. Real two-phone, stock-peer and multi-hop interoperability, Noise sessions, nickname discovery, and router retries/acknowledgements need device checks. In particular, outbox retries can arrive late or more than once; the UI's protocol logic must handle them.
4. The app and hub must apply the updated 255-byte protocol and assemble multipart hub answers. This module rejects oversized messages rather than splitting them.
5. The source subset retains coupled courier/media/board code and may need additional iOS-only dependencies or patch adjustments when the fork advances. The preparation script fails if the patch no longer applies.

Set a **two-hour Xcode/device timebox** starting with the first successful pod install. If, at its end, two of our phones in airplane mode cannot discover each other and exchange a public and a private message in both directions using this backend, switch the `MeshBackend` implementation to Multipeer Connectivity and accept the blueprint's loss of multi-hop and stock-BitChat interoperability. A simulator-only result does not satisfy the gate.
