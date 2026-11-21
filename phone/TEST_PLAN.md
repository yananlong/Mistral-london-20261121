# Shared test plan: Ministral 3 3B Instruct 2512 + vision on phones

Single source of truth for the phone vision tests. `phone/ios/README.md`, `phone/ios/DESIGN_IPHONE17.md` and `phone/android/DESIGN_PIXEL9A.md` point here and do not repeat it.
Deadline: 18:00 UTC, 2026-11-21. Nothing in this file has been run. Every number below is a limit or a plan, not a measurement. Results from this plan are an exploratory team check on a few phones, not evidence of reliability (see `critique.md`).

## 1. What is being tested, and why these photos

The vision model's job in the product is to help a person orient on the offline London map (`BLUEPRINT_1.md`, "Locate"): read a sign, name a station, recognise a landmark, and say honestly when the photo shows nothing useful. The photos in `phone/test/golden/` are chosen for that use. No photo leaves the phone; the hub only ever sees text.

Premise to keep in mind (from the blueprint): GPS and compass already give position and heading. A vision result only counts as "better orientation" if the demo names a case where it helps (indoors, between tall buildings, no GPS fix) and compares against the compass-only baseline. Reading a sign alone does not establish that. This plan tests whether the model answers correctly and fast enough, not whether orientation improves.

## 2. Devices and settings (decided; do not change)

| | iPhone 18 Pro (18 Pro Max also qualifies) | Pixel 9a | iPhone 17 (optional third device) | Reference: DGX Spark or Linux box |
|---|---|---|---|---|
| Role | Primary demo phone | Android demo phone | Optional; only if a phone is free | Sets the expected answers |
| RAM | 12 GB | 8 GB | 8 GB | n/a |
| Language model | Q4_K_M (mistralai) | Q4_0 (unsloth); backup Q3_K_M | Tiers from `DeviceProfile.swift`: lean (Q4_K_M), tight (Q3_K_M); `full` is never auto-picked on iPhone18,3 | Q4_K_M (same file as the 18 Pro) |
| Vision projector | `mmproj-...-Q8_0.gguf` (ggml-org) | same Q8_0 file | same Q8_0 file | same Q8_0 file |
| Backend | Metal | CPU only, llama.cpp b12606 | Metal | CUDA or CPU, `llama-mtmd-cli`, b12606 |
| n_ctx | 4096 | 2048 to 4096 | lean 2048, tight 1536 | 4096 |
| Image max side | 640 px | per `DESIGN_PIXEL9A.md` (lean tier) | lean 512, tight 448 | pre-resized to 640 px |
| Max new tokens | 128 for all comparison runs (see section 4) | same | same | same |
| Time-to-answer limit (p95) | 15 s | 35 s (see section 5) | 25 s | none |
| Settings tier label in CSV | `full` | the Android tier name | `lean` or `tight` | `reference` |
| Device label in CSV and scores.csv | `iphone18pro` | `pixel9a` | `iphone17` | `spark` |

Model files and their SHA-256 (from `DeviceProfile.swift`, `check_model_pair.sh`, `DESIGN_IPHONE17.md`; verify before use):

| File | SHA-256 |
|---|---|
| `Ministral-3-3B-Instruct-2512-Q4_K_M.gguf` (mistralai) | `9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8` |
| `mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf` (ggml-org) | `57af826536cde496dde1e8343b8e72c89fdbd89084d58e18eb391ef34c39c9f2` |
| `Ministral-3-3B-Instruct-2512-Q4_0.gguf` (unsloth) | `bd1eef40a7fdb1ba9728ec977bd4aab40fb76993d6ec37377fd6522703dc88a5` |
| `Ministral-3-3B-Instruct-2512-Q3_K_M.gguf` (unsloth) | `91489d8d75b0a9e682e2f17ab9f25260ab935cddf6edc8f3510b8c691993c5d5` |

Known confound: the Pixel runs Q4_0 and the iPhones run Q4_K_M, and the Pixel's unsloth language model with a ggml-org projector is an untested pairing (`DESIGN_IPHONE17.md`). The Spark's expected answers are therefore a reference for facts, not for wording. A Pixel miss that the Spark also misses is a model limit; a Pixel miss that the Spark gets right points at the quant or the pairing.

## 3. Order of work

Times are budgets, counted from when each owner starts. Work in this order because each step gates the next. The owners are placeholders: `<OWNER-SPARK>`, `<OWNER-IOS>`, `<OWNER-ANDROID>`, `<OWNER-CAPTURE>` (takes the photos), `<SCORER-A>`, `<SCORER-B>`. Fill them in at the start.

