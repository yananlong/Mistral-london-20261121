# Running Ministral 3 3B (vision) on the base iPhone 17

Status: design only. Every number marked (est) is an estimate, not a measurement. Nothing here was run on an iPhone 17.
Code: `MinistralKit/DeviceProfile.swift` (not yet wired into the engine; no swiftc was available to syntax-check it).

## Facts vs assumptions
- Web research, unmeasured: A19, 5-core GPU, 8 GB RAM, no vapor chamber. iPhone 17e has the same RAM.
- One forum report (Apple dev forums 834805): about 6 GB per-app on 12 GB phones even with `increased-memory-limit`. The 8 GB limit is unknown. Assumed 3-4 GB without the entitlement.
- Unknown: whether a free Apple ID can sign the entitlement. Assume it cannot until the first-15-minutes test says otherwise.
- Header check (llama.h, b12606): `llama_context_params` has `type_k`, `type_v`, `flash_attn_type` (AUTO/DISABLED/ENABLED), `n_ubatch`, `offload_kqv`. mtmd params have `warmup`, `image_max_tokens`, `flash_attn_type`. Quantized V cache requires flash attention, so quantized-KV tiers set `ENABLED` explicitly instead of AUTO. Whether Metal FA works with q8_0 K and V for this model is unverified; test at first load and fall back to f16 KV.
- Vision tokens ~ (w/28)*(h/28): 640 px ~ 520 (clamped to 512), 512 px ~ 330, 448 px = 256, 336 px = 144.

## Memory budget (MB, est)
KV per token: f16 104 KB; q8_0 ~55 KB. Compute buffers and app overhead are guesses.

| Tier | Weights | Projector | KV | Compute | App | Total (est) | Min available |
|---|---|---|---|---|---|---|---|
| full | 2150 | 450 | 436 (f16, 4096) | 450 | 200 | ~3700 | 4500 |
| lean | 2150 | 450 | ~115 (q8_0, 2048) | 300 | 200 | ~3250 | 3900 |
| tight | 1796 | 450 | ~85 (q8_0, 1536) | 220 | 200 | ~2750 | 3300 |
| textOnly | 1796 | 0 | ~115 (q8_0, 2048) | 150 | 200 | ~2250 | 2700 |
| speechOnly | 0 | 0 | 0 | 0 | 150 | ~150 | - |

Min available = estimate + 0.55 to 0.8 GB slack. Thresholds are guesses to be replaced by measurement.

## Tiers (chosen at launch from `os_proc_available_memory()` before loading; identifier only caps)
| Tier | LM | Projector | n_ctx | KV | batch/ubatch | Image | Max tok | Warmup |
|---|---|---|---|---|---|---|---|---|
| full (12 GB phones; never auto-picked on iPhone18,3/18,5) | Q4_K_M | Q8_0 | 4096 | f16 | 512/512 | 640 px, 512 tok | 256 | on |
| lean | Q4_K_M | Q8_0 | 2048 | q8_0 + FA | 256/256 | 512 px, 256 tok | 192 | on |
| tight | Q3_K_M | Q8_0 | 1536 | q8_0 + FA | 128/128 | 448 px, 144 tok | 128 | off |
| textOnly | Q3_K_M | none | 2048 | q8_0 + FA | 256/128 | - | 128 | - |
| speechOnly | none | none | - | - | - | - | - | - |

Expected for a 3 GB class: Q4_K_M weights are mmapped so only touched pages count (see below), but treat them as fully resident.
Warmup off saves little memory; it trims the early peak and costs a slower first request. Show a "warming up" state.

## Smaller quants (HF tree API metadata only, nothing downloaded)
| Repo / file | Bytes | SHA-256 (LFS oid) |
|---|---|---|
| unsloth/Ministral-3-3B-Instruct-2512-GGUF `Ministral-3-3B-Instruct-2512-Q3_K_M.gguf` (proposed) | 1,795,552,544 | 91489d8d75b0a9e682e2f17ab9f25260ab935cddf6edc8f3510b8c691993c5d5 |
| unsloth `Ministral-3-3B-Instruct-2512-Q4_0.gguf` | 2,046,375,200 | bd1eef40a7fdb1ba9728ec977bd4aab40fb76993d6ec37377fd6522703dc88a5 |
| unsloth `Ministral-3-3B-Instruct-2512-IQ4_XS.gguf` | 1,959,277,856 | d847cdafe9459948337183eb0eeca2ee3ce0c1aed45066580e01e5751dcf3476 |
| bartowski/mistralai_Ministral-3-3B-Instruct-2512-GGUF `mistralai_Ministral-3-3B-Instruct-2512-Q3_K_M.gguf` | 1,795,553,248 | da25c9b127b69d5aa2a2cafefaf4f4d691264646814e4f1bfad0ca2b71f02f08 |
| bartowski `..-Q4_0.gguf` | 2,046,375,904 | c2993f4b86ddcae94031b2e384169889ceecd51b148ceda30c0f826fcce721c8 |
| bartowski `..-IQ4_XS.gguf` | 1,959,278,560 | 0b5576e556c54bccdf253d5019a5a4d7a7fb755fe50c052c6f59c7d06e03b7e4 |

