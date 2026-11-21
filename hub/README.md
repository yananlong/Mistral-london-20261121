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
| `test_responder.py` | stdlib unittest suite with a stubbed Ollama (urllib monkeypatched). |

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
  `{"sender": ..., "answer": ..., "status": "answered" | "error" | "busy"}` to
  `callback_url` (one retry). The asker always gets a second message: the
  answer, or a "No answer: ... Please retry your question." message.
- Sync (`wait=true`): `200 {"sender", "ack", "answer", "status": "answered"}`.
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

### Queueing, timeout and answer size

BLUEPRINT_1.md leaves these three values to the implementation team. They are
set from measurements on the Spark (fp16, about 9 tokens/s, warm answer about
26 s, cold about 36 s).

- **Queue.** The hub runs `OLLAMA_NUM_PARALLEL` (4) answers at once and queues
  the rest, as the blueprint says. A queued question waits up to
  `HUB_QUEUE_WAIT_SECONDS` (45) for a slot; after that, or when
  `HUB_MAX_QUEUED` (16) questions are already waiting, it gets the busy answer.
  There is no 429: every accepted question gets an answer message.
- **Timeout.** `HUB_ANSWER_TIMEOUT_SECONDS` (100) is the total deadline from
  arrival, queue wait included. A caller should wait a little longer than this
  (for example 120 s) before it shows **Hub not reachable**.
- **Answer size.** The whole answer message, disclaimer included, is at most
  `HUB_MAX_ANSWER_BYTES` (1407 UTF-8 bytes: three BitChat fragments of about
  469 bytes, DATASETS.md). `options.num_predict` is sized to that budget
  (bytes / 4, 332 tokens), so the model stops near the cap and a run is bounded
  at about 40 s. The system prompt asks for at most 6 steps and 120 words, so a
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

Every answer ends with the disclaimer sentence, exactly once, as the last
line. Markdown bold and headings are stripped, because the mesh carries plain
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
| `HUB_QUEUE_WAIT_SECONDS` | `45` | Longest wait for a model slot before the busy answer. |
| `HUB_MAX_QUEUED` | `16` | Questions that may wait at once; more get the busy answer at once. |
| `HUB_ANSWER_TIMEOUT_SECONDS` | `100` | Total deadline for one question from arrival (queue wait + model run); then the asker gets the retry answer. |
| `HUB_MAX_ANSWER_BYTES` | `1407` | UTF-8 byte budget of the whole answer message, disclaimer included. |
| `HUB_MAX_ANSWER_CHARS` | `1200` | Extra character cap on the model's text. Must be >= 1. |
| `HUB_NUM_PREDICT` | byte budget / 4 (`332`) | `options.num_predict`, the model's token cap per answer. |
| `HUB_WARMUP` | `1` | At startup, load the model and log an error if the tag is not pulled. `0` skips it. |
| `HUB_CALLBACK_ALLOW_HOSTS` | empty | Comma-separated extra callback hosts (host or host:port) beyond the built-in loopback/private/link-local/peer allowlist. |

Numeric variables are validated once at startup; a malformed value exits with
a clear message instead of crashing per request.

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
# {"sender","answer","status"} a moment later, which the peer sends on as the
# second mesh message.
```

### Remote testing (the Spark is not next to you)

The callback path needs the Spark to reach the caller, which does not work
through an SSH tunnel. Use the synchronous path: run the responder on the
Spark's loopback, forward the port, and ask with `wait: true`.

```bash
# on the Spark
HUB_BIND=127.0.0.1 OLLAMA_HOST=127.0.0.1:11434 python3 hub/responder.py
# on the laptop
ssh -N -L 8080:127.0.0.1:8080 spark &
curl -X POST http://127.0.0.1:8080/ask \
  -H 'Content-Type: application/json' \
  -d '{"sender":"phoneA","question":"How do I stop heavy bleeding?","wait":true}'
# -> 200 {"sender":"phoneA","ack":"Received. Working on an answer.","answer":"1. ...","status":"answered"}
```

Show `ack` first and `answer` second. Allow up to 120 s for the response. This
is a development route, not the demo: the demo hub has no network.

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
only-Ollama-and-callback egress rule, cloud-tag and public-`OLLAMA_HOST`
refusal, the callback host allowlist, field size caps, the 413 connection
handling, and malformed input (400).
