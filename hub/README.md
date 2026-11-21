# hub — the offline Mac mini hub (backend)

The hub is one more peer on the disaster mesh (a Mac mini with Bluetooth on, Wi-Fi off,
no Ethernet). When it receives a plain-text **question** over the mesh, it replies with
(1) `Received. Working on an answer.` and then (2) the answer from a **local** Mistral
model, ending with the exact line `AI answer from an offline model. Not verified
emergency advice.`

Everything here is **Python standard library only, Python 3.10+** — the demo machine is
offline, so there are no pip installs at runtime. Tests use `unittest` only.

```
hub/
├── protocol.py    wire protocol: parse/format questions, loc: lines, ACK, disclaimer
├── inference.py   OpenAI-compatible chat client for the local inference server (urllib only)
├── transport.py   Transport interface (send / on_message / peers / start / close) + Message
├── core.py        the hub loop: receive -> ACK -> model -> answer + disclaimer; B2 fallback
├── server.py      dev transport: HTTP + Server-Sent Events on loopback (CONTRACT.md §3)
├── __main__.py    python3 -m hub  ->  starts the dev server
├── tests/         unittest suite (protocol, core, inference stub, HTTP/SSE endpoints)
└── README.md      this file
```

## Quick start

1. Run a local inference server on the Mac mini (Wi-Fi off, Ethernet unplugged), e.g.:

   ```sh
   # llama.cpp
   llama-server -m ministral-3b.Q4_K_M.gguf --port 8080
   # or Ollama
   ollama serve            # listens on 11434; set HUB_INFERENCE_PORT=11434
   ```

2. Start the hub (from the repo root):

   ```sh
   python3 -m hub
   ```

   The terminal log shows every question, ACK, answer, model run and error with a
   timestamp — this is the terminal the demo shows on the Mac mini.

3. Ask it (dev transport, see below):

   ```sh
   curl -s http://127.0.0.1:8787/v1/health
   # {"ok": true, "model": "ministral-3b", "inference": "up"}

   curl -s -N 'http://127.0.0.1:8787/v1/events?id=t1' &   # SSE stream, works with curl -N and EventSource
   curl -s -X POST http://127.0.0.1:8787/v1/ask \
     -d '{"id":"t1","text":"How do I make river water safe to drink?","loc":"51.50070,-0.12460"}'
   # SSE stream receives:
   #   event: ack     data: {"ask_id":"t1","text":"Received. Working on an answer."}
   #   event: answer  data: {"ask_id":"t1","text":"1. ...\nAI answer from an offline model. Not verified emergency advice."}
   ```

## Environment variables

| Variable                | Default                 | Meaning |
|-------------------------|-------------------------|---------|
| `HUB_URL`               | `http://127.0.0.1:8787` | Bind URL of the dev transport (both sides of the dev link). |
| `HUB_HOST` / `HUB_PORT` | `127.0.0.1` / `8787`    | Bind host/port when `HUB_URL` is not set. |
| `HUB_MODEL`             | `ministral-3b`          | Model name sent to the inference server. |
| `HUB_INFERENCE_PORT`    | `8080`                  | Port of the local inference server (`http://127.0.0.1:$HUB_INFERENCE_PORT/v1/chat/completions`). |
| `HUB_INFERENCE_TIMEOUT` | `120` (seconds)         | Per-request timeout; on timeout the hub sends the B2 fallback answer. |

## Dev transport (CONTRACT.md §3)

Until the BitChat macOS build exists, phones and the hub talk over loopback HTTP + SSE.
Every response carries `Access-Control-Allow-Origin: *`, so the design prototype can be
opened as a `file://` page.

