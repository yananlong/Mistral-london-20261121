# Ministral 3 3B (vision) on the Pixel 9a: Android wrapper

**The code in this directory is uncompiled and untested.** It was written on a Linux box with no `cmake`, no Android NDK/SDK, no Kotlin compiler and no `adb` (checked: none on PATH, no NDK directory found). The llama.cpp and mtmd calls were checked against the b12606 headers (llama.h, mtmd.h, mtmd-helper.h) only. Expect to fix typos on the first build. Read `DESIGN_PIXEL9A.md` first; its numbers are estimates.

## Layout
```
phone/android/
  DESIGN_PIXEL9A.md
  README.md
  ministral/src/main/cpp/CMakeLists.txt        llama.cpp b12606 (commit e412c6f4...) + JNI lib
  ministral/src/main/cpp/ministral_jni.cpp     engine: one request at a time, abort callback, UTF-8 streaming
  ministral/src/main/java/com/mistral/london/ministral/
    MinistralEngine.kt   public API, JNI bindings, model-file helpers
    DeviceProfile.kt     tiers: full, lean, tight, textOnly, speechOnly
    ImagePrep.kt         EXIF orientation, scale, ARGB_8888 to RGB
    EngineBenchmark.kt   go/no-go harness; same CSV columns as iOS
```
There is no Gradle project here; add `ministral` as a library module to an app. Minimal `ministral/build.gradle.kts` (check versions yourself):
```kotlin
plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "com.mistral.london.ministral"
    compileSdk = 35
    ndkVersion = "27.2.12479018"          // any recent NDK; must be installed
    defaultConfig {
        minSdk = 31                         // createOnDeviceSpeechRecognizer
        ndk { abiFilters += "arm64-v8a" }
        externalNativeBuild { cmake { arguments += listOf("-DANDROID_STL=c++_shared") } }
    }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }
}
dependencies { implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1") }
```
ProGuard/R8: keep `TokenSink`, `NativeResult`, `EngineException` and `MinistralNative` (JNI looks them up by name).

## Build (on a dev machine with internet)
1. Install Android Studio with the NDK and CMake 3.22.1 (SDK Manager).
2. Source: by default CMake fetches llama.cpp at commit `e412c6f468b7b9e0f16f2540244236f8ad68e9ae` (tag b12606, from `git ls-remote`). Offline alternative: `git submodule add https://github.com/ggml-org/llama.cpp phone/android/third_party/llama.cpp && git -C phone/android/third_party/llama.cpp checkout e412c6f468b7b9e0f16f2540244236f8ad68e9ae`, then pass `-DLLAMA_CPP_SOURCE_DIR=<abs path>`.
3. KleidiAI: ggml downloads a pinned archive (v1.32.0 in b12606's CMake) at configure time, so configure once online. `-DMINISTRAL_KLEIDIAI=OFF` disables it (A/B test item).
4. Things most likely to need fixing at first configure: the `mtmd` target is added by `tools/`, which needs `LLAMA_BUILD_TOOLS=ON` (set in our CMake; if it demands `LLAMA_BUILD_COMMON`, flip that to ON); `-march=armv8.6-a+i8mm+dotprod+fp16` via `GGML_CPU_ARM_ARCH`; include paths.
5. The build is for the Pixel 9a (Armv9.2 cores with i8mm). On a CPU without i8mm it will crash with SIGILL.
6. Build and install the app on the phone. Use a debuggable build for the `run-as` route below.

## Getting the model files onto the phone (no internet at the venue)
Do this at home. Files (sizes and hashes from the task spec):
| File | Bytes | SHA-256 |
|---|---|---|
| `Ministral-3-3B-Instruct-2512-Q4_0.gguf` (unsloth) | 2,046,375,200 | bd1eef40a7fdb1ba9728ec977bd4aab40fb76993d6ec37377fd6522703dc88a5 |
| `Ministral-3-3B-Instruct-2512-Q3_K_M.gguf` (unsloth, backup) | 1,795,552,544 | 91489d8d75b0a9e682e2f17ab9f25260ab935cddf6edc8f3510b8c691993c5d5 |
| `mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf` (ggml-org) | about 450 MB | 57af826536cde496dde1e8343b8e72c89fdbd89084d58e18eb391ef34c39c9f2 |

```sh
sha256sum *.gguf                         # compare with the table before pushing
PKG=com.example.yourapp                  # your applicationId
adb shell mkdir -p /sdcard/Android/data/$PKG/files
adb push Ministral-3-3B-Instruct-2512-Q4_0.gguf /sdcard/Android/data/$PKG/files/
adb push Ministral-3-3B-Instruct-2512-Q3_K_M.gguf /sdcard/Android/data/$PKG/files/
adb push mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf /sdcard/Android/data/$PKG/files/
adb shell ls -l /sdcard/Android/data/$PKG/files/        # check the byte sizes
```
Launch the app once before pushing if the directory is refused (Android 11+ restricts `Android/data`; `adb push` normally works, a file manager does not). Then call `ModelFiles.stageToInternal(context, profile)` at first start: it copies the files into `filesDir/models` (needs about 2.5 GB free twice over until you delete the external copies). Reason: mmap over the external storage path may be slow or unreliable (unconfirmed). Use `EngineConfig(profile, modelDir = thatDir)`. Set `verifySHA256 = true` for the first load only (about 10 s per GB).

Debuggable-build alternative that skips external storage: `adb push x.gguf /data/local/tmp/` then `adb shell run-as $PKG cp /data/local/tmp/x.gguf files/models/`.

## Using the engine
```kotlin
val profile = EngineProfile.select(context)                       // from ActivityManager availMem
val dir = ModelFiles.stageToInternal(context, profile)
val engine = MinistralEngine(context, EngineConfig(profile, dir))
engine.bindTo(this)                                               // cancels in onStop; or call engine.onStop()/onStart()
lifecycleScope.launch {
    engine.load { p, label -> /* progress */ }
    val r = engine.generate("What is in this photo?", File(photoPath)) { tok -> runOnUiThread { append(tok) } }
}
```
Add `RECORD_AUDIO` and the `<queries><intent><action android:name="android.speech.RecognitionService"/></intent></queries>` entry for speech (speech wiring is not part of this code).

## Tests
See `DESIGN_PIXEL9A.md` (short pre-app CLI plan) and `phone/TEST_PLAN.md` (shared go/no-go and reference photos, written separately). Run `EngineBenchmark(context, engine).run()` for the CSV.

## Known gaps
- No GPU path by design (Mali; OpenCL backend is Adreno only).
- Cancel during image encode may only take effect after the encode finishes (unconfirmed for b12606's mtmd).
- No speech recognizer code, no BitChat code, no UI.
- `availMem` may overstate usable memory; thresholds are guesses.
- Nothing has been compiled, linked or run.