1. **Photos, then Spark reference run (`<OWNER-CAPTURE>`, `<OWNER-SPARK>`; about 45 min).**
   - Take the 10 photos by hand (`phone/test/golden/README.md`). Fill in each case's `ground_truth` in `cases.json` from what is physically in front of the camera, not from the model.
   - Copy the originals untouched (EXIF kept) into a folder. Make a pre-oriented 640 px copy for the Spark with `convert in.jpg -auto-orient -resize '640x640>' out.jpg`.
   - Run `scripts/check_model_pair.sh` once to verify hashes and build llama.cpp b12606.
   - For each case, run `llama-mtmd-cli` with the Q4_K_M file and the Q8_0 projector, the shared system prompt, `--temp 0.1 --seed 42 --top-k 40 --top-p 0.95 --repeat-penalty 1.1 --repeat-last-n 64 -n 128 -c 4096`. Flag names are unverified for b12606: check `--help`.
   - Run the rotated case twice, with the EXIF copy and the auto-oriented copy. Expect (unverified) that the CLI ignores EXIF, so the EXIF copy may be wrong on the Spark. That is expected; the orientation fix lives in the phone apps.
   - Two people mark each answer usable or unusable against the case rubric. The Spark answers that are usable become the expected answers. A case the Spark cannot do (fewer than half of 3 repeats usable) is marked `reference_fail` and counts against the model, not the phone; replace the photo if time allows.
   - Save the Spark's raw output and hash list. Gate: at least 8 of 10 usable on the Spark. If the Spark itself is below 8, no phone can pass; fix the prompts or photos first.
2. **First 15 to 30 minutes on each phone (in parallel, `<OWNER-IOS>`, `<OWNER-ANDROID>`).**
   - iPhone 18 Pro and iPhone 17: follow "Test plan on the actual iPhone 17" steps 1 to 4 in `phone/ios/DESIGN_IPHONE17.md`, reduced to: (a) can the app be signed with `com.apple.developer.kernel.increased-memory-limit`; if the install fails, record the exact error and drop the entitlement; (b) log `os_proc_available_memory()` at cold launch, with and without the entitlement, and the `utsname` identifier; (c) load the profile for the device, run one image, record peak footprint; (d) check the encode probe is not a CPU fallback (flag in section 5).
   - Pixel 9a: follow steps 1 to 5 in `phone/android/DESIGN_PIXEL9A.md`. Run the cross-built `llama-mtmd-cli` in Termux (or via `adb shell`) with the Q4_0 model and Q8_0 projector on one golden photo (pre-oriented copy), `-t 4 --temp 0.1`, and read the image-encode and decode timings it logs. Record available memory, `Features` from `/proc/cpuinfo`, and the cancel latency. If the phone runs Android 17 or later, also record `adb shell am memory-limiter status` (Android 17 adds a per-app memory limit based on total RAM, for all apps).
   - Gate before step 3: the model loads, one image answers, no out-of-memory kill. If not, drop one tier (section 6) and repeat this step once.
3. **App benchmark (`<OWNER-IOS>`, `<OWNER-ANDROID>`; about 30 to 45 min per phone).**
   - Copy the 10 JPEGs (EXIF intact) and `cases.json` into the app's `Documents/golden/` (iOS) or the equivalent on Android.
   - Run `EngineBenchmark` on iOS in a Release build, on the real phone, with `Config.device` and `Config.tier` set to the labels in section 2. The Android harness writes the same CSV columns (section 7).
   - It runs a size sweep (info only), one text-only row, then the 20-run soak, and writes `bench-<timestamp>.csv`.
   - Mark each case's answer in `scores.csv` (section 7), blind to the other devices' marks where practical.
4. **20-run airplane-mode soak (`<OWNER-IOS>`, `<OWNER-ANDROID>`; about 15 to 25 min per phone).** This is the go/no-go run and it is the soak phase of step 3's harness, but only counts if the conditions hold:
   - Airplane mode on, Wi-Fi and Bluetooth off (turn Bluetooth on only if the mesh app is part of the test), confirmed on screen and noted in the run log. A model download or any network use makes the run void.
   - Fresh app launch, model loaded once, 20 consecutive runs cycling through the 10 cases, no manual pauses, screen on, not charging, phone not in a case, ambient temperature noted.
   - The CSV must show 20 soak rows. A partial CSV after a crash is a fail.
