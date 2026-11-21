# Running Ministral 3 3B (vision) on the Google Pixel 9a

Status: design only. Nothing here was compiled or run on a Pixel 9a. Every number marked (est) is an estimate, not a measurement.
Code: `ministral/src/main/cpp/` (CMake + JNI) and `ministral/src/main/java/com/mistral/london/ministral/` (Kotlin). iOS counterpart: `phone/ios/DESIGN_IPHONE17.md`.
Runtime: llama.cpp b12606 (tag resolves to commit `e412c6f468b7b9e0f16f2540244236f8ad68e9ae`, from `git ls-remote`), CPU only.

## Facts, sources, and what is unconfirmed

| Item | Finding | Source / status |
|---|---|---|
| SoC | Tensor G4: 1x Cortex-X4 @ 3.1 GHz, 3x Cortex-A720 @ 2.6 GHz, 4x Cortex-A520 @ ~1.9 GHz | GSMArena Pixel 9a review; Android Authority "Tensor G4 explained". Confirmed (secondary sources) |
| Fast cores | X4 + 3x A720 = 4 fast cores. The 4 A520 are slow and would drag a static work split | Derived from the above |
| RAM | 8 GB (128 and 256 GB storage, UFS 3.1) | GSMArena spec list. Confirmed |
| GPU | Mali-G715 MP7 (~940 MHz) | Android Authority. Confirmed |
| dotprod, i8mm, bf16 | Armv9.2 cores (X4, A720, A520) implement them architecturally | Architecture knowledge; NOT confirmed from a Pixel 9a `/proc/cpuinfo`. Check `Features` in step 1 of the test plan |
| SVE2 | The cores can implement SVE2 (128-bit vectors), but whether the Pixel kernel exposes it to apps is NOT confirmed. No source found. llama.cpp's SVE path is not needed for Q4_0 here, so we do not depend on it | Unconfirmed |
| Measured llama.cpp speed on Tensor G4 | None found (searched twice). Closest: Samsung S22 Ultra Q4_0 CPU, ~36 t/s prompt and ~10 t/s decode (older, 7B-class page); OnePlus 13 3B-class, 4 threads, pp512 ~67 t/s and tg128 ~23 t/s (Oryon-class cores, much faster than G4) | Search results only; low confidence |
| Vision-encoder time on CPU | No measurements found | Unconfirmed; estimate below |

### GPU vs CPU: confirmed, with one correction to the premise
- OpenCL backend: `docs/backend/OPENCL.md` at b12606 lists verified devices Adreno 750/810/830/840/X1-85/X2-90 (plus A6x with recent drivers) and an Intel 12700H. Mali is not mentioned. Not usable on the Pixel 9a's Mali.
- Vulkan: `GGML_VULKAN` exists (default OFF). I found no b12606 evidence that Mali-G715 is a supported or fast target, and the "flaky on Mali" claim is not something I could source. Treat as unproven. It also needs the Vulkan SDK and shaderc at build time, and the mmproj encoder would still run via the same backend with the same risk.
- The b12606 Android example (`examples/llama.android`) builds CPU only (arm64-v8a: KleidiAI ON, OpenMP ON).
- Decision: CPU only. `n_gpu_layers = 0`, `mtmd use_gpu = false`. Do not spend time on the GPU before the deadline.
- Consequence: the abort callback works for the language model (llama.h: "currently works only with CPU execution"). It is NOT confirmed that the mtmd image encoder honours it; in b12606 the old `clip.cpp` is gone (`tools/mtmd` now has `mtmd-graph.cpp`, `mtmd-model.cpp`, `models/*`) and I could not read how it sets up its CPU backend. Assume cancel during the image-encode phase only takes effect when encoding finishes (a few seconds). Test it (test plan step 5).

