# Frontend ↔ Hub Contract

Written by the Integration Coordinator after auditing this repo (branch `design/status-components`, 21 Nov 2026).
This document is the single source of truth for connecting the phone frontend to the Mac mini hub.
It follows the message format and Ask states already fixed in [BLUEPRINT_1.md](BLUEPRINT_1.md#message-format)
and the "one small `Transport` interface (send, receive, peers)" rule in [PLAN.md](PLAN.md#4-open-decision-which-stack).

> **Status (coordinator, after worker merge):** all items below are implemented and merged into
> `design/status-components` — B1/B2 in `hub/` (worker branch `qubula/hub-backend`, 42 unittests OK),
> F1–F4 in `design/transport.js` + both prototypes (worker branch `qubula/frontend-transport`,
> 42-check Node smoke test OK). Cross-checked live: `python3 -m hub` + stub inference → SSE `ack` then
> `answer` ending with the disclaimer; inference down → labelled fallback answer; hub down → frontend
> state `sent,unreachable` with working `retry()`. `?transport=sim` (default) keeps the original
> scripted design demo unchanged.

## 1. Audit: what exists and what is missing

### Frontend — `design/` (static HTML prototypes, fully simulated)

| File | State |
| --- | --- |
| `design/index.html` | Light interactive home prototype. The whole mesh is simulated in JS: keyword routing (`route()`), hardcoded answers, `setTimeout` delays. No network code, no `Transport` interface, no protocol handling. |
| `design/components.html` | Dark status-component prototype with its own simulated Ask flow (`sendQuestion`, states `Sending / Delivered / Answered / Not sent yet`, hardcoded answers). Same gap. |
| `design/system.html`, `design/icons.js`, `design/type.js`, `design/PRINCIPLES.md` | Visual system, tokens, principles. No runtime code. |

**Missing (frontend work items):**

- **F1 — `design/transport.js`**: a small `Transport` interface (`send(message)`, `onMessage(cb)`, `peers()`, `close()`) with two implementations:
  - `SimulatedTransport` — preserves today's scripted demo behaviour exactly (used by default so design review keeps working offline).
  - `HubTransport` — talks to the hub dev server over HTTP + Server-Sent Events (see §3), selected with `?transport=hub` (default `sim`).
- **F2 — Ask state machine driven by the protocol**: each question tracks the four blueprint states **Sent → Received by hub → Answered**, and **Hub not reachable** after a 30 s timeout with a Retry action. States must render with the existing status components (colour + icon + word, never colour alone). Wire this into the Ask flow of `design/index.html` (primary) and `design/components.html` (secondary, same transport).
- **F3 — Location attach**: a user-controlled toggle on the Ask composer that appends the `loc: <lat>,<lon>` line to the outgoing question (see §2). Off by default. `design/index.html`'s "Include my location" switch is the model.
- **F4 — Talk + location pins**: `send`/`receive` for plain peer messages and `loc:` messages, so the map sheet can show a pin for a shared location (the map itself is static SVG for now; rendering a pin from a received `loc:` is in scope, real offline map tiles are not).

### Backend — does not exist yet

| Path | State |
| --- | --- |
| `bitchat/` | Empty git submodule (not initialized, points at upstream — cannot be pushed to, see BLUEPRINT open questions). |
| `voxtral/tts.py` | Cloud Voxtral TTS. Explicitly **out of MVP scope** (BLUEPRINT "Out of scope"): the MVP uses no cloud services. |
| `hub/` | **Missing entirely.** No hub program, no inference client, no dev transport, no logging. |

**Missing (backend work items):**

- **B1 — `hub/` Python package (stdlib only, Python 3.10+; no pip installs — the demo machine is offline)**: implements the hub described in BLUEPRINT "Ask: Mistral on an offline Mac mini".
  - `hub/protocol.py` — parse/format the wire protocol of §2 (`question`, `ack`, `answer`, `loc`).
  - `hub/inference.py` — client for a local OpenAI-compatible chat server (`llama.cpp` `llama-server` or Ollama) at `http://127.0.0.1:<port>/v1/chat/completions` using only `urllib`; configurable model via env `HUB_MODEL`; system prompt per blueprint (short numbered steps, plain language, most urgent first); every answer suffixed with the exact disclaimer line; request timeout configurable (`HUB_INFERENCE_TIMEOUT`, default 120 s).
  - `hub/server.py` — the dev transport of §3 (stdlib `http.server` + SSE), plus a terminal log of every question, ACK, answer and model run with timestamps (the demo shows this terminal).
  - `hub/transport.py` — a `Transport` interface (send, receive, peers) so the BitChat macOS integration can replace the dev server later without touching the hub core; `hub/core.py` holds the receive → ACK → inference → answer → disclaimer loop against that interface.
  - `hub/__main__.py` — `python3 -m hub` starts the dev server on `127.0.0.1:8787`.
  - `hub/tests/` — `unittest` tests for protocol round-trip, ACK-then-answer ordering, disclaimer presence, `loc:` parsing, timeout → error handling, and the HTTP/SSE endpoints (spin up the server on an ephemeral port with a fake inference client).
  - `hub/README.md` — how to run it against `llama-server`/Ollama, env vars, and how the BitChat build will plug in.
- **B2 — Demo mode without a model**: if no inference server is reachable, the hub still sends the ACK and then a clearly-labelled offline fallback answer ("The hub is running but no local model answered..." + disclaimer), so the frontend demo works end-to-end before the model is installed. Log it loudly on the terminal.

## 2. Wire protocol (plain text, from BLUEPRINT §Message format)

Messages are plain text. A **question** is one or more lines of text plus an optional last line `loc: <lat>,<lon>` added only when the user opts in:

```text
How do I make river water safe to drink?
loc: 51.50070,-0.12460
```

The hub answers a question with exactly two messages, in order:

1. ACK: `Received. Working on an answer.`
2. Answer: the model's text (short numbered steps) ending with the exact line `AI answer from an offline model. Not verified emergency advice.`

A **location share** (Talk/Locate) is a single message whose body is just `loc: <lat>,<lon>` (optionally prefixed with a short note line).

**Ask states on the phone** (BLUEPRINT state table): `Sent` when the question leaves the phone · `Received by hub` when the ACK arrives · `Answered` when the second message arrives · `Hub not reachable` when no ACK arrives within **30 s** (`HUB_ACK_TIMEOUT`), with a Retry action.

## 3. Dev transport (frontend ↔ hub, replaces BitChat for local development)

Until the BitChat macOS build exists, the frontend and the hub talk over loopback HTTP. This is a development transport only; the mesh transport plugs into the same `Transport` interface later.

Base URL: `http://127.0.0.1:8787` (env `HUB_URL` on both sides).

| Method & path | Direction | Body (JSON) | Response |
| --- | --- | --- | --- |
| `POST /v1/ask` | phone → hub | `{ "id": "<uuid>", "text": "How do I...", "loc": "51.50070,-0.12460" \| null }` | `202 {"status":"accepted"}`; the hub then pushes events on the SSE stream |
| `POST /v1/loc` | phone → hub | `{ "loc": "51.50070,-0.12460", "note": "optional" }` | `202 {"status":"accepted"}` |
| `POST /v1/talk` | phone → hub (relay to peers) | `{ "text": "hello mesh" }` | `202 {"status":"accepted"}` |
| `GET /v1/events?id=<ask-id>` | phone ↔ hub | — | `text/event-stream`; one event per protocol message, see below |
| `GET /v1/peers` | phone → hub | — | `200 {"peers": ["hub", ...], "hub": true}` |
| `GET /v1/health` | phone → hub | — | `200 {"ok": true, "model": "<HUB_MODEL>", "inference": "up"\|"down"}` |

SSE event names (field `event:`), each with a JSON `data:` payload:

| SSE event | Meaning | `data` |
| --- | --- | --- |
| `ack` | hub received the question (Ask state → **Received by hub**) | `{ "ask_id": "...", "text": "Received. Working on an answer." }` |
| `answer` | final answer (Ask state → **Answered**) | `{ "ask_id": "...", "text": "1. ...\nAI answer from an offline model. Not verified emergency advice." }` |
| `talk` | a peer message arrived | `{ "from": "...", "text": "..." }` |
| `loc` | a peer shared a location | `{ "from": "...", "loc": "51.50070,-0.12460" }` |
| `error` | inference failed / timed out (still ends with disclaimer if a fallback is sent) | `{ "ask_id": "...", "error": "..." }` |

CORS: the dev server allows `Access-Control-Allow-Origin: *` so the prototype can be opened as a `file://` page or served statically.

## 4. Acceptance checks

- Backend: `python3 -m unittest discover -s hub/tests` passes; `python3 -m hub` serves `/v1/health`; a `curl` POST to `/v1/ask` yields an `ack` then an `answer` event whose text ends with the disclaimer, and the terminal log shows both.
- Frontend: `node --check` passes on `design/transport.js` and the inline script of both prototypes; opening `design/index.html?transport=sim` behaves exactly as before; with `?transport=hub` and the hub running, asking a question walks Sent → Received by hub → Answered, and stopping the hub walks to Hub not reachable after 30 s with a working Retry.
- Cross: a `node` smoke script (or curl) driving §3 against the running hub reproduces the four Ask states.

## 5. Out of scope (unchanged)

Real BitChat mesh integration and the macOS hub build (blueprint build steps 1–3), real offline map tiles and the on-device vision model (steps 4, 6), cloud Voxtral TTS (`voxtral/tts.py`), images/audio over the mesh.