| Method & path | Body (JSON) | Response |
|---|---|---|
| `POST /v1/ask` | `{"id": "<uuid>", "text": "How do I...", "loc": "51.50070,-0.12460" \| null}` | `202 {"status":"accepted"}`; events follow on the SSE stream |
| `POST /v1/loc` | `{"loc": "51.50070,-0.12460", "note": "optional"}` | `202 {"status":"accepted"}` |
| `POST /v1/talk` | `{"text": "hello mesh"}` | `202 {"status":"accepted"}` (relayed to peers) |
| `GET /v1/events?id=<ask-id>` | — | `text/event-stream`, one event per protocol message |
| `GET /v1/peers` | — | `200 {"peers": ["hub", ...], "hub": true}` |
| `GET /v1/health` | — | `200 {"ok": true, "model": "<HUB_MODEL>", "inference": "up"\|"down"}` |

SSE events (`event:` name + JSON `data:` payload): `ack`, `answer`, `talk`, `loc`, `error`
— see CONTRACT.md §3 for the payloads. A phone opens `GET /v1/events?id=<ask-id>` with a
browser `EventSource` (or `curl -N`), then `POST /v1/ask`; the stream delivers `ack`
(Ask state **Received by hub**) then `answer` (state **Answered**).

## Wire protocol (BLUEPRINT_1.md "Message format")

Plain text only — keep mesh messages short; no images or audio.

```
question:   one or more lines of text + optional last line `loc: <lat>,<lon>`
hub reply 1: Received. Working on an answer.
hub reply 2: <answer text>\nAI answer from an offline model. Not verified emergency advice.
loc share:  `loc: <lat>,<lon>` (optionally one short note line above)
```

`hub/protocol.py` owns these strings (`ACK_TEXT`, `DISCLAIMER`) and the parse/format
helpers. `hub/inference.py:complete(question, loc)` returns the model text **without**
the disclaimer; `hub/core.py` appends it via `protocol.format_answer`, so the disclaimer
is always present — including on fallback answers.

## Demo mode without a model (CONTRACT.md B2)

If no inference server is reachable (or it times out), the hub still sends the ACK, then
an `error` event, then a clearly-labelled fallback answer that still ends with the
disclaimer:

```
The hub is running but no local model answered. Check that the inference server is
running on the hub, then ask again.
AI answer from an offline model. Not verified emergency advice.
```

The failure is logged loudly on the terminal. This keeps the frontend demo working
end-to-end before the model is installed.

## Plugging the BitChat macOS build into `transport.py`

`hub/core.py` depends only on the small `Transport` interface in `hub/transport.py`
(PLAN.md §4: "one small `Transport` interface (send, receive, peers)"). The dev HTTP/SSE
server (`hub/server.py`, class `DevTransport`) is just one implementation. To move to the
real mesh, implement the same interface around the BitChat macOS build and pass it to
`HubCore` instead — the core, protocol and inference code do not change:

```python
from hub.core import HubCore
from hub.inference import ChatInference
from hub.transport import Message, Transport

class BitChatTransport(Transport):        # wraps the modified BitChat macOS build
    def send(self, message: str, meta: dict | None = None) -> None:
        mesh.send_private(peer, message)   # meta (ack/answer/...) is dev-transport only
    def on_message(self, callback) -> None:
        mesh.on_private_message(lambda sender, text: callback(Message(text=text, peer=sender)))
    def peers(self) -> list[str]: ...
    def start(self) -> None: ...
    def close(self) -> None: ...

core = HubCore(BitChatTransport(), ChatInference())
core.start()
```

On the mesh there is no `ask_id`, so `Message.ask_id` stays `None` and the hub simply
sends the two reply messages to the asking peer. `loc:`-only messages are relayed as
location shares, plain messages as talk.

## Running the tests

```sh
python3 -m unittest discover -s hub/tests -v
```

42 tests: protocol round-trips (incl. `loc:` parsing and the exact disclaimer constant),
core ACK-then-answer ordering with a fake inference client, the B2 fallback when
inference is down, the inference client against a loopback stub (timeouts/errors raise
typed exceptions), and the HTTP/SSE endpoints on an ephemeral port (POST `/v1/ask` then
read the SSE stream, expecting `ack` then `answer`). No network access to any real
model — tests only use loopback stubs.
