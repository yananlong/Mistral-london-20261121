# Offline hub responder

The DGX Spark side of the **Ask** flow. A BitChat peer (in the demo, a Mac)
relays plain-text mesh questions to this server over the local link, and the
server answers them with the local Ollama model. The hub is offline: the only
outbound HTTP is the local Ollama endpoint and the caller's `callback_url`.
No question ever goes to a cloud model API.

```
Phone A --Bluetooth mesh--> Phone B --Bluetooth--> Mac (BitChat peer)
                                                            |
                                              local link (no internet)
                                                            |
                                              DGX Spark: responder.py --HTTP /api/chat--> Ollama
                                              (ministral-3:14b-instruct-2512-q4_K_M)
```

To the phones and the docs, the Mac and the Spark are one hub.

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
| `sender` | string | yes | BitChat peer nickname of the asker; echoed back. |
| `question` | string | yes | Plain-text question; may carry a `loc:` line (below). |
| `loc` | string or `[lat, lon]` | no | `"51.50070,-0.12460"`; used when the text has no `loc:` line. |
| `callback_url` | string | no | http(s) URL that receives `{sender, answer}` in async mode. |
| `wait` | boolean | no | `true` blocks and returns the full answer in the response. |

Responses:

- Async (default): `202 {"status": "accepted", "ack": "Received. Working on an answer."}`
  immediately. A worker thread runs the model, then POSTs
  `{"sender": ..., "answer": ..., "messages": [...]}` to `callback_url`. On
  model timeout or error it POSTs an error answer telling the asker to retry.
- Sync (`wait=true`): `200 {"sender": ..., "answer": ..., "messages": [...]}`,
  or `502` with the retry error answer when the model call fails.
- `messages` is what the BitChat peer puts on the mesh: send each entry as its
  own private message, in order. `answer` is the full text for logs and evals,
  and must not be sent as one message (see below).
- `400 {"error": ...}` for malformed input (bad JSON, missing `sender` or
  `question`, bad `loc`, non-boolean `wait`). `404` for other paths,
  `413` for bodies over 1 MiB.

## Mesh message format

Questions and answers are plain-text BitChat private messages, so stock
BitChat works too.

Question from a phone to the hub:

```text
How do I make river water safe to drink?
loc: 51.50070,-0.12460
```

The `loc:` line is optional; the app adds it only when the user chooses to
share their location. `responder.py` strips it from the question and passes it
to the model as structured data (`Asker location (lat, lon): ...`).

First reply from the hub (the ack in the `202` body, forwarded over the mesh):

```text
Received. Working on an answer.
```

Then the answer, as several private messages. BitChat rejects private message
content over 255 UTF-8 bytes (`bitchat/bitchat/Protocols/Packets.swift:251-265`),
so the hub splits each answer into `(i/n) ` parts of at most 255 bytes, with
the AI label as the last part:

```text
(1/2) 1. Let the water settle, then pour the clear part through a cloth.
2. Bring it to a rolling boil for at least 1 minute.
(2/2) AI answer from an open-weight model on the hub. Not verified emergency advice.
```

`responder.py` builds `messages` with `compose_answer` from
`protocol/make_vectors.py`, the reference implementation of the contract in
`protocol/README.md`, so it matches the part reassembly in the app at `app/`. A model
failure sends the single message `The hub could not answer right now. Please
try again.` (`HUB_ERROR_TEXT`).

In `messages`, the answer body is capped at 900 UTF-8 bytes before splitting.
The `answer` field ends with the disclaimer sentence, which is appended when
the model did not include it, and is capped at `HUB_MAX_ANSWER_CHARS` by
truncating at a sentence boundary. On the phone these map to the Ask states: **Sent**,
**Received by hub** (ack arrived), **Answered** (answer arrived), **Hub not
reachable** (no ack within the phone's timeout).

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `HUB_BIND` | `127.0.0.1` | Address the responder listens on. The setup script sets the Spark's local-link IP. Never `0.0.0.0`; the server refuses it. |
| `HUB_PORT` | `8080` | Port the responder listens on. |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama endpoint. Scheme is optional; `responder.py` prepends `http://`. |
| `HUB_MODEL` | `ministral-3:14b-instruct-2512-q4_K_M` | Ollama model tag. |
| `OLLAMA_CONTEXT_LENGTH` | `8192` | Sent as `options.num_ctx` in `/api/chat`. |
| `HUB_MAX_ANSWER_CHARS` | `1200` | Answer cap, truncated at a sentence boundary. |
| `HUB_ANSWER_TIMEOUT_SECONDS` | `120` | Timeout for one model call; on timeout the asker gets the retry error answer. |

## Run steps

On the Spark (needs the network once, to pull the model):

```bash
SPARK_LOCAL_LINK_IP=10.0.0.2 ./hub/setup_spark.sh   # sets Ollama env, pulls the model
# then disconnect the network:
./hub/setup_spark.sh offline-check                  # ollama list + a test question through responder.py
```

Day to day, with Ollama already running:

```bash
HUB_BIND=10.0.0.2 python3 hub/responder.py    # 10.0.0.2 = the Spark's local-link IP
curl http://10.0.0.2:8080/health
```

From the Mac BitChat peer, forward a mesh question to the Spark:

```bash
curl -X POST http://10.0.0.2:8080/ask \
  -H 'Content-Type: application/json' \
  -d '{"sender":"phoneA","question":"How do I make river water safe to drink?\nloc: 51.50070,-0.12460","callback_url":"http://mac.local:9000/mesh-reply"}'
# -> 202 {"status":"accepted","ack":"Received. Working on an answer."}
# forward the ack to the phone now; the callback_url receives {"sender","answer"}
# a moment later, which the peer sends on as the second mesh message.

# synchronous variant (used by the offline check):
curl -X POST http://10.0.0.2:8080/ask \
  -H 'Content-Type: application/json' \
  -d '{"sender":"phoneA","question":"How do I stop heavy bleeding?","wait":true}'
```

## Tests

```bash
cd hub && python3 -m unittest
```

The suite stubs Ollama by monkeypatching `urllib.request.urlopen` and drives
the real HTTP server, covering the ack-then-answer async flow with callback,
the `wait=true` sync flow, `loc:` line parsing, disclaimer appending, answer
truncation, model timeout (retry error answer) and malformed input (400).

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