5. **Demo-day prep (everyone; last 60 min before freeze).**
   - Freeze the tier per device from the results; hard-code it so nobody changes it on stage.
   - Re-hash the model files on each phone (or confirm the app's size check and SHA-256 check passed) and record the hashes.
   - Charge to 100%, then run 3 warm-up queries with the demo photos, in airplane mode. Put the fallback ladder (section 6) in the demo notes.
   - Run `scripts/compare_device_runs.py` on all CSVs and paste its table into the run log. State in the pitch which device ran which tier and which result is measured.

## 4. Same inputs on every device

- **Photos:** the same 10 JPEGs from the same camera, copied byte for byte (compare SHA-256 of each JPEG on each device). EXIF orientation is kept, so the rotated case exercises the orientation fix. The photos are described in `phone/test/golden/cases.json`.
- **Prompts:** exactly the `prompt` strings in `cases.json`. No edits per device.
- **System prompt:** `GenerationOptions.defaultSystemPrompt`: "You are a helpful, concise assistant running offline on a phone. Answer briefly and accurately." Android and the Spark use the same string (`check_model_pair.sh` says it must match the Swift one).
- **Sampling:** the engine's fixed chain: repeat penalty 1.1 over the last 64 tokens, top-k 40, top-p 0.95, temperature 0.1, then the seeded sampler. All runs use seed 42. Temperature 0.1 is not greedy, so different backends can still diverge; do not expect identical text, only comparable facts. No grammar is used (the benchmark passes none), so there is no JSON schema.
- **Limits:** max new tokens 128, deadline 60 s, so a slow phone is recorded as slow rather than cut off at 30 s. A run that hits the deadline counts as a failure.
- **Image size:** each device's own tier (section 2). The sweep also runs 448, 640 and 896 px for information.

## 5. Go/no-go per device

The same four checks for every device, with a per-device time limit.

| Check | iPhone 18 Pro | iPhone 17 (optional) | Pixel 9a |
|---|---|---|---|
| Crashes or out-of-memory kills in the 20-run soak | 0 | 0 | 0 |
| Soak rows present in the CSV | 20 | 20 | 20 |
| Usable answers among the 10 cases | at least 8 | at least 8 | at least 8 |
| CPU-fallback flag (median image-encode probe over 3 s) | none | none | not applicable |
| Time to answer, p95 of `totalSec` in the soak | 15 s or less | 25 s or less | 35 s or less |
| Time to first token, p95 | info | info | 20 s or less |

Notes on each limit:
- **Crash** means: the app died, a jetsam or low-memory kill, a load or generate error, or a run stopped by the deadline or cancelled. A missing soak row after a crash counts as a crash.
- **Usable** means the case rubric in `cases.json` is met by the answer, marked by two people who agree (disagreements go to a third). Use the same 10 cases on every device.
- **CPU-fallback flag (iOS):** the benchmark prints "suspiciously slow: vision encoder on CPU?" when an image-encode probe exceeds 3 s. The compare script flags a device if the median probe exceeds 3 s. A flagged phone gets no vision go until it is fixed or a different projector is tried (the BF16 file, `DESIGN_IPHONE17.md`).
- **iPhone 18 Pro 15 s and iPhone 17 25 s** are the decided bars (the 17 is relaxed because it has less memory and no vapor chamber).
- **Pixel 35 s** is a chosen figure, not a measurement. `DESIGN_PIXEL9A.md` estimates 22 to 32 s per vision answer for the lean tier and 16 to 24 s for tight, because the vision encoder runs on the CPU with no GPU help. A 35 s p95 leaves a few seconds above the top of the lean estimate for the tail and for throttling. It is only acceptable with streamed output and a visible "looking at the image" state, which is why time to first token has its own 20 s limit. If measured medians come in well below the estimate, tighten the limit to measured p95 plus 20%, and write down the change before the soak, not after. Text-only answers on the Pixel keep the original 15 s bar and are measured by the text-only row.

### What happens on a fail (all devices)

1. Drop one tier and repeat the soak once: iPhone 18 Pro `full` to `lean`; iPhone 17 `lean` to `tight`; Pixel to its next tier, ending at the Q3_K_M backup. Record both runs; the passing run needs its own 20-run soak.
2. If every vision tier fails, ship text only on that phone: the model answers typed or transcribed text, and the photo feature is switched off with a clear label.
3. If text-only also fails (or memory refuses to load anything), that phone relies on the hub over the mesh for questions. The hub gets text only. The pitch says the phone has no on-device model.

A failed device is reported as failed. Do not hide it by changing the cases, the limits or the soak conditions after seeing results.

## 6. What to record (per run log, one per device per attempt)

Following `critique.md` ("record device models, OS and app/build versions", model ID, quantization, and the arrangement actually shown, and keep raw results):

- Device model and identifier (for example `iPhone18,3`), RAM, OS version and build, app build or commit, llama.cpp tag (b12606), who ran it and when (UTC).
- Model file names and SHA-256 for the language model and projector, as copied to the phone, and the Spark's.
- Settings tier and the actual settings used (n_ctx, KV type, image side, max new tokens, seed, threads on Android).
- Entitlement state (iOS): with or without `increased-memory-limit`, and whether it signed.
- Available memory before load and after load (`os_proc_available_memory()`, or Android equivalent), and peak footprint (the CSV column).
- Thermal state before the first run and from the CSV (`thermal`: 0 nominal, 1 fair, 2 serious, 3 critical), battery percent at start and end, charging yes or no, case or no case, ambient temperature.
- Airplane mode on (yes or no), Wi-Fi and Bluetooth state, screen brightness.
- Android 17 or later: any kill whose `ApplicationExitInfo` is `REASON_OTHER` with `MemoryLimiter:AnonSwap` in its description is a memory-limiter kill. Log it as its own failure type, separate from a low-memory kill. For a diagnostic rerun only, `adb shell am memory-limiter ignore <uid>` lifts the limit; a run with the limit lifted does not count toward the go/no-go.
- Every attempt, including failed ones and reruns. Keep the raw CSVs; do not delete runs. Say in the report what is measured on the phone, what is from the Spark, and what is an estimate.

CSV columns also carry the per-row values (section 7). The run log carries what the CSV cannot (airplane mode, hashes, entitlement, ambient temperature).

## 7. Output files and the compare script

Benchmark CSV columns, in this order (iOS and Android must match):

`timestamp, device, tier, phase, case_id, file, run, maxImageSide, prompt, stopReason, promptTokens, imageTokens, generatedTokens, loadSec, prefillSec, ttftSec, decodeTokPerSec, totalSec, imageEncodeProbeSec, peakFootprintMB, thermal, battery_pct, error, answer, usable`

- `phase` is `sweep`, `text-only` or `soak`. `usable` is left empty by the app; hand marks go in `scores.csv`.
- `imageEncodeProbeSec` is -1 when no probe was run. `battery_pct` is -1 when unknown. `thermal` is the integer `ProcessInfo.ThermalState` rawValue (0 to 3) or the Android equivalent mapped to the same scale.
- Times are in seconds, `peakFootprintMB` in MB (10^6 bytes).

`scores.csv` columns: `device,case_id,usable,scorer,notes` with `usable` 1 or 0. The device value is the same label as in the CSV.

Compare:

```
python3 -I scripts/compare_device_runs.py bench-iphone18pro.csv bench-pixel9a.csv --scores scores.csv
```

It prints one table row per device and tier: runs, crashes, median and p95 time to answer, p95 time to first token, image-encode median, decode tokens per second, peak memory, hottest thermal state, decode speed drop across the soak, usable count, and a PASS, FAIL or PENDING verdict against the limits at the top of the script. PENDING means a mark or a soak is missing. The limits in the script must match section 5; if you change one, change both.

## 8. Heat and cool-down

- Between sweeps and between devices' tests, let the phone sit until the thermal state is nominal (iOS: `thermalState` reads nominal; Android: surface temperature within 3 C of the start). Minimum 5 minutes after the sweep, before the soak.
- The soak itself is back to back with no pauses, because it is the worst case. The benchmark itself waits 20 s only when the state is critical.
- If a phone fails the soak and thermal state reached serious or critical, rerun it once with the pauses its profile sets (iPhone 17: 60 s after every 8 runs; `maxRunsBeforeCooldown` and `cooldownSeconds` in `DeviceProfile.swift`). Report both results. The paused run can show the phone is usable in the demo with pacing; it does not turn the failed back-to-back soak into a pass.
- Report throttling as: the maximum `thermal` value reached, the first soak run at which it rose above fair, and the decode tokens per second of the first 5 versus the last 5 soak runs (the compare script prints the drop in percent). Over 25% is called throttling in the report. Say whether the limit failure came with throttling.
- Do not use cooling aids (fans, ice packs) in the gating run; note it if used elsewhere.

## 9. Open points

- The iPhone 17 and the Pixel numbers in this plan are estimates until measured; the plan sets limits, not predictions.
- The Pixel's Q4_0 plus ggml-org Q8_0 pairing is untested.
- A photo-taking day before the demo means lighting for the low-light case differs from the stage. Treat that case as a stress test.
- Android CSV writer is owned by the Android work; it must follow section 7 exactly.
