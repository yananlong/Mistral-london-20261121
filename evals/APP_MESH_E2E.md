# Eval suite: phone app, mesh transport, end-to-end demo

Scope: `phone/app` (React Native Talk / Locate / Ask), the BitChat mesh (iOS `bitchat` fork, bitchat-android), the phone → hub → phone Ask round trip, and the 3-minute demo in `BLUEPRINT_1.md` "Demo script". Source of truth: `BLUEPRINT_1.md`. Written 2026-11-21 ~16:00 UTC against `main` @ `5c7ec2a`. Deadline 18:00 UTC.

Priorities: **P0** must run before the demo. **P1** if time. **P2** after the hackathon. All numeric thresholds marked *(prov.)* are provisional: the blueprint defers time targets to the evals (BLUEPRINT_1.md:202). Replace them with the rehearsal measurements plus 50 % margin once MESH-03/05 have run.

---

## 0. Repo state at time of writing (checked, not assumed)

| Item | State | Evidence |
| --- | --- | --- |
| Jest suite (`phone/app/__tests__`) | **Not runnable on this box**: no `node`, no `node_modules`. 3 suites, 37 test cases (askStateMachine 12, locLine 18, simulatedTransport 7). Not executed. | `node: command not found`; `ls phone/app/node_modules` empty |
| Hub responder tests | **21/21 pass** (`cd hub && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest`, 1.1 s) | run during this design |
| Phone dataset bundle | 51/51 present files match `manifest.json` sha256 + size. **11 files missing**, including `map/london.pmtiles` (gitignored, `datasets/.gitignore:4`), 3 guide PDFs, 7 `.zim`. | hash check during this design |
| POIs | `london_pois.sqlite`: 21 650 rows = sum of the 9 geojson files. All POIs inside the app's tile bounds (`tiles.ts:26-31`). | python check during this design |
| RN native projects | **No `ios/` or `android/` project** in `phone/app`; app cannot be built for a device yet (`README.md:44-49,57`). | `find phone/app` |
| BitChat native module | **Not present**; `App.tsx` uses `SimulatedTransport` (`TransportContext.tsx:9-11`). | grep for NativeModules: none |
| Mac bridge (BitChat → `POST /ask`) | **Not in this checkout**; `bitchat` submodule is uninitialised (`git submodule status` shows `-04995f6`). | — |
| Position | Simulated: fixed `DEFAULT_FIX` 51.5007,-0.1246 (`usePosition.ts:19`). No GPS. | — |
| Vision in the app | **No camera/vision code in `phone/app`**; vision lives in `phone/ios/MinistralKit` / `phone/android/ministral`. | — |

Consequence: the demo will likely run on a **fallback tier** (section 4.1). The P0 plan below is built so that every tier is tested.

---

## 1. Run order and time budget (P0 only)

| Slot (UTC) | Who | What | IDs |
| --- | --- | --- | --- |
| 16:10–16:20 | any laptop with Node 18+ | `cd phone/app && npm ci && npx tsc --noEmit && npx jest --ci` | APP-00 |
| 16:10–16:35 | mesh pair (2 people, A + B + Mac) | Interop + offline proof + phone→hub | MESH-11, 01, 02, 03, 04 |
| 16:35–17:00 | mesh pair | Relay isolation, size, hub-off/recovery, screen-off relay | MESH-05, 08, 10, 12 |
| 17:00–17:10 | team | Pick demo tier (4.1) from results, set demo timeout, tape floor marks | — |
| 17:15–17:40 | team | 3 timed rehearsals of E2E-01…05, log every run | E2E-* |
| 17:45–17:55 | team | Preflight checklist | PRE-* |

---

## 2. Unit / component tests (Jest, automated)

### 2.1 Existing (keep green)

**APP-00 (P0, automated, ~5 min).** `cd phone/app && npm ci && npx tsc --noEmit && npx jest --ci`. Pass: 3 suites, 37 tests, 0 failures, `tsc` exit 0. Needs Node ≥18 and network for `npm ci` (do it now, before going offline). If `npm ci` cannot run, record "not run" — do not claim green.

Covered today: `transition()` for all four states and ignored events; `AskMachine` timeout/retry/re-arm/dispose with fake timers; `formatLocLine` 5 dp, round-trip at ±90/±180, 9 malformed lines rejected, `findLocLine` in a multi-line question; `SimulatedTransport` ack-then-answer order, exact ack text, answer ends with label, no reply to public/1:1, unsubscribe, peers incl. hub, hub-offline and runtime toggle.

