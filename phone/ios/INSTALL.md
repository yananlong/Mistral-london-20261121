# iOS install runbook (patched BitChat + on-device Ministral)

Install the patched BitChat from one Mac with Xcode over USB, and copy the model files into the app's
Documents folder separately. Don't bundle the model into the app. Do every step that needs internet before the demo goes offline.

Design: the on-device model lives inside the patched BitChat iOS app. Add MinistralKit and `llama.xcframework`
(b12606) to its iOS target, as README.md section 1 describes. If the React Native app stays separate, the same steps apply to it.

## 1. One-time setup per iPhone (needs internet, ~15 min per phone)

1. Use one Mac and one Apple ID as the build machine for both demo phones. The bundle ID is derived from the team ID,
   so a different Apple ID means a different app with an empty Documents folder.
2. Xcode must support the phone's iOS version. The iPhone 18 Pro ships with iOS 27, so it needs Xcode 27.
   Check under Window > Devices and Simulators.
3. Plug each phone in over USB and accept "Trust This Computer". Then turn on Developer Mode in
   Settings > Privacy & Security; the phone restarts.
4. After the first install, trust the developer on the phone in Settings > General > VPN & Device Management
   (needs internet once).

## 2. Build the patched BitChat

```bash
git submodule update --init bitchat
cd bitchat && cp Configs/Local.xcconfig.example Configs/Local.xcconfig
# set DEVELOPMENT_TEAM = <your team ID>
# bundle ID becomes chat.bitchat.<TEAM>; App Group becomes group.chat.bitchat.<TEAM>
```
- Add MinistralKit as a local package, and add the two Info.plist keys from README.md section 2
  (`UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`) to `bitchat/Info.plist`.
- Run the scheme "bitchat (iOS)" on each phone.
- A free Apple ID (Personal Team) works with limits: the profile lasts 7 days, and each device holds at most
  3 free-provisioned apps.
- App Groups are the likely snag. BitChat's app and its share extension both use `$(APP_GROUP_ID)`
  (`bitchat/bitchat.entitlements`, `bitchatShareExtension/bitchatShareExtension.entitlements`). Forum reports suggest
  personal teams may not support App Groups; this is not confirmed by Apple docs. If signing fails on App Groups, choose one:
  - Remove the share-extension target and the `com.apple.security.application-groups` entitlement in the fork, then check
    the app still launches (it reads the group ID from `bitchat/Info.plist`).
  - Use a paid team ($99) if anyone has one.
- Start without the increased-memory-limit entitlement (it may not be signable with a personal team). The 18 Pro should
  not need it: README.md section 3 estimates ~3 GB for weights and KV plus compute buffers, and one unconfirmed forum
  report puts the 12 GB-iPhone ceiling at ~6 GB. On the iPhone 17, `DESIGN_IPHONE17.md` plans a build with and without
  it; without it, its tiers assume 3-4 GB available.

## 3. Copy the model files onto each phone

1. On the Mac, download and verify the pair once with `scripts/check_model_pair.sh`: Q4_K_M plus the Q8_0 mmproj, ~2.6 GB total.
2. Copy each file into Documents over USB (~1-2 min per phone):
   ```bash
   cd models   # MODEL_DIR used by check_model_pair.sh
   for f in Ministral-3-3B-Instruct-2512-Q4_K_M.gguf mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf; do
     xcrun devicectl device copy to --device <UDID> \
       --domain-type appDataContainer --domain-identifier chat.bitchat.<TEAM> \
       --user mobile --source "$f" --destination "Documents/$f"
   done
   ```
   `devicectl` doesn't copy directories, so loop over the golden photos and `cases.json` from `phone/test/golden/` into
   `Documents/golden/` the same way. `--user mobile` comes from forum posts and is unconfirmed; if it errors, try omitting
   it or using `--user root`. Fallback: Finder > the iPhone > Files tab, then drag the files onto the app.
3. The files survive rebuilds as long as you don't delete the app or change the team or bundle ID.

## Skip

- TestFlight: needs a paid account, an upload and processing, and internet on the phones.
- Download on first launch: breaks the offline demo.
- Bundling the model: every reinstall recopies 2.6 GB.

## Hub Mac

The macOS BitChat build can use "Sign to Run Locally" or the same personal team. It needs none of the phone steps.

## Sources

- https://developer.apple.com/documentation/xcode/interacting-with-devices-using-the-command-line
- https://developer.apple.com/forums/thread/765386
- https://zenn.dev/scenee/articles/df3a6d9fb18465
- https://developer.apple.com/forums/thread/834802
- https://developer.apple.com/forums/thread/127200
- The BitChat README and `Configs/Local.xcconfig.example` in the cole-dorrestein/bitchat fork
