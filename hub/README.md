# Offline hub responder

The DGX Spark side of the **Ask** flow. A BitChat peer (in the demo, a Mac)
relays plain-text mesh questions to this server over the local link, and the
server answers them with the local Ollama model. The hub is offline: the only
outbound HTTP is the local Ollama endpoint and the caller's `callback_url`,
whose host is allowlisted to local/private addresses. No question ever goes
to a cloud model API.

```
Phone A --Bluetooth mesh--> Phone B --Bluetooth--> Mac (BitChat peer)
                                                            |
                                              local link (no internet)
                                                            |
                                              DGX Spark: responder.py --HTTP /api/chat--> Ollama
                                              (ministral-3:14b-instruct-2512-fp16)
```

To the phones and the docs, the Mac and the Spark are one hub.

**Model tag.** The demo runs `ministral-3:14b-instruct-2512-fp16` (28 GB), the
build that is pulled on the Spark. BLUEPRINT_1.md names the `q4_K_M` tag; it is
not pulled, and asking Ollama for a tag that is not pulled fails every Ask with
HTTP 404. Set `HUB_MODEL` (or `MODEL_TAG` for `setup_spark.sh`) to use another
pulled tag. Cloud tags (`:cloud`, `-cloud`) are refused at startup.

## Files

| File | Purpose |
| --- | --- |
| `responder.py` | HTTP server on the Spark. Python 3 standard library only, no pip installs. |
| `setup_spark.sh` | Runbook: Ollama settings and model pull on the Spark, plus the offline check. |
| `kb.py` | Knowledge base: dataset facts (nearest places, guide passages, optional recorded bulletin) added to each question. |
| `test_responder.py` | stdlib unittest suite with a stubbed Ollama (urllib monkeypatched). |
| `test_kb.py` | KB tests against the repo's `datasets/`. |

## HTTP API

- `GET /health` → `200 {"status": "ok"}`
- `POST /ask` with JSON body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `sender` | string | yes | BitChat peer nickname of the asker; echoed back. Max 64 chars. |
| `question` | string | yes | Plain-text question (max 4000 chars); may carry one trailing `loc:` line (below). |
| `loc` | string or `[lat, lon]` | no | `"51.50070,-0.12460"`; used when the text has no `loc:` line. |
| `callback_url` | string | unless `wait` is `true` | http(s) URL that receives `{sender, answer}` in async mode. The host must be local: loopback/private/link-local IPs, `localhost`/`*.local`, the peer's own address, or a host in `HUB_CALLBACK_ALLOW_HOSTS`. Anything else is a 400 — the hub never POSTs to an arbitrary internet host. |
| `wait` | boolean | no | `true` blocks and returns the full answer in the response. |

Responses:

- Async (default): `202 {"status": "accepted", "ack": "Received. Working on an answer."}`
  at once, before the model runs and before any queueing. A worker thread waits
  for a model slot, runs the model, then POSTs
  `{"sender": ..., "answer": ..., "parts": [...], "status": "answered" | "error" | "busy"}`
  to `callback_url` (one retry). The asker always gets a second message: the
  answer, or a "No answer: ... Please retry your question." message.
- Sync (`wait=true`): `200 {"sender", "ack", "answer", "parts", "status": "answered"}`.
  `502` with `status: "error"` and the retry answer when the model call fails
  or times out; `503` with `status: "busy"` and the busy answer when no model
  slot came free in time. The body carries `ack` too, so a caller with no
  callback listener can show both mesh messages. **Use this path for remote
  testing** (below): the Spark cannot reach a listener on a laptop through an
  SSH tunnel.
- `400 {"error": ...}` for malformed input (bad JSON, missing/oversized `sender` or
  `question`, bad `loc`, multiple `loc:` lines, non-boolean `wait`, disallowed
  `callback_url` host, or an async ask with no `callback_url`). `404` for other
  paths, `413` for bodies over 1 MiB (the connection is closed, not reused).

### `parts`: what to send over the mesh

BitChat rejects a private message whose content is over 255 UTF-8 bytes
(`bitchat/Protocols/Packets.swift`, `PrivateMessagePacket.encode`). So the peer
sends **each string in `parts` as one private message, in order**, and never
sends `answer` as one message.

