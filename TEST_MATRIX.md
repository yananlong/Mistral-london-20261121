# Test & eval matrix (single index)

Scope: PRs #10 (phone app), #11 (hub responder), #13 (Android) — all merged on `main`.
Single sources of truth:
- Ask golden cases: `phone/test/golden/ask_cases.json` (phone + hub + e2e all consume this)
- Vision golden cases: `phone/test/golden/cases.json` + `phone/TEST_PLAN.md`
- Wire protocol strings: `hub/responder.py` (ACK/DISCLAIMER/LOC_LINE_RE) == `phone/app/src/transport/SimulatedTransport.ts` + `phone/app/src/locate/locLine.ts` (enforced by `scripts/check_phone_hub_protocol.sh`, `scripts/check_loc_line_compat.py`, `hub/test_contract_phone.py`, `phone/app/__tests__/hubContract.test.ts`)

## Matrix

| # | Test / eval | File | Layer | Runner | Gate | Status |
|---|---|---|---|---|---|---|
| 1 | Ask state machine (12) | `phone/app/__tests__/askStateMachine.test.ts` | unit | `npx jest` (CI) | green | exists (PR #10) |
| 2 | loc: line round-trip (18) | `phone/app/__tests__/locLine.test.ts` | unit | `npx jest` (CI) | green | exists (PR #10) |
| 3 | SimulatedTransport mock hub (7) | `phone/app/__tests__/simulatedTransport.test.ts` | component | `npx jest` (CI) | green | exists (PR #10) |
| 4 | Transport conformance contract | `phone/app/__tests__/transportContract.ts` + `transportConformance.test.ts` | contract (any Transport impl) | `npx jest` (CI) | green before native BitChat module swaps in | NEW (this PR set) |
| 5 | Protocol string parity | `phone/app/__tests__/protocolStrings.test.ts` | contract | `npx jest` (CI) | green | NEW |
| 6 | Phone<->hub contract vs real responder + ask_cases.json | `phone/app/__tests__/hubContract.test.ts` | integration | `npx jest` (CI) | green | NEW |
| 7 | loc: grammar parity battery | `scripts/check_loc_line_compat.py` | contract | `python3` (CI) | exit 0 | NEW |
| 8 | phone/hub string equality | `scripts/check_phone_hub_protocol.sh` | contract | `bash` (CI) | exit 0 | NEW |
| 9 | Hub responder unit tests (21) | `hub/test_responder.py` | component | `python3 -m unittest` (CI + `ssh spark`) | green | exists (PR #11) |
| 10 | Hub P0 extras: concurrency, callback failure, ollama 404/malformed, bad-env no-hang, 413, disclaimer-last | `hub/test_responder_extra.py` | component | `python3 -m unittest` (CI) | green | NEW (needs the 2 small responder.py fixes in this PR) |
| 11 | Hub<->phone cross-language contract | `hub/test_contract_phone.py` | integration | `python3 -m unittest` (CI + `ssh spark`) | ACK/DISCLAIMER/loc parity + case replay | NEW |
| 12 | compare_device_runs.py self-test | `phone/test/selftest_compare.py` | meta | `python3` (CI) | PASS/FAIL/PENDING as expected | NEW |
| 13 | Ask e2e eval on the real Spark model (15 cases x repeat, wait + async) | `hub/eval/run_eval.py` + `hub/eval/score_eval.py` | e2e (on-Spark) | `ssh spark` | gates in score_eval.py: disclaimer 100%, cap 100%, mesh-fit >=95%, 0 dangerous, 0 injection, core 10/10, p50<=30s p95<=90s, delivery 100% | NEW |
| 14 | Ask round-trip latency CSV (demo evidence) | `scripts/ask_roundtrip.py` | e2e (on-Spark) | `ssh spark` | all cases ok + ack_ok | NEW |
| 15 | On-device Ask round trip (airplane mode, both phones, hub-off retry) | BLUEPRINT_1.md demo steps | e2e (on-device) | Xcode/adb + `ssh spark journalctl` | observed + logged per critique.md | manual |
| 16 | Vision golden benchmark + 20-run airplane soak | `phone/TEST_PLAN.md`, `phone/test/golden/cases.json`, EngineBenchmark (iOS/Android) | on-device | Xcode Release / adb | p95/ttft/crash/usable limits per device | exists (TEST_PLAN) |
| 17 | Android build checks (compile, 16 KB .so, AAR contents) + JVM unit tests | `phone/android` + CI workflow | CI | gradle | BUILD SUCCESSFUL | follow-up (PR #13 content is UNCOMPILED) |
| 18 | CI wiring | `.github/workflows/test.yml` | CI | GitHub Actions | green | NEW |

## Known gaps (tracked, not blocking this PR)

- AskScreen routes ack/answer by arrival order, no request IDs (late/duplicate answers misattribute) — fix with request-ID correlation.
- Late answer after timeout is dropped at screen level (demo step 5 path).
- No `.github/workflows` for the Android gradle build yet (needs SDK runner).
- `hub/responder.py` DEFAULT_MODEL `q4_K_M` is not pulled on the Spark; run with `HUB_MODEL=ministral-3:14b-instruct-2512-fp16`.
- 413/400 responses on keep-alive connections can desync the connection (send `Connection: close`).
- callback_url SSRF-ish shapes accepted (allowlist the peer's local-link host).
- callback POST has no retry (single attempt, 30 s timeout).