## CPU build flags (b12606, read from the tag)
- `GGML_CPU_KLEIDIAI` (option, default OFF): `docs/build.md` says to enable it for arm64-v8a only; the Android example enables it. It uses dotprod, i8mm, SVE and SME at runtime and falls back automatically. Pixel 9a has no SME. Set ON, but it is an A/B test item (KleidiAI dispatch may or may not beat the built-in repack for Q4_0).
- `GGML_CPU_REPACK` (default ON): runtime repack of Q4_0 into the interleaved Q4_0_N_M layouts. Automatic, no flag needed. This uses the i8mm kernels when they were compiled in (`__ARM_FEATURE_MATMUL_INT8`).
- `GGML_NATIVE` must be OFF when cross-compiling (`docs/android.md`). With it OFF and no `-march`, the compiler baseline is plain armv8-a and the dotprod/i8mm paths are compiled out. So set `GGML_CPU_ARM_ARCH` (a CACHE STRING, default empty, appended as `-march=${GGML_CPU_ARM_ARCH}`): we use `armv8.6-a+i8mm+dotprod+fp16`. Do not add SVE.
- `GGML_OPENMP`: default ON. `docs/android.md` builds with OFF ("OpenMP isn't supported on this path yet"); the llama.android example uses ON. We use OFF plus an explicit ggml threadpool with a core mask (below). OpenMP is a CMake option in our file for an A/B run.
- `GGML_LLAMAFILE=OFF` (not supported on Android), `LLAMA_OPENSSL=OFF`/no curl (no networking in the app).
- `ANDROID_PLATFORM=android-28` is what the doc uses; our module uses minSdk 31 (needed for on-device speech).
- mtmd: `MTMD_VIDEO=OFF` (it wants an ffmpeg binary).

## Backend choice
CPU only, Q4_0 weights (repacked for i8mm), Q8_0 mmproj, 4 threads pinned to the X4 and the three A720 cores.

## Threads and core pinning
- Core numbering on Tensor G4 is probably 0-3 = A520, 4-6 = A720, 7 = X4, but this is NOT confirmed. The JNI code does not assume it: it reads `/sys/devices/system/cpu/cpuN/cpufreq/cpuinfo_max_freq`, sorts descending and takes the top 4. If the files are unreadable (SELinux may deny them to apps; unconfirmed) it does not pin and runs 4 unpinned threads.
- Pinning uses `ggml_threadpool_params.cpumask` with `strict_cpu`, attached by `llama_attach_threadpool`, plus `sched_setaffinity` on the engine thread so the mtmd encoder's threads inherit the mask.
- Why 4, not 8: the A520 cores are roughly a third of an A720 in throughput and would stall a barrier-synchronised matmul. Decode is memory-bandwidth bound, so threads beyond 3 to 4 add little and add heat.
- To tune in test plan step 3: `llama-bench -t 3,4,5` (the pinned set; 5 adds one A520). Keep 4 unless 3 is within 5% (then use 3 for less heat).
- Thread priority: the engine thread uses `Process.THREAD_PRIORITY_FOREGROUND`. No foreground service; the demo is foreground-only and the engine cancels in `onStop`.

## Memory

### How Android treats this (sources: developer.android.com "memory management")
- File-backed mmap'd pages that are clean are "cached" and `kswapd` can drop them; they are re-read from storage on demand. Anonymous and dirty pages go to zRAM, not storage. The foreground app is among the last non-system things lmkd kills, but a foreground kill looks like a crash.
- Native allocations are not subject to the Java heap limit (`largeHeap` is irrelevant). Only system memory pressure matters.
- Important consequence of Q4_0 repack: repacked tensors are written into anonymous buffers, so after load most of the 2 GB of weights is anonymous dirty memory (compressible only partly), not droppable file cache. Assume the full weight size counts against us. Whether the original mmap pages stay mapped after repack was not verified in the source.
- RSS counts mapped file pages; PSS does not double count shared ones. We log `VmRSS` and `VmHWM` from `/proc/self/status` per request.
- `ActivityManager.MemoryInfo.availMem` is the figure the tiers use. I could not confirm whether it includes reclaimable file cache (likely roughly "free + cached"); treat it as optimistic. `lowMemory` and `threshold` are logged too.
- How much a foreground app can really use on an 8 GB Pixel: not found in any source. Typical `totalMem` reads ~7.3 to 7.7 GB. Planning figure (est): 3 to 3.5 GB of anonymous memory is survivable if no other heavy apps run. Measure it (test plan step 2).