Notes: Q4_0 and IQ4_XS save only 0.1-0.2 GB versus Q4_K_M, so they are not worth the quality risk. Only Q3_K_M (about 0.35 GB saved) changes a tier. Its quality on vision answers is untested; the hash in `DeviceProfile.swift` is the unsloth one. The mmproj Q8_0 is the one already chosen. Neither repo has a Q8_0 mmproj in the tree (unsloth: BF16/F16/F32; bartowski: bf16/f16), so a smaller projector is not available from these repos.
Make sure the projector pairs with the language model (use scripts/check_model_pair.sh once it exists); an unsloth LM with a ggml-org mmproj is an untested pairing.

## Lowest tier: vision cannot fit
- textOnly: keep OS speech-to-text and run the model on transcribed or typed text. Photo features are disabled with a clear label.
- speechOnly: no model. Show transcripts only.
- Sending photos to the hub over BitChat is NOT realistic. BitChat is a Bluetooth mesh with small packets and low throughput, and a 640 px JPEG is tens of KB, which would need hundreds of fragments and multiple hops. Do not build a demo that depends on it. A text-only caption (a few hundred bytes) is plausible, and even that is untested. Treat the link as unproven.

## Heat and responsiveness
- No vapor chamber, so expect throttling in sustained runs. Check `ProcessInfo.thermalState` before each run.
- Caps per tier are in the profile (`maxRunsBeforeCooldown`, `cooldownSeconds`): full 8 runs / 60 s, lean 6 / 60 s, tight 5 / 90 s. Refuse a run and show "cooling down" at `.serious` or `.critical`; resume at `.fair` or below.
- Stream tokens to the UI as they decode; show the first text at TTFT. Put a stop button and a deadline on every run.
- Cancel the run and release the context on a memory warning (the engine already does this).
- Keep the screen at normal brightness; avoid charging during runs.

## mmap and Metal
- With `use_mmap`, GGUF weights are file-backed pages. On iOS, clean file-backed pages are reclaimable, but the Metal backend wraps them in `MTLBuffer`s. Pages touched by the GPU are accounted to the app's footprint, and the jetsam limit applies to footprint. Dirty or wired GPU allocations (KV cache, compute buffers) are certainly counted.
- I could not verify how much mapped weight memory counts in the footprint for the b12606 Metal path. Do not trust the table above; plan on the full weight size counting.
- Measure on the device: log `os_proc_available_memory()` before load, after model load, after mmproj load, after first image, and after 20 runs, plus `task_vm_info.phys_footprint`. Use Instruments (Allocations plus VM Tracker) once.

## Test plan on the actual iPhone 17
First 15 minutes:
1. (3 min) Build with and without `com.apple.developer.kernel.increased-memory-limit`. Record whether a free Apple ID can sign it (if the install fails, note the error and drop it).
2. (3 min) Log `os_proc_available_memory()` at cold launch with and without the entitlement. Record the identifier from `utsname` (expect `iPhone18,3`).
3. (5 min) Load `lean`, then `full`, and run one image each. Record peak footprint and whether q8_0 KV with FA loads.
4. (4 min) Set the tier thresholds in `DeviceProfile.swift` from measured numbers; decide whether `.full` can be allowed on this device.

Go/no-go (same as the main phone, with one relaxed bar): 20 consecutive runs in airplane mode, 0 crashes, 95th-percentile time to answer at most 25 s (relaxed from 15 s for the iPhone 17 only; the main phone keeps 15 s), at least 8 of 10 answers judged usable. If the no-go bar fails on every vision tier, ship textOnly.

## iPhone 17 Pro, Pro Max and Air
These 12 GB phones use the main phone's default (`full`) profile.

## Identifiers used
iPhone18,3 = iPhone 17; iPhone18,1 = 17 Pro; iPhone18,2 = 17 Pro Max; iPhone18,4 = Air (EveryMac / TheAppleWiki, via search; not run on devices). iPhone18,5 = 17e is single-source and unconfirmed. Unknown identifiers fall back to memory alone.
