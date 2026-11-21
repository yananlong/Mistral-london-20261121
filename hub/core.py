"""The hub loop: receive -> ACK -> local model -> answer + disclaimer.

Runs against the :class:`~hub.transport.Transport` interface only. Behaviour
(CONTRACT.md §2 / B1 / B2):

* a **question** message gets exactly two replies, in order: the ACK line
  ``Received. Working on an answer.``, then the answer text ending with the
  exact disclaimer line;
* a ``loc:``-only message is relayed to the other peers as a location share;
* a ``talk`` message is relayed to the other peers;
* if the inference server is down or times out (B2), the hub still sends the
  ACK, then a clearly-labelled fallback answer that also ends with the
  disclaimer, plus an ``error`` event — so the demo works before the model is
  installed.

Every question, ACK, answer, model run and error is logged with a timestamp on
the terminal (the demo shows this terminal on the Mac mini).
"""

from __future__ import annotations

import queue
import threading
import time
from datetime import datetime

from . import protocol
from .inference import InferenceError
from .transport import Message, Transport

# B2 fallback (CONTRACT.md): sent when no local model answered. The disclaimer is
# appended by protocol.format_answer, so the fallback also ends with it.
FALLBACK_ANSWER = (
    "The hub is running but no local model answered. "
    "Check that the inference server is running on the hub, then ask again."
)


def timestamp() -> str:
    """Local ISO-8601 timestamp with seconds, for the terminal log."""
    return datetime.now().astimezone().isoformat(timespec="seconds")


class HubCore:
    """The hub receive -> ACK -> inference -> answer loop, against a Transport."""

    def __init__(self, transport: Transport, inference, log=None) -> None:
        self.transport = transport
        self.inference = inference
        self._log = log if log is not None else (lambda line: print(line, flush=True))
        self._queue: queue.Queue = queue.Queue()
        self._worker: threading.Thread | None = None
        self._closed = threading.Event()

    # ------------------------------------------------------------------ log
    def log(self, level: str, line: str) -> None:
        self._log(f"{timestamp()} [{level}] {line}")

    # ------------------------------------------------------------ lifecycle
    def start(self) -> None:
        """Register on the transport and start the worker + transport."""
        self.transport.on_message(self._enqueue)
        self.transport.start()
        self._worker = threading.Thread(target=self._run, name="hub-core", daemon=True)
        self._worker.start()
        self.log(
            "hub",
            f"hub core started (transport={type(self.transport).__name__}, "
            f"model={getattr(self.inference, 'model', '?')})",
        )

    def close(self) -> None:
        """Stop the worker and the transport."""
        self._closed.set()
        self._queue.put(None)
        if self._worker is not None:
            self._worker.join(timeout=5)
            self._worker = None
        self.transport.close()
        self.log("hub", "hub core stopped")

    def wait_idle(self, timeout: float | None = None) -> bool:
        """Block until every queued message has been handled (used by tests)."""
        deadline = None if timeout is None else time.monotonic() + timeout
        while self._queue.unfinished_tasks > 0:
            if deadline is not None and time.monotonic() > deadline:
                return False
            time.sleep(0.01)
        return True

    # ------------------------------------------------------------- dispatch
    def _enqueue(self, message: Message) -> None:
        self._queue.put(message)

    def _run(self) -> None:
        while True:
            item = self._queue.get()
            try:
                if item is None or self._closed.is_set():
                    return
                try:
                    self.handle(item)
                except Exception as e:  # one bad message must never kill the hub
                    self.log("error", f"internal error while handling {item!r}: {e!r}")
            finally:
                self._queue.task_done()

    def handle(self, message: Message) -> None:
        """Handle one incoming message synchronously (also used directly by tests)."""
        parsed = protocol.parse_message(message.text)
        kind = message.kind
        if kind == "question" and parsed.kind == "loc":
            # a bare loc line that arrived on the question channel is a location share
            kind = "loc"
        if kind == "loc":
            self._handle_loc(message, parsed)
        elif kind == "talk":
            self._handle_talk(message)
        else:
            self._handle_question(message, parsed)

    # ---------------------------------------------------------------- send
    def _send(self, text: str, kind: str, ask_id: str | None = None, **extra) -> None:
        meta = {"kind": kind, "ask_id": ask_id, "from": "hub"}
        meta.update(extra)
        try:
            self.transport.send(text, meta=meta)
        except Exception as e:
            self.log("error", f"transport failed to send {kind} message: {e!r}")

    # ------------------------------------------------------------- handlers
    def _handle_question(self, message: Message, parsed: protocol.ParsedMessage) -> None:
        ask_id = message.ask_id
        question = parsed.text or message.text.strip()
        loc = parsed.loc
        if not question and not loc:
            self.log("error", f"empty question from {message.peer} (ask_id={ask_id}); ignored")
            return
        self.log(
            "question",
            f"question from {message.peer} ask_id={ask_id}: {question!r}"
            + (f" loc={loc}" if loc else ""),
        )
        # 1. ACK immediately, so the asker knows the hub is in range (Ask state "Received by hub")
        self._send(protocol.ACK_TEXT, "ack", ask_id=ask_id)
        self.log("ack", f"ACK sent to {message.peer} ask_id={ask_id}: {protocol.ACK_TEXT!r}")
        # 2. run the local model
        started = time.monotonic()
        try:
            answer = self.inference.complete(question, loc)
        except InferenceError as e:
            # B2: still answer, clearly labelled, and still end with the disclaimer
            self.log(
                "error",
                f"INFERENCE FAILED for ask_id={ask_id}: {e} -- sending labelled fallback answer",
            )
            self._send(str(e), "error", ask_id=ask_id, error=str(e))
            fallback = protocol.format_answer(FALLBACK_ANSWER)
            self._send(fallback, "answer", ask_id=ask_id)
            self.log(
                "answer",
                f"fallback answer sent to {message.peer} ask_id={ask_id} "
                f"(labelled 'no local model answered', ends with the disclaimer)",
            )
            return
        elapsed = time.monotonic() - started
        self.log(
            "model",
            f"model {getattr(self.inference, 'model', '?')} answered ask_id={ask_id} "
            f"in {elapsed:.1f}s ({len(answer)} chars)",
        )
        # 3. answer + mandatory disclaimer (Ask state "Answered")
        answer_full = protocol.format_answer(answer)
        self._send(answer_full, "answer", ask_id=ask_id)
        self.log(
            "answer",
            f"answer sent to {message.peer} ask_id={ask_id} "
            f"({len(answer_full)} chars, ends with the disclaimer)",
        )

    def _handle_loc(self, message: Message, parsed: protocol.ParsedMessage) -> None:
        loc = parsed.loc
        if loc is None:
            _, loc = protocol.split_loc(message.text)
        if loc is None:
            self.log("error", f"loc message without a loc line from {message.peer}: {message.text!r}")
            return
        self.log(
            "loc",
            f"location share from {message.peer}: loc={loc}" + (f" note={parsed.text!r}" if parsed.text else ""),
        )
        # relay the location share to the other peers
        self._send(protocol.format_loc_message(loc, parsed.text or None), "loc", loc=loc, from_peer=message.peer)

    def _handle_talk(self, message: Message) -> None:
        self.log("talk", f"talk message from {message.peer}: {message.text!r}")
        self._send(message.text, "talk", from_peer=message.peer)