### Android 17 app memory limit
- What Android 17 says: it "introduces app memory limits based on the device's total RAM". This applies to all apps, whatever their target SDK. A kill shows in `ApplicationExitInfo` as `REASON_OTHER`, with `MemoryLimiter:AnonSwap` in the description. Source: developer.android.com/about/versions/17/behavior-changes-all.
- What Google doesn't publish: the figure for an 8 GB phone, or what exactly is counted.
- What "AnonSwap" suggests (unconfirmed): anonymous memory is counted. Because of the Q4_0 repack above, that likely includes most of the ~2 GB of weights, as well as the KV cache and compute buffers.
- Commands to check it: `adb shell am memory-limiter status` reads the limit. `adb shell am memory-limiter ignore <uid>` lifts it for diagnosis only.
- If the limiter kills the app:
  - drop a tier (test plan section 6);
  - or load with CPU weight repacking off. Set `llama_model_params.use_extra_bufts = false` (`--no-repack` in the CLI). The weights then stay file-backed mmap pages, which are probably not counted, but decoding is slower. This option is untested here, so measure it before relying on it.
- Keep `targetSdk` at 36 or lower. The target-37 changes are not needed. One of them is that native files loaded with `System.load()` must be read-only.

### Budget (MB, est). KV per token: f16 ~104 KB, q8_0 ~55 KB
| Tier | Weights | Projector | KV | Compute | App | Total (est) | Min availMem |
|---|---|---|---|---|---|---|---|
| full | 2046 | 450 | 436 (f16, 4096) | 450 | 250 | ~3650 | 4300 |
| lean | 2046 | 450 | ~115 (q8_0, 2048) | 300 | 250 | ~3200 | 3800 |
| tight | 1796 | 450 | ~85 (q8_0, 1536) | 220 | 250 | ~2800 | 3300 |
| textOnly | 1796 | 0 | ~115 (q8_0, 2048) | 150 | 250 | ~2300 | 2800 |
| speechOnly | 0 | 0 | 0 | 0 | 200 | ~200 | - |

Thresholds are estimate plus 0.5 to 0.65 GB slack, guesses to be replaced by measurement. App overhead is higher than on iOS (ART heap, UI, camera preview).

### Tiers (chosen at launch from `availMem` before loading; `totalMem` only caps)
| Tier | LM | Projector | n_ctx | KV | batch/ubatch | Image | Max tok | Warmup |
|---|---|---|---|---|---|---|---|---|
| full | Q4_0 | Q8_0 | 4096 | f16 | 512/512 | 640 px, 512 tok | 256 | on |
| lean | Q4_0 | Q8_0 | 2048 | q8_0 + FA | 256/256 | 512 px, 256 tok | 192 | on |
| tight | Q3_K_M | Q8_0 | 1536 | q8_0 + FA | 128/128 | 448 px, 144 tok | 128 | off |
| textOnly | Q3_K_M | none | 2048 | q8_0 + FA | 256/128 | - | 128 | - |
| speechOnly | none | none | - | - | - | - | - | - |

- `full` is never auto-picked on an 8 GB-class phone (`totalMem` < 9.5 GB) until `allowFullOn8GB` is set after measurement. So the Pixel 9a starts at `lean`.
- Image tokens are about (w/28)*(h/28): 640 px ~520 (clamped to 512), 512 px ~330 (clamped to 256 by `image_max_tokens`), 448 px = 256 (clamped to 144), as in the iOS design. The clamp makes mtmd downscale the image internally.
- Q3_K_M is the backup model. Q3_K is not one of the Q4_0-style repacked types, so its per-token speed may be worse than its size suggests. A/B it.
- Warmup on CPU costs one full encode (seconds) at load. Off in `tight` to shorten load; the first request is then slower.
- If the Q4_0 hash or size does not match, load fails closed with a clear error.

