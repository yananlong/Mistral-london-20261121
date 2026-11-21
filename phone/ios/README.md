# MinistralKit (on-device Ministral 3 3B + vision)

> **WARNING: this code has NOT been compiled.** It was written on a Linux box with no Xcode/swiftc,
> checked by hand against the llama.cpp b12606 headers only. Expect a round of compile fixes.
> Header-derived assumptions to verify first: Swift import of the C enums/opaque pointers
> (`LLAMA_LOAD_MODE_MMAP`, `OpaquePointer` for model/context/mtmd types), `mtmd_input_text` memberwise
> init, `OSAllocatedUnfairLock` (iOS 16+).

Files: `MinistralKit/MinistralEngine.swift` (engine), `ImagePrep.swift` (UIImage/CGImage to RGB),
`EngineBenchmark.swift` (go/no-go harness, see section 5). Model pair check on Linux: `scripts/check_model_pair.sh`.

## 1. Add llama.cpp (SwiftPM binary target)

```swift
// Package.swift (local package containing MinistralKit)
.binaryTarget(
    name: "llama",
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b12606/llama-b12606-xcframework.zip",
    checksum: "768161afcf0ad32cba4aa2c865050465400e53c3dfd015543d6c12973618ac4d"),
.target(name: "MinistralKit", dependencies: ["llama"], path: "MinistralKit"),
```
`import llama` exposes llama.h, mtmd.h and mtmd-helper.h. (The checksum above is the sha256 of the zip;
if SwiftPM complains, recompute with `swift package compute-checksum`.) Target iOS 16+.

## 2. Models: Finder file sharing, not bundled

Full install steps (signing, `devicectl` copy): [INSTALL.md](INSTALL.md).

Default pair (in the app's Documents/):
- `Ministral-3-3B-Instruct-2512-Q4_K_M.gguf` (2.15 GB, mistralai repo)
- `mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf` (0.45 GB, ggml-org repo). Default because the BF16
  projector was reported running its vision encoder on CPU (llama.cpp issue 22582, closed, desktop only)
  and Q8_0 saves ~0.4 GB.
- Alternative for answer-quality comparison: `Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf` (0.84 GB).
  Use `EngineConfig(mmprojFile:)` and set `mmprojSHA256` / `mmprojNominalBytes` to match.

Info.plist:
```xml
<key>UIFileSharingEnabled</key><true/>
<key>LSSupportsOpeningDocumentsInPlace</key><true/>
```
Copy the files via Finder (device, Files tab) or the Files app. Sizes are checked at load (+-10% of nominal;
set `modelExactBytes`/`mmprojExactBytes` once you know them). `verifySHA256 = true` streams SHA-256 on first
launch and caches it by size+mtime. Run `scripts/check_model_pair.sh` first: it verifies hashes and tests
both projectors on Linux.

## 3. Memory

Weights ~2.6 GB plus ~0.44 GB f16 KV (4096 ctx) plus compute buffers. The engine refuses to load if
`os_proc_available_memory()` is below file sizes + 1.2 GB. One forum report (Apple forums thread 834805,
a single report, unconfirmed) puts the per-app ceiling on 12 GB iPhones at about 6 GB.
Optional entitlement `com.apple.developer.kernel.increased-memory-limit` (set `<true/>`): it may be
unavailable on a free Apple ID; that is unverified. Test without it first, and watch the peak footprint
column in the benchmark.

## 4. Usage

```swift
let engine = MinistralEngine(config: EngineConfig())
try await engine.load { frac, phase in print(frac, phase) }
let r = try await engine.generate(prompt: "What is in this photo?", image: uiImage, grammar: nil) { print($0, terminator: "") }
engine.cancel()
```
Pass a GBNF string as `grammar` to force JSON. One request at a time (`.busy` otherwise). The engine
cancels on `willResignActive` and refuses work until `didBecomeActive`, cancels on memory warnings (model
stays loaded; `unload()` frees it) and refuses at `.critical` thermal state.
Caveat: llama.h documents the abort callback as CPU-only, so on Metal cancel/deadline take effect between
tokens; an in-flight image encode or prefill batch is not interruptible.

## 5. Benchmark (go/no-go)

Test plan, shared inputs, limits per device, soak conditions and the CSV column list: `../TEST_PLAN.md`.
Reference photos and prompts: `../test/golden/` (`cases.json` plus 10 hand-taken JPEGs, copied to `Documents/golden/`).

```swift
var cfg = EngineBenchmark.Config()
cfg.device = "iphone18pro"; cfg.tier = "full"   // "iphone17" + p95LimitSeconds = 25 for the 17
try await EngineBenchmark(engine: engine, config: cfg).run()   // Release build, real phone
```
Output: `Documents/bench-<timestamp>.csv`, appended row by row (a crash leaves a partial file). Score answers in
`scores.csv` and run `scripts/compare_device_runs.py` for the verdict.

## 6. Fallback order

1. On-device vision (this engine, image + prompt).
2. On-device text only (`image: nil`; also the fallback if projector load fails or memory is tight).
3. Ask the hub (offline DGX Spark over the mesh) when the phone engine fails, is thermally refused, or is not ready.