- `status: "answered"`: 2 to 5 parts, each `(i/n) ` plus text, each at most
  255 UTF-8 bytes. The last part is the disclaimer alone, for example
  `(3/3) AI answer from an open-weight model on the hub. Not verified emergency advice.`
  This is the wire format of `protocol/README.md` (PR #17), and
  `split_answer()` is a port of its reference `make_vectors.py`.
- `status: "error"` or `"busy"`: one part, exactly
  `The hub could not answer right now. Please try again.` (the protocol's
  `HUB_ERROR_TEXT`, no prefix and no disclaimer), which the phone shows as
  **Hub could not answer**.
- `answer` is the same text in one string, kept for callers that show it
  directly: the part texts joined with newlines, so it ends with the
  disclaimer. For an error it is a longer "No answer: ..." sentence with the
  reason.
- A question is cut to 200 UTF-8 bytes (the protocol's `MAX_QUESTION_BYTES`).

### Queueing, timeout and answer size

BLUEPRINT_1.md leaves these three values to the implementation team. They are
set from measurements on the Spark (fp16): one answer alone decodes at about
9 tokens/s (warm about 26 s, cold about 36 s), and four in parallel decode at
about 3.5 tokens/s each.

- **Queue.** The hub runs `OLLAMA_NUM_PARALLEL` (4) answers at once and queues
  the rest, as the blueprint says. A queued question waits up to
  `HUB_QUEUE_WAIT_SECONDS` (25) for a slot; after that, or when
  `HUB_MAX_QUEUED` (16) questions are already waiting, it gets the busy answer.
  There is no 429: every accepted question gets an answer message.
- **Timeout.** `HUB_ANSWER_TIMEOUT_SECONDS` (100) is the total deadline from
  arrival, queue wait included: up to 25 s in the queue, then at least 75 s
  for the run (233 tokens at 3.5 tokens/s is 67 s). A caller should wait a
  little longer than this (for example 120 s) for the second message.
- **Answer size.** The whole answer text, disclaimer included, is at most
  `HUB_MAX_ANSWER_BYTES` (780 UTF-8 bytes: about 700 bytes of model text,
  normally 3 body parts plus the disclaimer part) and at most
  `HUB_MAX_ANSWER_PARTS` (5) messages. `options.num_predict` is sized to that
  budget (bytes / 3, 233 tokens), so a run is bounded at about 26 s alone and
  67 s with four in parallel. When the model stops at that token cap, the
  unfinished last sentence is dropped. The system prompt asks for at most 6 steps and 120 words, so a
  normal answer is well under the cap.

## Mesh message format

Questions and answers are plain-text BitChat private messages, so stock
BitChat works too.

Question from a phone to the hub:

```text
How do I make river water safe to drink?
loc: 51.50070,-0.12460
```

The `loc:` line is optional; the app adds it only when the user chooses to
share their location. Only a single **trailing** `loc:` line counts as the
location (multiple `loc:` lines are a 400; a loc-looking line mid-question
stays part of the question). `responder.py` strips it from the question and
passes it to the model as structured data (`Asker location (lat, lon): ...`).

First reply from the hub (the ack in the `202` body, forwarded over the mesh):

```text
Received. Working on an answer.
```

Second reply, with the answer:

```text
1. Let the water settle, then pour the clear part through a cloth.
2. Bring it to a rolling boil for at least 1 minute.
...
AI answer from an open-weight model on the hub. Not verified emergency advice.
```

Over the mesh the answer travels as `(i/n) ` parts of at most 255 bytes
(see `parts` above); the example shows the assembled text. Every answer ends
with the disclaimer sentence, exactly once, as the last line and the last
part. Markdown bold and headings are stripped, because the mesh carries plain
text. An answer over the byte budget is cut at a sentence end (a list marker
such as `3.` never counts as one, and a cut never leaves a bare marker), and
the disclaimer is added after the cut so it is never cut off. A failure
message starts with `No answer:` so it cannot be mistaken for advice; it ends
with the same disclaimer line, like every second message from the hub. On the
phone these map to the Ask states: **Sent**, **Received by hub** (ack
arrived), **Answered** (answer arrived), **Hub not reachable** (no ack within
the phone's timeout).

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `SPARK_LOCAL_LINK_IP` | empty | The Spark's address on the local link. Default for `HUB_BIND` and for the host of `OLLAMA_HOST`, so the responder finds Ollama where `setup_spark.sh` binds it. |
| `HUB_BIND` | `SPARK_LOCAL_LINK_IP`, else `127.0.0.1` | Address the responder listens on. Never a wildcard address (`0.0.0.0`, `::`, `[::]`, ...); the server refuses it. |
| `HUB_PORT` | `8080` | Port the responder listens on. |
| `OLLAMA_HOST` | `SPARK_LOCAL_LINK_IP:11434`, else `127.0.0.1:11434` | Ollama endpoint (`POST /api/chat`). Scheme is optional. A wildcard or public IP is refused at startup. |
| `HUB_MODEL` | `ministral-3:14b-instruct-2512-fp16` | Ollama model tag. Cloud tags are refused. |
| `OLLAMA_CONTEXT_LENGTH` | `8192` | Sent as `options.num_ctx` in `/api/chat`. |
| `OLLAMA_KEEP_ALIVE` | `-1` | Sent as `keep_alive` with every request, so the model stays loaded even when the Ollama server runs with its 5-minute default. |
| `OLLAMA_NUM_PARALLEL` | `4` | Must match the Ollama server's setting; it is the number of model runs the hub starts at once. The rest queue. |
| `HUB_QUEUE_WAIT_SECONDS` | `25` | Longest wait for a model slot before the busy answer. |
| `HUB_MAX_QUEUED` | `16` | Questions that may wait at once; more get the busy answer at once. |
| `HUB_ANSWER_TIMEOUT_SECONDS` | `100` | Total deadline for one question from arrival (queue wait + model run); then the asker gets the retry answer. |
| `HUB_MAX_ANSWER_BYTES` | `780` | UTF-8 byte budget of the whole answer text, disclaimer included. |
| `HUB_MAX_ANSWER_PARTS` | `5` | Most mesh messages per answer, the disclaimer part included (2 to 9). |
| `HUB_MAX_ANSWER_CHARS` | `1200` | Extra character cap on the model's text. Must be >= 1. |
| `HUB_NUM_PREDICT` | byte budget / 3, at most `256` (`233`) | `options.num_predict`, the model's token cap per answer. |
| `HUB_WARMUP` | `1` | At startup, load the model and log an error if the tag is not pulled. `0` skips it. |
| `HUB_CALLBACK_ALLOW_HOSTS` | empty | Comma-separated extra callback hosts (host or host:port) beyond the built-in loopback/private/link-local/peer allowlist. |
| `HUB_KB` | `1` | `0` turns the knowledge base off. |
| `HUB_DATASETS_DIR` | `../datasets` (next to `hub/`) | Root of the datasets tree that the KB reads. |
| `HUB_FEEDS_DIR` | unset (off) | A feed snapshot dir, such as `datasets/feeds/latest`, which turns on the recorded bulletin. |

Numeric variables are validated once at startup; a malformed value exits with
a clear message instead of crashing per request.

## Knowledge base

`kb.py` builds its index once, at startup (about 0.07 s and under 10 MB on the
Spark), and never touches the network. For each question, `build_user_content()`
appends a numbered block after the question (and the `Asker location` line)
that starts `Facts from the hub's offline datasets (use these for any place,
distance or number; do not invent others):`. Each fact names its source. The
block stays under about 1,500 tokens.

- **Nearest places.** This runs only when the question has a loc and asks for a
  place ("where", "nearest", "which way", ...). Keywords map to a
  `phone/pois/london_pois.sqlite` category, for example tap, fountain or
  drinking water to `water`, A&E or hospital to `medical` (hospitals tagged
  `emergency=yes` come first), defibrillator or AED to `aed`, and rest centre or
  warm space to `shelter`. Food banks come from `phone/givefood/foodbanks.geojson`.
  The KB returns the 3 nearest within 3 km, each with its distance (rounded to
  10 m), compass bearing, opening hours and OSM id.
- **Guides.** BM25 runs over chunks of about 160 words from
  `phone/guides/govuk/*.json` and `phone/guides/beready/*.html`. It keeps up to
  3 chunks above a score and query-coverage threshold, and it skips guides when
  the question already got place facts.
- **Recorded bulletin.** This is opt-in, through `HUB_FEEDS_DIR`. It covers EA
  floods, Met Office warnings, GOV.UK alerts, TfL line status, UKPN/NGED power
  cuts by postcode and UKPN/UKHSA alerts, and it runs only when the question is
  on that topic. Each fact reads "Recorded snapshot (not live), as of <UTC
  time>".

If the datasets are missing or the KB fails, the hub logs a warning and answers
without facts. The ack and the disclaimer don't change.

## Run steps

On the Spark (needs the network once, to pull the model):

```bash
SPARK_LOCAL_LINK_IP=10.0.0.2 ./hub/setup_spark.sh                 # Ollama settings, pulls the model
# then disconnect the network:
SPARK_LOCAL_LINK_IP=10.0.0.2 ./hub/setup_spark.sh offline-check   # no default route, ollama list, a test question
```

Ollama server settings (BLUEPRINT_1.md, "Ollama on the hub"). With the systemd
service, `sudo systemctl edit ollama.service`, add the lines below, then
`sudo systemctl daemon-reload && sudo systemctl restart ollama`
(`sudo ./hub/setup_spark.sh` writes the same drop-in):

```ini
[Service]
Environment="OLLAMA_HOST=10.0.0.2:11434"
Environment="OLLAMA_NUM_PARALLEL=4"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_CONTEXT_LENGTH=8192"
Environment="OLLAMA_NO_CLOUD=1"
```

When Ollama is started by hand instead (no systemd unit, no root):

```bash
OLLAMA_HOST=10.0.0.2:11434 OLLAMA_NUM_PARALLEL=4 OLLAMA_KEEP_ALIVE=-1 \
  OLLAMA_CONTEXT_LENGTH=8192 OLLAMA_NO_CLOUD=1 ollama serve
```

Check with `ollama ps` after the first question: `100% GPU`, context `8192`,
`UNTIL Forever`. If the server keeps `OLLAMA_NUM_PARALLEL` at its default of
1, start the responder with `OLLAMA_NUM_PARALLEL=1` too, so the hub queues
instead of timing out.

Day to day, with Ollama already running on the local-link address:

```bash
SPARK_LOCAL_LINK_IP=10.0.0.2 python3 hub/responder.py   # binds 10.0.0.2:8080, Ollama at 10.0.0.2:11434
curl http://10.0.0.2:8080/health
```

If Ollama listens on loopback instead, say so:
`HUB_BIND=10.0.0.2 OLLAMA_HOST=127.0.0.1:11434 python3 hub/responder.py`.

From the BitChat peer, forward a mesh question to the Spark:

```bash
curl -X POST http://10.0.0.2:8080/ask \
  -H 'Content-Type: application/json' \
  -d '{"sender":"phoneA","question":"How do I make river water safe to drink?\nloc: 51.50070,-0.12460","callback_url":"http://mac.local:9000/mesh-reply"}'
# -> 202 {"status":"accepted","ack":"Received. Working on an answer."}
# forward the ack to the phone now; the callback_url receives
# {"sender","answer","parts","status"} a moment later; the peer sends each of
# "parts" as its own mesh message.
```

### Remote testing (the Spark is not next to you)

The phones (or the iPhone simulator and Android emulator on a laptop) reach a
remote Spark only through SSH. Run the responder on the Spark's loopback and
forward the port. The synchronous path (`wait: true`) needs one forward and is
the simplest. The async path also works with a reverse forward, because
loopback callback hosts (`127.0.0.0/8`, `::1`, `localhost`) are always allowed.

```bash
# on the Spark
HUB_BIND=127.0.0.1 OLLAMA_HOST=127.0.0.1:11434 python3 hub/responder.py
# on the laptop
ssh -N -L 8080:127.0.0.1:8080 spark &
curl -X POST http://127.0.0.1:8080/ask \
  -H 'Content-Type: application/json' \
  -d '{"sender":"phoneA","question":"How do I stop heavy bleeding?","wait":true}'
# -> 200 {"sender":"phoneA","ack":"Received. Working on an answer.","answer":"1. ...",
#         "parts":["(1/3) 1. ...","(2/3) 4. ...","(3/3) AI answer from ..."],"status":"answered"}
```

Send `ack` first, then each of `parts` as its own message. Allow up to 120 s for the response.

Async with callbacks: add a reverse forward, so a listener on the laptop's
port 9000 appears on the Spark's loopback.

```bash
# on the laptop: -L for /ask, -R for the callback
ssh -N -L 8080:127.0.0.1:8080 -R 9000:127.0.0.1:9000 spark &
curl -X POST http://127.0.0.1:8080/ask \
  -H 'Content-Type: application/json' \
  -d '{"sender":"phoneA","question":"How do I stop heavy bleeding?","callback_url":"http://127.0.0.1:9000/cb"}'
# -> 202 with the ack at once; {"sender","answer","parts","status"} is POSTed to the
#    laptop's 127.0.0.1:9000/cb when the answer is ready.
```

This is a development route, not the demo: the demo hub has no network.

## Tests

```bash
cd hub && python3 -m unittest
```

The suite stubs Ollama by monkeypatching `urllib.request.urlopen` and drives
the real HTTP server. It covers the ack-then-answer async flow with callback,
the `wait=true` sync flow, `loc:` line parsing, the disclaimer as the last
line, byte-budget and list-marker-safe truncation, `num_predict`/`keep_alive`,
model timeout, Ollama down, HTTP 404/500 and bad model output (retry answer /
502), queueing and the busy answer (503), eight parallel askers, the
Ollama-compatible `/api/chat` (`test_chat_proxy.py`, with a fake Ollama server), the
only-Ollama-and-callback egress rule, cloud-tag and public-`OLLAMA_HOST`
refusal, the callback host allowlist, field size caps, the 413 connection
handling, and malformed input (400).
It runs with the KB stubbed off. `test_kb.py` checks the KB against the real
datasets: Q04 water at 424 m to the SE, Q18 St Thomas', keyword mapping, guide
retrieval, feeds off by default, and graceful degradation.

## Demo wiring: the Swift hub through this responder

The BitChat build on the Mac (the Swift hub, next section) sends the ack,
splits the answer into `(i/n) ` parts and adds the AI label. For the model
call it speaks the Ollama API. Point it at this responder instead of at
Ollama, and every mesh answer gets the hub's system prompt (999 first, no
invented places, UK units), the knowledge base facts, the pulled model tag
and the queue, with no change to the Swift code.

```
phone --BLE mesh--> Mac: BitChat (BITCHAT_HUB=1) --ssh -L--> Spark: responder.py POST /api/chat --> Ollama
```

`POST /api/chat` on the responder is Ollama-compatible:

- It takes the last `user` message, reads its location (the Swift hub's
  `The person's approximate location: <lat>, <lon> (London, UK).` sentence, or
  a trailing `loc:` line) and cuts the question to 200 bytes.
- It replaces the system message with the hub's `SYSTEM_PROMPT`, adds the
  knowledge base facts exactly as `/ask` does, and forces `HUB_MODEL` and
  `keep_alive`. The caller's model is ignored. The caller's options are kept;
  `num_predict` is capped at the hub's value so a run fits the deadline, and
  `num_ctx` is set to the hub's 8192 when the caller sends none. Measured on
  the Spark: a request with no `num_ctx` made Ollama reload the model at its
  default context (262144 tokens, 69 GB), and reload again for each `/ask`.
- Fail-safe: if the knowledge base or the prompt override fails, the caller's
  request goes to Ollama as it came (with the pulled model tag), so the hub
  still answers.
- It returns Ollama's response unchanged in shape: one JSON object for
  `"stream": false` (what `OllamaClient.swift` sends; `message.content` has
  Markdown stripped), or the NDJSON stream passed through for `"stream": true`.
  It adds no ack and no disclaimer.
- It serves loopback callers only (403 otherwise) and uses the same queue and
  deadline as `/ask`: 503 when the hub is busy, 504 on timeout, Ollama's own
  status on an Ollama error. The Swift hub turns each of these into
  `The hub could not answer right now. Please try again.`

On the Spark (port 8090 here; any free port except 8080, which is the dev hub):

```bash
HUB_BIND=127.0.0.1 HUB_PORT=8090 OLLAMA_HOST=127.0.0.1:11434 python3 hub/responder.py
```

On the Mac:

```bash
ssh -N -L 8090:127.0.0.1:8090 spark &
curl -s http://127.0.0.1:8090/health        # {"status": "ok"}
hub/cli/build.sh
hub/cli/.build/hub-ask --url http://127.0.0.1:8090 --loc 51.50070,-0.12460 'Which way to the nearest hospital with an A&E?'
```

Then build BitChat (macOS scheme, **Release**, see below) with these scheme
environment variables and run it with Bluetooth on:

```text
BITCHAT_HUB=1
BITCHAT_HUB_OLLAMA_URL=http://127.0.0.1:8090
BITCHAT_HUB_MODEL=ministral-3:14b-instruct-2512-fp16
```

`BITCHAT_HUB_OLLAMA_URL` points at the responder's port (8090 here), **not**
at Ollama's 11434. Fallback if the responder is down: forward Ollama itself,
`ssh -N -L 11434:127.0.0.1:11434 spark`, and set
`BITCHAT_HUB_OLLAMA_URL=http://127.0.0.1:11434` (the Swift hub's own prompt,
no knowledge base).

The responder's deadline is 100 s (queue wait plus generation), inside the
Swift hub's 120 s model timeout and the phone's 150 s answer timeout; past it
the responder returns an HTTP error and the Swift hub sends its error text. The SSH tunnel is the development route;
for the offline demo the Mac and the Spark share a local link, the responder
stays on loopback and the same `ssh -L` tunnel runs over the local link
(`/api/chat` refuses callers that are not on loopback).

## Swift responder inside the BitChat build

A second hub path, from PR #17. The hub's own BitChat build (macOS, `BITCHAT_HUB=1`) answers private messages itself by calling Ollama on the Spark, with no relay server. Its code is in the fork branch `hub-responder` (`bitchat/bitchat/Services/Hub/`), and it follows `protocol/README.md`, which sends each answer as `(i/n) ` parts because BitChat rejects private message content over 255 UTF-8 bytes (`bitchat/bitchat/Protocols/Packets.swift:251-265`).

The Mac runs a BitChat peer named `hub`. It answers incoming mesh private messages using Ollama on the DGX Spark over the local link. The phone gets an acknowledgement and then numbered answer parts, ending with the AI label; no internet model service is used.

### Spark

At the 2026-11-21 15:19 SSH check, the Spark had Ollama 0.34.0 and only `ministral-3:14b-instruct-2512-fp16` pulled. `ollama.service` was inactive, so the running server was started another way; check that process before starting or restarting a systemd service on the same port.

The hub defaults to the `ministral-3:14b-instruct-2512-q4_K_M` tag. Either pull that tag while online, or set `BITCHAT_HUB_MODEL=ministral-3:14b-instruct-2512-fp16` on the Mac to use the model already present. When using fp16, also pass `--model ministral-3:14b-instruct-2512-fp16` to `hub-ask` and set `OLLAMA_MODEL=ministral-3:14b-instruct-2512-fp16` for `smoke.sh`.

To use the systemd setup with the default q4 model, stop the existing server first, then bind Ollama to the Spark's **local-link** address and pre-pull the model:

```sh
hub/spark/setup-ollama.sh --dry-run 10.0.0.2
hub/spark/setup-ollama.sh --pull 10.0.0.2
```

The script installs a systemd drop-in, restarts Ollama, and checks the q4 model is present; it does not configure the server currently running outside systemd. Omit `--pull` for repeat setup or offline checks. Disconnect the internet and verify again with `OLLAMA_HOST=10.0.0.2:11434 ollama list`. On the Spark, record a test and its time:

```sh
OLLAMA_URL=http://10.0.0.2:11434 hub/spark/smoke.sh answer-times.tsv
```

The TSV has UTC time, model tag, seconds, and answer length. Override `OLLAMA_MODEL` if using another tag.

### Mac

Open the BitChat fork in Xcode, select the macOS scheme, and in **Edit Scheme → Run → Arguments → Environment Variables** set:

```text
BITCHAT_HUB=1
BITCHAT_HUB_OLLAMA_URL=http://10.0.0.2:11434
BITCHAT_HUB_MODEL=ministral-3:14b-instruct-2512-q4_K_M
```

The URL and model variables are optional; defaults are `http://127.0.0.1:11434` and the tag above. Run the app with Bluetooth enabled.

Set **Edit Scheme → Run → Info → Build Configuration** to **Release**. A Debug build advertises BitChat's testnet Bluetooth service UUID (`F47B5E2D-…-4B5A`), and a Release build advertises the mainnet one (`F47B5E2D-…-4B5C`), set at `bitchat/bitchat/Services/BLE/BLEService.swift:186-190`. The phones and stock BitChat use mainnet, so a Debug hub never sees them. Incoming private questions get replies through BitChat's normal encrypted send path. The console logs one line per question with outcome and latency, without the question text.

Before starting BitChat, check the local link from the Mac:

```sh
hub/cli/build.sh
hub/cli/.build/hub-ask --url http://10.0.0.2:11434 'How can I make water safe to drink?'
# Optional: --model TAG, --loc 51.50070,-0.12460, or pipe the question on stdin.
```

Run the local protocol, responder, and fake-Ollama tests with `hub/tests/run.sh`. The scripts invoke `swiftc` directly. If Command Line Tools contains duplicate SwiftBridging module maps, `hub/swiftc.sh` uses a temporary compiler overlay without modifying the installation.

This machine has no Xcode, so the BitChat app has not been built or run, and the Bluetooth/Noise round trip and the sandbox's local HTTP access have not been verified. The Spark, real model, and offline phone-to-hub demo also still need a live check.