### 2.2 Missing tests (files to create; cases listed, not written)

Infra notes: `.ts` tests run with the current `jest.config.js` (node env, babel preset). Any `.tsx` screen test needs `preset: 'react-native'`, `react-test-renderer@18.2.0`, and a jest mock for `react-native-maps` — budget 30 min, so screen tests are P1/P2. The cheapest route to cover Ask routing is to extract the subscription body in `AskScreen.tsx:49-72` into a pure `src/ask/askRouting.ts` (`routeHubMessage(records, message) → {id, event, answerText?}`) and test that.

#### Ask state machine — `phone/app/__tests__/askStateMachine.edge.test.ts` (P1)

| ID | Input | Expected | Today |
| --- | --- | --- | --- |
| APP-10 | `hubAck` twice | stays `receivedByHub`; no timer armed | passes (onChange fires twice — document it) |
| APP-11 | `answer` twice | stays `answered` | passes |
| APP-12 | timeout → `hubNotReachable`, then late `hubAck` | **decide**: recommend → `receivedByHub` (it did reach the hub) | stays `hubNotReachable`; write as `test.failing` until decided |
| APP-13 | timeout, then late `answer` | recommend → `answered` (don't throw away an answer) | stays `hubNotReachable` → answer lost |
| APP-14 | retry, advance `timeoutMs` | exactly one `hubNotReachable` onChange; no double timer | expected pass |
| APP-15 | `dispose()` then `retry` | no timer armed after dispose | **re-arms** (leak); P2 |

#### Ask routing — `phone/app/__tests__/askRouting.test.ts` (P1; needs the extraction above)

| ID | Input | Expected | Today (`AskScreen.tsx`) |
| --- | --- | --- | --- |
| APP-20 | Q1; ack; answer | Q1 answered with that text | ok |
| APP-21 | Q1, Q2; ack, ack; A1, A2 in order | A1→Q1, A2→Q2 | ok |
| APP-22 | Q1, Q2; answers arrive **A2 then A1** (hub runs `OLLAMA_NUM_PARALLEL=4`, a short question can finish first) | each answer on its own question | **misattributes** (FIFO, `AskScreen.tsx:54-59`); `test.failing`. Demo rule: one question outstanding at a time |
| APP-23 | ack text with trailing `\n` or spaces | treated as ack | **treated as answer** (exact `===`, `AskScreen.tsx:53`) |
| APP-24 | hub error answer `The hub could not answer right now (...). Please retry your question.` (`responder.py:248-253`) | shown with Retry, not as a green "Answered" | shown as **Answered** |
| APP-25 | Q1 times out, user retries, hub answers both the original and the retry | second answer not attached to a newer Q | attaches to next `sent`/`receivedByHub` question |
| APP-26 | message from a non-hub peer | ignored | ok (`from !== HUB_PEER_ID`) |
| APP-27 | 1 300-char multi-line answer ending with the label | stored whole, label not doubled | ok; **if the bridge splits it into 2 messages, part 2 misroutes** — case documents it |
| APP-28 | retry | resends byte-identical payload incl. `\nloc: …` | ok (`AskScreen.tsx:108-111`) |
| APP-29 | attach on + fix / attach on + no fix / attach off | `q\nloc: 51.50070,-0.12460` / `q` / `q` | ok |

#### Transport contract — shared suite (P1, highest-value new file)

Files: `phone/app/__tests__/contract/transportContract.ts` (exports `runTransportContract(makeTransport, env)`; plain async functions + a tiny `assert`, **no jest globals**, so the same file can be run on a device), `phone/app/__tests__/simulatedTransport.contract.test.ts` (runs it in Jest), later `phone/app/src/dev/TransportSelfTest.tsx` (hidden dev screen that runs it against the native BitChat module with a real hub and a second phone — P1 once the module exists). `env` provides: `hubId()`, `echoPeerId` (a phone or hub echo mode that sends back what it gets), `waitMs`.

| ID | Case | Pass |
| --- | --- | --- |
| T-01 | `send(peer, text)` returns `{from: SELF, to, text, timestamp}` with `text` byte-identical | equal |
| T-02 | ids unique over 100 sends; incoming ids stable across relays (Locate dedupes on `message.id`, `LocateScreen.tsx:28`) | no dup |
| T-03 | multi-line text: `\n` preserved end to end (the `loc:` line depends on it) | hub/echo sees 2 lines |
| T-04 | UTF-8: `é`, `ñ`, `—`, emoji | identical |
| T-05 | 1 300-char payload arrives as **one** message, intact (hub cap 1 200 + label, `hub/README.md:100`) | length + content equal |
| T-06 | own sends are **not** echoed to subscribers (TalkScreen appends its own copy, `TalkScreen.tsx` `send()`) | 0 echoes |
| T-07 | two subscribers each get each message once; unsubscribe inside a handler is safe | counts |
| T-08 | `peers()` returns copies; exactly one `kind: 'hub'` when the hub is up, and its id is what `send()` accepts | — |
| T-09 | hub protocol: ack text exactly `Received. Working on an answer.`, then answer ending with the label | order + text |
| T-10 | hub down: no message within `waitMs` | 0 |
| T-11 | timestamps non-decreasing per sender | — |

Contract decisions the native module forces (resolve before writing T-*, owner: Qubula + Yanan):
1. `send` is synchronous and cannot fail (`Transport.ts:37`); BitChat send is async. Proposal: `send(): Promise<MeshMessage>` or a `status` field.
2. No peer-change event (`Transport.ts:35-42`); Talk only refreshes peers when a message arrives (`TalkScreen.tsx:34`). Add `subscribePeers`.
3. Hub identity: the app hard-codes `HUB_PEER_ID = 'hub'` from the simulator (`AskScreen.tsx:18`). BitChat peer ids are not `'hub'` and can change across restarts; the module must map the hub (by nickname/fingerprint) to `kind: 'hub'`.
4. Echo semantics (T-06) and message-id semantics (T-02).

#### Locate — `phone/app/__tests__/tiles.test.ts` (P1, 10 min, no infra)

| ID | Input | Expected |
| --- | --- | --- |
| APP-50 | corners `(51.28,-0.52)`, `(51.72,0.34)` | `bundledTilesCover` true (inclusive) |
| APP-51 | `(51.2799,-0.1)`, `(51.5,0.3401)` | false ("Map not downloaded for this area") |
| APP-52 | `DEFAULT_FIX`, `LONDON_REGION` centre | true |
| APP-53 | every POI in `datasets/phone/pois/*.geojson` | true (already verified by script: 0 outside) |

#### loc: parity phone ↔ hub — `phone/test/loc_vectors.json` + `phone/app/__tests__/locLineParity.test.ts` + `hub/test_loc_parity.py` (P2)

Same vectors through `parseLocLine` and `responder.parse_question`. Known divergences to pin: `Loc: 51.5,-0.1` (hub accepts, case-insensitive `responder.py:52`; app rejects), `loc: 5e1,0` and `loc: +51.5,0` (app accepts via `Number()`; hub regex rejects). App output is always `formatLocLine` 5 dp, so no demo impact.

#### Talk / Locate / Ask screens — `phone/app/__tests__/screens/*.test.tsx` (P1, needs RN jest preset)

| ID | Case | Today |
| --- | --- | --- |
| APP-40 | no phone peers → "No one nearby"; public messages still visible | **public messages hidden** when no phone peers (`TalkScreen.tsx:86`) |
| APP-41 | peer sends to public → bubble in Public | needs `SimulatedTransport.injectIncoming(from,to,text)` — simulator has no way to receive phone-to-phone messages |
| APP-42 | 1:1 filter shows only that conversation | — |
| APP-43 | Locate: incoming `loc:` message → one pin, duplicate id → still one | ok by code |
| APP-44 | **tab switch keeps state**: ask, switch to Talk, answer arrives, switch back → answered | **fails**: tabs unmount (`App.tsx:56-58`), Ask items, Talk history and Locate pins are lost and messages arriving on another tab are dropped |
| APP-45 | `usePosition` pending → fix after `fixDelayMs`; `denied` | — |

#### POI lookup (P2)

No POI code in the app. When `src/locate/poi.ts` lands: `__tests__/poiLookup.test.ts` — nearest k in category from a point (water/aed/shelter), empty category, point outside bounds, sqlite index `pois_cat_lat_lon` used. Data integrity (P1, runnable now, no repo change):

```bash
cd /home/mistral-london && python3 -I - <<'EOF'
import json,glob,hashlib,os,sqlite3
m=json.load(open('datasets/phone/manifest.json'))
miss=[f['path'] for f in m['files'] if not os.path.exists('datasets/phone/'+f['path'])]
bad=[f['path'] for f in m['files'] if f['path'] not in miss and hashlib.sha256(open('datasets/phone/'+f['path'],'rb').read()).hexdigest()!=f['sha256']]
n=sum(len(json.load(open(p))['features']) for p in glob.glob('datasets/phone/pois/*.geojson'))
rows=sqlite3.connect('datasets/phone/pois/london_pois.sqlite').execute('select count(*) from pois').fetchone()[0]
print('missing',miss,'\nbad',bad,'\ngeojson',n,'sqlite',rows)
EOF
```
Pass: `bad []`, `geojson == sqlite` (21 650). `missing` must not contain `map/london.pmtiles` on the demo phones if Locate shows the map.

---

## 3. Mesh tests on real devices (manual)

Devices: **A** iPhone 18 Pro Max (primary), **B** Pixel 9a, **C** third phone for relay tests (iPhone 17 or any spare), **H** = hub = Mac running the team-fork BitChat peer + Spark (`responder.py` + Ollama) on the local link. Record for every test: device, OS version, app + build (App Store / Play / fork commit), BitChat nickname, time. Message text always carries an id and clock time, e.g. `m01 16:22:05`, so latency and duplicates can be read off the receiver.

Builds under test, in order of what exists: **S** = stock BitChat iOS + stock bitchat-android; **F** = team fork iOS build / Mac hub build; **R** = RN app with native module (only if it lands). Run each test on S first; rerun the P0 ones on F/R if those exist.

| ID | P | What | Procedure | Pass |
| --- | --- | --- | --- | --- |
| MESH-11 | P0 | Offline proof (do first, keep for all tests) | A: Control Centre → Airplane on, then Bluetooth on, **Wi-Fi off** (iOS keeps Wi-Fi on in airplane mode if it was re-enabled before). B: Quick Settings same; `adb shell settings get global airplane_mode_on` → `1`; `adb shell ping -c1 -W2 1.1.1.1` fails; `adb shell dumpsys bluetooth_manager \| grep -m1 -i state` → ON. Mac: `networksetup -getairportpower en0` → Off; `curl -m3 -sS https://api.mistral.ai` fails; only the local link to Spark is up. Spark: `ip route \| grep default` empty; `curl -m3 -sS https://ollama.com` fails; `ollama list` shows `ministral-3:14b-instruct-2512-fp16` (not `:cloud`). Screenshot each. | all checks as stated |
| MESH-01 | P0 | **iOS ↔ Android interop** (unverified) | A, B 1–2 m apart, S builds, app in foreground. 10 public msgs A→B, 10 B→A. Then open a private chat A↔B, 5 each way. Then repeat 3+3 with A on F build if it exists. | public ≥9/10 each way; private 5/5 each way; each ≤10 s *(prov.)* |
| MESH-02 | P0 | iOS ↔ iOS baseline | A↔C, 5 public + 3 private each way. Isolates Android-specific failures. | 5/5, 3/3 |
| MESH-03 | P0 | Phone → hub direct, iOS (build order step 3) | A 2 m from Mac. Private msg to the hub peer: `How do I make water safe to drink? m03a <time>`. Stopwatch from send. Watch `journalctl -u ollama -f` on Spark and responder log. Repeat 3× with fresh text; 1× with `\nloc: 51.50070,-0.12460`. | ack text exact; ack ≤10 s *(prov.)*; answer ≤60 s *(prov.)*; answer ends with label; a new `POST "/api/chat"` 200 line in the Ollama log between send and answer; responder logs `answered <sender>`; the loc run shows the location reached the model (responder strips the line) |
| MESH-04 | P0 | Phone → hub direct, Android | as MESH-03 from B (Android private messaging into the Mac fork build). | as MESH-03 |
| MESH-05 | P0 | **Relay A → B → H** (demo step 4) | Mark positions: H in another room / behind ≥2 walls; B between. **B off test:** B Bluetooth off, A sends `m05-off-n` to H, wait 60 s. **B on test:** B on, wait for peers to settle (≤30 s), A sends `m05-on-n`. 3 rounds, fresh ids, same placement, no other BitChat device on (ask nearby teams; check A's peer list). | B off: 0/3 acks; B on: 3/3 acks; ack ≤20 s, answer ≤75 s *(prov.)*. If B-off still gets acks, the path is **direct**: move H further and repeat once; else say "direct / unverified path" on stage (critique.md:37) |
| MESH-08 | P0 | Size / fragmentation (hub answers ≤1 200 chars + label) | Generate payloads on the Mac: `python3 -c "import sys;n=int(sys.argv[1]);s=''.join(f'[{i:04d}]' for i in range(n//6+1));print(s[:n-4]+'END.')" 1300 \| pbcopy`. Paste into the Mac BitChat private chat to A, then to B. Sizes: 250, 500, 1000, 1300, 2000. Also ask the hub `List 15 things for an emergency kit, one sentence each.` to get a real capped answer. Repeat 1300 via relay B. | each arrives as **one** message ending in `END.`, no missing `[nnnn]` block; real answer arrives whole with the label. Fail at size N → set `HUB_MAX_ANSWER_CHARS` to N−150 on the Spark and rerun 1 300 → new cap |
| MESH-10 | P0 | Hub unreachable + recovery (demo step 5) | Turn off Bluetooth **on the Mac** (the BitChat peer; the Spark's radio is irrelevant). A asks. Wait 45 s: no ack (S: no reply; R: "Hub not reachable" at the app timeout). Mac Bluetooth on; start stopwatch; A retries every 10 s until ack. Then wait 2 min and count answers. | no ack while off; **recovery time** recorded (= demo wait before retry); exactly 1 answer per question that reached the hub. Record any late delivery of the "off" question (store-and-forward) — it produces a duplicate answer and breaks APP-25 |
| MESH-12 | P0 | Relay with screen off | Repeat 1 round of MESH-05 "B on" with B's screen off (app backgrounded), then with A locked while waiting for the answer. | record pass/fail; if fail, preflight forces screens on (PRE-05) |
| MESH-09 | P1 | Latency | 10 pings A→B direct, 10 A→H direct, 5 A→B→H. Receiver writes arrival time. | report p50/max; direct p50 ≤3 s, relay p50 ≤10 s *(prov.)* |
| MESH-06 | P1 | 2-hop relay via third phone | A … C … B … H in a line, each pair in range, A–B and A–H isolated (same B-off/C-off method). | 3/3 with all on, 0/3 with C off |
| MESH-07 | P1 | Range / walls | A fixed, B walks away in 2 m steps, 1 msg per step, line of sight, then through 1 wall. | record max reliable distance (3/3) for each |
| MESH-13 | P1 | Two askers at once | A and B ask the hub within 2 s of each other. | each gets its own answer (private routing by sender); Ollama log shows 2 runs |
| MESH-14 | P1 | Hub restart identity | Quit and relaunch BitChat on the Mac; A messages the hub without re-pairing. | works within recovery time; note if the hub's peer id/nickname changes (affects contract decision 3) |
| MESH-15 | P1 | Contract on device | When the native module lands: run `TransportSelfTest` (T-01…T-11) on A and on B with H up and C as echo peer. | all pass |
| MESH-16 | P2 | Soak | 30 min, 1 ask per minute via relay, phones on battery. | ≥28/30 answered; battery drop recorded |

Evidence log (one row per attempt, per critique.md:67) — keep as a shared sheet/CSV:

```
run_id,utc_time,test_id,tier,A_dev/os/build,B_dev/os/build,hub_build,model_tag,path(direct|relay-verified|unverified),manual_step(none|...),t_send,t_ack,t_answer,ollama_log_ts,retries,timeouts,dups_or_late,answer_ends_with_label,notes
```

---

## 4. End-to-end demo rehearsal (manual, P0)

### 4.1 Demo tier (decide at 17:00 from section 3 results; say the tier on stage)

| Tier | Talk / Ask on phones | Locate | Condition |
| --- | --- | --- | --- |
| T1 | RN app with native BitChat module on A and B | RN app | module landed + MESH-15 pass |
| T2 | Stock BitChat on A (iOS) and B (bitchat-android); hub answers plain text (designed for this, BLUEPRINT_1.md:66) | RN app on simulated link (simulator or device), disclosed as simulated; position disclosed as simulated (`usePosition.ts:19`) | MESH-01/03/05 pass |
| T3 | As T2 but A and C (both iPhones); say Android interop was not shown | as T2 | MESH-01 fails, MESH-02 passes |
| T4 | Mac bridge missing: a person copies the question from Mac BitChat into `curl … /ask` with `"wait":true` and pastes the answer back. Say which step is manual (critique.md:36). | as T2 | Mac bridge not ready |
| T5 | Recorded screen video of the best rehearsal + live `curl -X POST http://10.0.0.2:8080/ask -d '{"sender":"judge","question":"…","wait":true}'` on the Spark with the Ollama log | — | nothing live works |

"Hub not reachable" (step 5) exists only in the RN app. On T2–T4, step 5 shows "no reply from the hub" in stock BitChat; say so, or show the state on the RN simulated link.

### 4.2 Scripted acceptance test (target 3:00, hard cap 3:15)

Roles: **N** narrator, **OA** operates A, **OB** operates B, **OH** at Mac/Spark, **T** timekeeper filling the evidence log. Before start: A on Ask, B on **Locate** (tab switch drops pins and answers, `App.tsx:56-58`), H at its tape mark, journalctl visible in large font.

| ID | Time | Step (BLUEPRINT_1.md:137-141) | Pass criteria | Fallback |
| --- | --- | --- | --- | --- |
| E2E-01 | 0:00–0:25 | Show setup: A and B airplane + BT on; hub offline; `journalctl -u ollama -f` open | Airplane icon + BT icon + Wi-Fi off visible on both phones (camera/mirror); `ollama ps` shows the fp16 tag; Spark has no default route (PRE-03 screenshot) | Show the PRE-03 screenshots taken 15 min earlier |
| E2E-02 | 0:25–0:50 | A sends a message to B | Arrives on B ≤10 s *(prov.)*, text identical | Resend once at 0:40; then send B→A; then (T3) A→C, saying Android was not shown |
| E2E-03 | 0:50–1:30 | A opens map, position, vision orientation, Share location → pin on B | Pin appears on B ≤10 s at the right place; position source stated honestly (simulated unless GPS landed); vision beat **only if** `phone/TEST_PLAN.md` gate passed, else skip and say so | If no pin: show the `loc: …` text arriving on B in BitChat (T2) and the pin on the simulated app; skip vision |
| E2E-04 | 1:30–2:20 | A out of hub range (tape mark from MESH-05), judge types a question, Received by hub → Answered, Ollama log shows run | Ack ≤20 s; answer ≤ MESH-05 measured max (≤75 s *(prov.)*); a new `POST "/api/chat"` line between send and answer; answer ends with label; **only one question outstanding** (APP-22); A stays on Ask | No ack by 30 s: walk A to direct range, retry, say "direct path". No answer by 90 s: move on, show a rehearsal recording |
| E2E-05 | 2:20–3:00 | Hub Bluetooth off (the **Mac**), ask → Hub not reachable; Bluetooth on, retry → answer | "Hub not reachable" shown; after BT on, wait the MESH-10 recovery time, retry, answer arrives | If recovery > 20 s, narrate while waiting; if the retry fails, show the step-4 answer and say recovery was slower than the demo slot |

**Timing risk in E2E-05:** the phone timeout is 30 s (`askStateMachine.ts:41`, used at `AskScreen.tsx:90`). 30 s timeout + MESH-10 recovery + one answer time does not fit 40 s. Options: (a) a demo build with the timeout at 12–15 s, (b) OH turns the Mac's Bluetooth off during E2E-04's answer, and OA asks the step-5 question as soon as the step-4 answer lands. Decide at 17:00.

**Overall pass (P0):** 3 rehearsals 17:15–17:40; pass = 2 consecutive runs where every step meets its criteria without a fallback and total ≤3:15, or 3/3 runs completed with fallbacks the narrator states. Every run logged in the evidence sheet. Screen-record each run on A (iOS Screen Recording works offline) and on B (`adb shell screenrecord /sdcard/run<n>.mp4`), giving T5 its video.

---

## 5. Demo-day preflight checklist (~10 min, P0, 17:45)

| ID | Check | Command / action | Pass |
| --- | --- | --- | --- |
| PRE-01 | Power | A, B, C ≥80 %; Mac and Spark on mains; spare cables at the table | yes |
| PRE-02 | Phones stay awake | iOS: Settings → Display & Brightness → Auto-Lock → Never; Low Power Mode off. Android: screen timeout 30 min, Developer options → Stay awake on charge; `adb shell pm list packages \| grep -i bitchat` then `adb shell dumpsys deviceidle whitelist +<pkg>` | set |
| PRE-03 | Offline verified | MESH-11 commands on A, B, Mac, Spark; take screenshots for E2E-01 fallback | all fail to reach the internet |
| PRE-04 | Bluetooth permissions | iOS: Settings → BitChat (and RN app) → Bluetooth on. Android: `adb shell dumpsys package <pkg> \| grep -E "BLUETOOTH_(SCAN\|CONNECT\|ADVERTISE).*granted=true"` → 3 lines; Nearby devices + Location granted to the RN app; camera granted if vision beat | yes |
| PRE-05 | Apps foreground | BitChat / RN app open in foreground on A, B (MESH-12 result) | yes |
| PRE-06 | Hub model staged and warm | Spark: `ollama list \| grep ministral-3:14b-instruct-2512-fp16`; `ollama ps` shows it loaded, UNTIL "Forever"; `systemctl show ollama -p Environment` lists `OLLAMA_NUM_PARALLEL=4 OLLAMA_KEEP_ALIVE=-1 OLLAMA_CONTEXT_LENGTH=8192` and `OLLAMA_HOST=<local-link IP>` | all present |
| PRE-07 | Responder up | `curl -s http://10.0.0.2:8080/health` → `{"status": "ok"}`; `time curl -s -X POST http://10.0.0.2:8080/ask -H 'Content-Type: application/json' -d '{"sender":"preflight","question":"Say OK","wait":true}'` → answer with label, record seconds (warms the model) | ok, ≤ rehearsal answer time |
| PRE-08 | Phone models staged (only if vision beat) | iOS: files pushed by `scripts/push_ios.sh`, sizes match `phone/ios/models.json`; Pixel per `phone/android/INSTALL.md`; hashes as `phone/TEST_PLAN.md` section 2 | match |
| PRE-09 | Android 17 memory limiter | `adb shell getprop ro.build.version.release`; if ≥17: `adb shell am memory-limiter status` (record); after the last rehearsal `adb shell dumpsys activity exit-info <pkg> \| grep -i -B2 -A3 MemoryLimiter` | no `MemoryLimiter:AnonSwap` kill during rehearsals; do not leave `memory-limiter ignore` on (a lifted limit is not a valid run) |
| PRE-10 | Mesh smoke | A→B `pre <time>`, B→A, A→hub private question → ack + answer | all 3 |
| PRE-11 | Stage layout | H, B, A on their MESH-05 tape marks; other BitChat devices nearby off where possible | yes |
| PRE-12 | Screens set | A on Ask, B on Locate; journalctl in large font on the Spark screen; evidence sheet + stopwatch ready; screen recording started | yes |
| PRE-13 | Do not | No BitChat triple-tap "panic" wipe (clears identity and favourites); no Wi-Fi toggles after PRE-03 | — |

---

## 6. UX / accessibility checks (design/PRINCIPLES.md)

| ID | P | Check | How | Pass / today |
| --- | --- | --- | --- | --- |
| UX-01 | P0 | Every Ask state visible as a word on screen at arm's length | rehearsal, judge's distance | 4 words readable. Today: words present (`askStateMachine.ts:11-16`) |
| UX-02 | P1 | Colour means one state | inspect tokens | **Fail:** Sent and Answered share `#8AD8C6` (`tokens.ts:17,19`) |
| UX-03 | P1 | Yellow never as text | inspect | **Fail:** `statusUnreachable` yellow is text colour in `AskStatusBadge.tsx:19` |
| UX-04 | P1 | State = icon + word + colour, no pills | inspect | **Fail:** no icon; badge is a rounded pill (`AskStatusBadge.tsx:26-33`) |
| UX-05 | P1 | "Bluetooth is off" banner with a turn-on action | turn BT off on A | **Missing** in app |
| UX-06 | P1 | Largest system text size, no clipping on Ask card, Retry, Share | iOS: Accessibility → Display & Text Size → Larger Text max; Android: font + display size max | no clipped text. Note tabs clamp at 1.6× (`tokens.ts:56`) |
| UX-07 | P1 | After "Received by hub", a stalled answer eventually says what to do | stop responder after ack | **Fails today:** stuck on "Answer still coming…" forever (timeout only guards the ack, `askStateMachine.ts:31-34`) |
| UX-08 | P1 | Text contrast ≥4.5:1 | computed | **Pass:** text 12.9, muted 7.7, status colours 6.6–8.6 on surface `#15303F`; button text 9.5–9.8 |
| UX-09 | P2 | Screen reader order: state, question, answer, action | VoiceOver / TalkBack on an Ask card | today: question read before state |
| UX-10 | P2 | Confirm before sending location | tap Share location | **Missing:** sends immediately (`LocateScreen.tsx:41-45`) |
| UX-11 | P2 | Pure black background, flush-left text | inspect | background `#0D1F2B` (`tokens.ts:7`); centred text `LocateScreen.tsx:124,136,159` |

---

## 7. Contradictions and gaps found (file:line)

1. **Map format mismatch.** The staged map is `map/london.pmtiles` (Protomaps vector, `datasets/phone/manifest.json`), but the app renders PNG raster tiles from `london/{z}/{x}/{y}.png` via react-native-maps `LocalTile` (`phone/app/src/locate/tiles.ts:23`, `phone/app/README.md:34-40`). react-native-maps cannot draw vector PMTiles. Convert to raster tiles or switch to MapLibre, or the Locate map is blank offline. The pmtiles file is also absent from this checkout (`datasets/.gitignore:4`).
2. **Platform scope.** `phone/app/README.md:4` ("iPhone only") and `phone/app/package.json:5` ("iPhone app") contradict the Android scope in `BLUEPRINT_1.md:29,135,175`.
3. **Fallback transport is iOS-only.** `BLUEPRINT_1.md:32` keeps Multipeer as the fallback, but the demo pairs an iPhone with a Pixel (`BLUEPRINT_1.md:135`), and `PLAN.md:37` says Multipeer does not work across platforms. On the demo devices there is no working fallback.
4. **Which machine is "the hub" in step 5.** `BLUEPRINT_1.md:135` calls the hub the DGX Spark, `BLUEPRINT_1.md:141` says "Turn off Bluetooth on the hub", and `BLUEPRINT_1.md:41` makes the Mac the BitChat peer. The Mac's Bluetooth is the one to turn off.
5. **Stale critique.** `critique.md:13` says the Mac bridge reaches the hub over the internet and that the demo is not offline. That contradicts `BLUEPRINT_1.md:5,41,177` (offline local link).
6. **Step 5 does not fit its slot.** The 30 s timeout (`askStateMachine.ts:41`, `AskScreen.tsx:90`), plus Bluetooth recovery, plus an answer, takes longer than the ~40 s the 3-minute script leaves.
7. **Ask correlation is FIFO.** `AskScreen.tsx:54-59` pairs each answer with the oldest pending question, but the hub runs 4 questions in parallel (`BLUEPRINT_1.md:50,185`), so answers can come back out of order and be misattributed. An ack that differs from `HUB_ACK_TEXT` even by whitespace is taken as the answer (`AskScreen.tsx:53`). The hub's error answer (`hub/responder.py:248-253`) shows as "Answered". Late acks or answers after a timeout are dropped (`askStateMachine.ts:27-34`).
8. **Tab state is lost.** Tabs unmount (`App.tsx:56-58`), which drops Ask items and subscriptions, Talk history and Locate pins. Demo steps 3 and 4 depend on B staying on Locate and A staying on Ask.
9. **Hub id comes from the simulator.** `AskScreen.tsx:18` imports `HUB_PEER_ID = 'hub'` from `SimulatedTransport.ts:9`. Real BitChat peers need a mapping. `Transport.ts:35-42` has no async send result and no peer-change event.
10. **Simulator gaps.** `SimulatedTransport` cannot inject phone-to-phone messages, so Talk receive and Locate pins (demo steps 2–3) cannot be exercised or tested on the simulated link.
11. **Talk hides the public channel when alone.** `TalkScreen.tsx:86` hides public messages whenever no phone peer is listed.
12. **Missing pieces for the demo.** There is no native iOS/Android project, no BitChat native module, no Mac bridge in the checkout (`bitchat` submodule uninitialised), no GPS (`usePosition.ts:19` is a fixed point), and no camera/vision in `phone/app`. Demo step 3 ("finds its position and uses the vision model") cannot run in the app as it stands.
13. **App copy breaks the design rules.** `design/PRINCIPLES.md:45-46` bans the words hub/mesh/offline, connection status and nearby counts. The app says "Ask the hub…" (`AskScreen.tsx:190`), "Message the mesh" (`TalkScreen.tsx:113`), "No one nearby" (`TalkScreen.tsx:88`), and the blueprint's own state names include "hub" (`BLUEPRINT_1.md:90-97`). PRINCIPLES' message states (Sending/Delivered/Answered/Not sent yet) differ from the blueprint's four states. Treat the blueprint as winning for the demo.
14. **Jest cannot run component tests.** `jest.config.js` has no `react-native` preset and there is no `react-test-renderer`, so `.tsx` screen tests fail until both are added.
15. **POI lookup is unused.** `london_pois.sqlite` (21 650 POIs, indexed by category, lat, lon) ships in the bundle, but nothing in the app reads it.
