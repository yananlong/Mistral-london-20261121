# Android: emulator testing vs real-device demo — what is needed

Two distinct paths. **Emulator for tests now; a real Android phone for the demo.**
Do not use emulator benchmark numbers as demo numbers (emulated CPU is much slower).

Machine facts (verified 2026-11-21): the workspace box has **no** JDK/SDK/node/adb and no
`/dev/kvm`. The **Spark** (`ssh spark`, Linux aarch64) has the Android toolchain at
`~/android-toolchain/sdk` (`source ~/android-toolchain/sdk/env.sh`; also `/usr/bin/adb`),
JDK 17, node/npm, build-tools 37.0.0, platforms android-36/37, NDK, cmake — and **`/dev/kvm`
exists** — but **no `emulator` binary and no `system-images`** yet. The Spark is Linux, so
**Xcode does not exist there** (`xcodebuild: command not found`); iOS builds still need a
real Mac. BitChat has no Linux build, so the BLE mesh peer must be a Mac regardless.

## A. Emulator testing (now)

1. One-time, while online, on the Spark:
   ```bash
   ssh spark 'source ~/android-toolchain/sdk/env.sh && \
     yes | sdkmanager "emulator" "platform-tools" \
       "system-images;android-37;google_apis;x86_64" "platforms;android-37"'
   ```
2. Emulator-capable build of `:ministral` (this PR adds the x86_64 path — the default
   build is arm64-only and would SIGILL on an x86_64 emulator):
   ```bash
   cd phone/android
   gradle wrapper --gradle-version 9.6.1   # once; no wrapper jar is committed
   ./gradlew -PministralEmulator=true :ministral:assembleDebug
   ```
   (`-PministralEmulator=true` adds the `x86_64` abiFilter and `-DMINISTRAL_EMULATOR=ON`,
   which drops the Pixel's `-march=armv8.6-a+i8mm+dotprod+fp16` flag and uses `GGML_NATIVE`.)
3. Create and boot an AVD with enough RAM for the 3B model (KVM is available on the Spark):
   ```bash
   avdmanager create avd -n pixel9a_emu -k "system-images;android-37;google_apis;x86_64" -d pixel_9a
   emulator -avd pixel9a_emu -memory 8192 -gpu swiftshader_indirect -no-snapshot &
   adb wait-for-device
   ```
4. Install the host app (bitchat-android debug build, or the RN app once it has an
   `android/` project — it does not yet) and push the model files:
   ```bash
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   adb push *.gguf /sdcard/Android/data/<APP_ID>/files/    # ~4.3 GB; see phone/android/README.md
   adb push phone/test/golden/ /sdcard/Android/data/<APP_ID>/files/golden/
   ```
5. Run the functional tests/benchmark in the emulator: `EngineBenchmark.run()` writes
   `bench-*.csv` (same 25 columns); pull with `adb pull`. Use it to validate load, vision
   path, CSV contract, airplane-mode behaviour — **not** the p95 latency gates.

## B. Real device for the demo (Pixel 9a)

From `phone/android/INSTALL.md` (unchanged, still the source of truth):

1. Phone: enable Developer options + USB debugging; note Android version; on Android 17+
   record `adb shell am memory-limiter status` (TEST_PLAN.md step 2).
2. Build **without** `-PministralEmulator` (arm64-v8a only) on the Spark, using the SDK there:
   `./gradlew :ministral:assembleRelease` (or host `assembleDebug`), then
   `adb install -r <apk>`.
3. Push the three GGUFs (Q4_0, Q3_K_M backup, mmproj Q8_0 — SHA-256 table in
   `phone/android/README.md`) to `/sdcard/Android/data/<APP_ID>/files/`, verify byte sizes,
   first launch runs `ModelFiles.stageToInternal` (needs ~2x model size free), set
   `verifySHA256 = true` on first load only.
4. Uninstall the Play Store build first (same app ID, different signing key).
5. Demo day: airplane mode on (Bluetooth stays on for the mesh), charge to 100%, warm up
   the model once, re-hash files, freeze the tier.
6. Watch for Android 17 memory-limiter kills: `adb shell dumpsys activity exit-info <pkg>`
   — `REASON_OTHER` + `MemoryLimiter:AnonSwap` is a fail; drop a tier and rerun
   (`am memory-limiter ignore <uid>` is diagnostic-only).

## iOS

Needs a real Mac with Xcode (the Spark is Linux; `xcodebuild` is not present there).
`phone/app` also has no `ios/` native project yet — that is tracked in TEST_MATRIX.md
gaps. Until both exist, the iPhone demo leg uses the stock BitChat app, and the RN app
runs on `SimulatedTransport`.
