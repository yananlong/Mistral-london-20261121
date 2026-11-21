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
  `{"sender": ..., "answer": ...}` to `callback_url`. On model timeout or
  error it POSTs an error answer telling the asker to retry.
- Sync (`wait=true`): `200 {"sender": ..., "answer": ...}`, or `502` with the
  retry error answer when the model call fails.
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

Second reply, with the answer:

```text
1. Let the water settle, then pour the clear part through a cloth.
2. Bring it to a rolling boil for at least 1 minute.
...
AI answer from an open-weight model on the hub. Not verified emergency advice.
```

Every answer ends with the disclaimer sentence; it is appended when the model
did not include it. Answers are capped at `HUB_MAX_ANSWER_CHARS` by truncating
at a sentence boundary, and the disclaimer is added after truncation so it is
never cut off. On the phone these map to the Ask states: **Sent**,
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