## Expected speeds (ESTIMATES, no measurement)
Reasoning: weights ~2 GB, decode is bandwidth-bound; G4's LPDDR5X gives roughly 20 GB/s usable to the CPU cluster, so a ceiling near 10 t/s. Prompt processing is compute-bound with i8mm on 4 cores. The vision encoder (about 0.4 B parameters, Q8_0) needs about 0.8 GFLOP per patch token, and each output token is 4 patches, so 512 image tokens is about 2000 patches, or roughly 1.7 TFLOP.

| Quantity | Estimate |
|---|---|
| Prompt processing, Q4_0, 4 pinned threads | 25 to 45 tok/s |
| Decode | 5 to 9 tok/s |
| Image encode, 640 px / 512 tok | 6 to 12 s |
| Image encode, 512 px / 256 tok | 3 to 6 s |
| Image encode, 448 px / 144 tok | 1.5 to 3 s |
| Warm load (page cache hot) | 4 to 10 s; cold first load from storage 10 to 25 s |

Time to answer (encode + prefill + ~80 to 100 generated tokens), est:
- full: 35 to 50 s
- lean (the Pixel default): 22 to 32 s
- tight: 16 to 24 s
- textOnly (short question, 100 tokens): 12 to 20 s; first token at 3 to 5 s

Throttled runs will be slower by 20 to 40%.

## Heat and cool-down
- The Pixel 9a has no vapor chamber (from memory of the spec sheet; not confirmed here). Sustained 4-core load will throttle.
- Check `PowerManager.getCurrentThermalStatus()` (API 29) before each run; the engine refuses at `THERMAL_STATUS_SEVERE` or worse and logs `MODERATE`. Resume at `LIGHT` or below. `getThermalHeadroom` (API 30) is logged when available.
- Per-tier caps mirror iOS: `maxRunsBeforeCooldown` / `cooldownSeconds`: full 8/60, lean 6/60, tight 5/90, textOnly 8/45. Android runs longer per request than iOS, so the elapsed-time based cap is tighter in practice.
- Stream tokens to the UI; show a stop button and a 45 s deadline (`GenerationOptions.deadline`). Keep the screen at normal brightness, do not charge during runs (charging heats the phone), no case.

## Speech (Android's own on-device recognition)
- `SpeechRecognizer.isOnDeviceRecognitionAvailable(context)` and `createOnDeviceSpeechRecognizer(context)`: API 31 (docs). The create call throws `UnsupportedOperationException` when the check is false.
- `checkRecognitionSupport(intent, executor, callback)` and `triggerModelDownload(intent)`: API 33. The listener variant of `triggerModelDownload` is API 34. The download may prompt the user.
- Needs `RECORD_AUDIO`. Needs `<queries>` for `android.speech.RecognitionService` for apps targeting 30+.
- Language packs must be downloaded BEFORE the venue (no internet). The error `ERROR_LANGUAGE_UNAVAILABLE` (API 31) means "supported but not downloaded". Verify the pack is present in airplane mode, in the test plan.
- Unconfirmed: Pixel 9a ships Android 15 (API 35) and may now run Android 17, so the API exists; whether the on-device service's offline English pack is present on a fresh phone was not verified. Fallback: type the question.
- Memory: the recognizer runs in the Google process, not ours; its memory still competes. Do not run speech and the LLM at the same time.
- Out of scope here: the speech wiring code and BitChat.

