# Android install runbook (bitchat-android + on-device Ministral)

Build the app on one dev machine with Android Studio, install it over USB with `adb`, and push the model files
separately. Don't bundle the model into the APK. Do every step that needs internet before the demo goes offline.
Unlike iOS, no account or signing setup is needed: the debug keystore is enough.

Design: the MVP phone app is the React Native app in BLUEPRINT_1.md. Add the `:ministral` library module to that app's
`android/` project (section 3). bitchat-android is forked for its Kotlin mesh code. Until the React Native app exists,
bitchat-android can host `:ministral` for the model benchmark (EngineBenchmark) only.

`<APP_ID>` below is the React Native app's `applicationId`, or `com.bitchat.droid` when bitchat-android is the benchmark host.

## 1. One-time setup per phone (~10 min)

1. Settings > About phone: tap Build number 7 times. Then in Settings > System > Developer options, turn on
   USB debugging.
2. Plug in over USB, accept the "Allow USB debugging" prompt, and check `adb devices` lists the phone.
3. Note the Android version (Settings > About phone). On Android 17 or later, run `adb shell am memory-limiter status`
   and record it ([`phone/TEST_PLAN.md`](../TEST_PLAN.md) step 2; why: `DESIGN_PIXEL9A.md`, "Android 17 app memory limit").
4. Install the offline speech pack while online. In Settings > System > Languages > Speech or On-device recognition
   (the menu path varies by version), download English.

## 2. Build stock bitchat-android (build step 1, and the benchmark host)

Needs JDK 17+ and Android SDK 37. The Gradle wrapper fetches Gradle 9.6.1, and AGP 9.3.1 comes from the project.
```bash
git clone https://github.com/permissionlesstech/bitchat-android.git   # or the team fork
cd bitchat-android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
- The Play Store build and this debug build share the `com.bitchat.droid` application ID but are signed with different keys.
  Uninstall the Play build first (`adb uninstall com.bitchat.droid`, which deletes its data).
- On first launch, grant Bluetooth, location (Android needs it for BLE scanning) and notifications.
- Licence: bitchat-android is GPL-3.0, so any APK built from it with our code must be released under GPL-3.0.

## 3. Add `:ministral` to the host app

React Native app (`android/settings.gradle(.kts)` and `android/app/build.gradle(.kts)`), or bitchat-android
(`settings.gradle.kts`, `app/build.gradle.kts`):
```kotlin
// settings.gradle.kts
include(":ministral")
project(":ministral").projectDir = file("<abs path>/phone/android/ministral")

// app/build.gradle.kts
dependencies { implementation(project(":ministral")) }
```
- **Configure once while online.** CMake fetches llama.cpp b12606 and KleidiAI at configure time (README "Build"). The
  offline alternative is `-DLLAMA_CPP_SOURCE_DIR` in `ministral/build.gradle.kts`.
- **Check the AGP version.** The module uses AGP 9, which compiles Kotlin itself, so don't add
  `org.jetbrains.kotlin.android` to it. If the React Native template is still on AGP 8, add that plugin to the module
  and set its `compileSdk` to the host's.
- **bitchat-android locks dependencies (`LockMode.STRICT`).** After adding the module, rewrite the lock files, for
  example `./gradlew :app:dependencies --write-locks`, or the build fails on the new coroutines and project entries.
- **arm64 only.** `:ministral` builds only arm64-v8a (CMakeLists.txt refuses other ABIs), so it won't run on an x86
  emulator. Test on the Pixel.
- **Host manifest.** Add `RECORD_AUDIO` and the `RecognitionService` `<queries>` entry (README "Using the engine").
- **targetSdk.** bitchat-android targets 37 (Android 17). That is fine for `:ministral`: it loads `libministral_jni.so`
  with `System.loadLibrary` from the APK, which already meets the read-only rule for target-37 apps.
- **Standalone compile check.** Without a host app, `phone/android/` is its own Gradle build. There is no wrapper jar
  committed, so run `gradle wrapper --gradle-version 9.6.1` once, then `./gradlew :ministral:assembleRelease`. Or
  open `phone/android/` in Android Studio.

## 4. Copy the model files onto the phone

1. Download the files once and check them against the table in README.md ("Getting the model files onto the phone"):
   - `Ministral-3-3B-Instruct-2512-Q4_0.gguf`
   - `Ministral-3-3B-Instruct-2512-Q3_K_M.gguf` (backup)
   - `mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf`

   That is about 4.3 GB in total. Run `sha256sum *.gguf`.
2. Launch the app once, then push the files over USB:
   ```bash
   PKG=<APP_ID>
   adb shell mkdir -p /sdcard/Android/data/$PKG/files
   for f in Ministral-3-3B-Instruct-2512-Q4_0.gguf Ministral-3-3B-Instruct-2512-Q3_K_M.gguf \
            mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf; do
     adb push "$f" /sdcard/Android/data/$PKG/files/
   done
   adb shell ls -l /sdcard/Android/data/$PKG/files/   # compare byte sizes
   ```
3. At first start, the app calls `ModelFiles.stageToInternal(context, profile)`. It copies the files into
   `filesDir/models` and needs about twice the free space until the external copies are deleted. Set
   `verifySHA256 = true` for the first load only. The debuggable-build shortcut through `/data/local/tmp` and `run-as`
   is in README.md.
4. Copy the golden set for the benchmark the same way: `adb push` the photos and `cases.json` from
   `phone/test/golden/` into `/sdcard/Android/data/$PKG/files/golden/`.
5. The files survive `adb install -r` reinstalls. They are lost on uninstall, or if `<APP_ID>` or the signing key changes.

## Skip

- Play Store or internal testing track: needs a developer account and internet on the phone.
- Downloading on first launch: breaks the offline demo.
- Bundling the model in the APK: about 2 GB per install, and Android can't mmap compressed assets.

## Sources

- bitchat-android README, `app/build.gradle.kts`, `gradle/libs.versions.toml` and `settings.gradle.kts` at
  https://github.com/permissionlesstech/bitchat-android (main, 0594b60f)
- Android 17 behavior changes: https://developer.android.com/about/versions/17/behavior-changes-all and
  https://developer.android.com/about/versions/17/behavior-changes-17