## Go/no-go and test plan
The shared go/no-go bar, the reference ("golden") photos and the full test procedure live in `phone/TEST_PLAN.md` (written separately). This file only records what is specific to the Pixel 9a:
- Benchmark output: `EngineBenchmark.kt` writes exactly the shared columns, in this order: timestamp, device, tier, phase, case_id, file, run, maxImageSide, prompt, stopReason, promptTokens, imageTokens, generatedTokens, loadSec, prefillSec, ttftSec, decodeTokPerSec, totalSec, imageEncodeProbeSec, peakFootprintMB, thermal, battery_pct, error, answer, usable. `device` is `pixel9a`; `peakFootprintMB` is peak RSS (VmHWM) in MB; `thermal` is 0 to 3 (NONE 0, LIGHT 1, MODERATE and SEVERE 2, CRITICAL and above 3); `battery_pct` is -1 if unknown; `imageEncodeProbeSec` is -1 if no probe ran; `usable` is left blank for hand marking. Run settings: `phone/test/golden/cases.json`, seed 42, maxNewTokens 128, deadline 60 s, no grammar.
- Pixel pass bar (from `phone/TEST_PLAN.md`): p95 total time at most 35 s, p95 time to first token at most 20 s, 0 crashes in 20 runs, at least 8 of 10 usable. The iOS main-phone bar (p95 15 s) is not realistic for CPU-only vision here: estimated `lean` answers take 22 to 32 s and `tight` 16 to 24 s, so the 35 s and 20 s limits are tight for `lean` and `full` will not meet them. If no vision tier passes, ship the Pixel as textOnly plus speech.
- Also record `VmHWM` and thermal status per run; treat any run that reaches thermal 2 as a warning and `SEVERE` refusals as a failed run.

### Before the app exists (30 minutes, short form)
Cross-build `llama-mtmd-cli` and `llama-bench` on the laptop with the module's flags (building inside Termux would take over 15 minutes). Push them with the models to `/data/local/tmp/ml/` (or Termux home), then in airplane mode:
1. (3 min) `grep -m1 Features /proc/cpuinfo` (record asimddp, i8mm, sve2, bf16); `cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq` (core map); `head -5 /proc/meminfo`.
2. (5 min) `sha256sum` the pushed models; reboot, close apps, record `MemAvailable`; run a text prompt and watch `logcat -b events | grep lmkd`.
3. (8 min) `llama-bench -p 128,512 -n 64 -t 3,4,5` pinned with `taskset` to the fast cores, with and without KleidiAI (two builds). Repeat 3 times to see thermal drop.
4. (7 min) `llama-mtmd-cli` with a test JPEG at three image-token caps (flag name to be checked with `--help`); read the encode and decode timings. This replaces the estimate table.
5. (4 min) Send SIGINT during image encode and during prefill; note the time to stop (decides whether cancel-during-encode is acceptable). Run Q3_K_M for the speed comparison.
6. (3 min) Choose starting tier, thread count, KleidiAI on or off; write thresholds into `DeviceProfile.kt`.

## Risks
1. CPU vision may exceed any sensible time bar (estimates only).
2. Anonymous memory after repack may leave less room than assumed; `availMem` may not reflect reclaimable cache.
3. mmap from the external-storage path goes through FUSE; the engine copies the files into app-internal storage once (see README).
4. Cancel during image encode may not be immediate.
5. All build flags and the Kotlin/JNI code are uncompiled.

## Sources
- Pixel 9a review and specs: https://m.gsmarena.com/google_pixel_9a-review-2825.php
- Tensor G4 explained: https://www.androidauthority.com/google-tensor-g4-explained-everything-you-need-to-know-about-the-pixel-9-processor-3466184/
- llama.cpp b12606: `docs/android.md`, `docs/build.md` (KleidiAI, Android), `docs/backend/OPENCL.md`, `ggml/CMakeLists.txt`, `ggml/src/ggml-cpu/CMakeLists.txt`, `tools/CMakeLists.txt`, `tools/mtmd/CMakeLists.txt`, `examples/llama.android/lib/src/main/cpp/CMakeLists.txt` (github.com/ggml-org/llama.cpp, tag b12606)
- Android memory management: https://developer.android.com/topic/performance/memory-management
- SpeechRecognizer: https://developer.android.com/reference/android/speech/SpeechRecognizer
- Benchmarks of other phones: https://www.mgroeber.de/benchmarking-llamacpp-on-legacy-hardware-2.html, https://huggingface.co/imi2/llama-2-7b-chat-pure-Q4_0-gguf
