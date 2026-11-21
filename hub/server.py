"""Dev transport: loopback HTTP + Server-Sent Events (CONTRACT.md §3).

Standard library only (``http.server`` + threads). Until the BitChat macOS
build exists, phones and the hub talk over this dev transport. It implements
the :class:`~hub.transport.Transport` interface, so the mesh transport can
replace it later without touching ``hub/core.py``.

Endpoints:

=========================  =========================================================
``POST /v1/ask``           ``{"id": "...", "text": "...", "loc": "lat,lon"|null}`` -> ``202 {"status":"accepted"}``
``POST /v1/loc``           ``{"loc": "lat,lon", "note": "optional"}`` -> ``202``
``POST /v1/talk``          ``{"text": "hello mesh"}`` -> ``202`` (relayed to peers)
``GET /v1/events?id=<ask-id>``  ``text/event-stream``; one event per protocol message:
                           ``ack`` | ``answer`` | ``talk`` | ``loc`` | ``error``, each with a JSON ``data:`` payload
``GET /v1/peers``          ``200 {"peers": ["hub", ...], "hub": true}``
``GET /v1/health``         ``200 {"ok": true, "model": "<HUB_MODEL>", "inference": "up"|"down"}``
=========================  =========================================================

CORS: every response carries ``Access-Control-Allow-Origin: *`` so the prototype
can be opened as a ``file://`` page. The SSE stream works with a plain browser
``EventSource`` and with ``curl -N``.

Bind address: ``HUB_URL`` (default ``http://127.0.0.1:8787``); ``HUB_HOST`` /
``HUB_PORT`` override the host/port when ``HUB_URL`` is not set.
"""

from __future__ import annotations

import json
import os
import queue as queue_mod
import threading
import urllib.parse
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import protocol
from .transport import Message, Transport

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8787
MAX_BODY_BYTES = 64 * 1024  # mesh messages are short plain text
SSE_KEEPALIVE_S = 15.0


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


class _Subscriber:
    """One connected SSE client (a phone watching the event stream)."""

    def __init__(self, sub_id: str) -> None:
        self.id = sub_id
        self.events: queue_mod.Queue = queue_mod.Queue()


class _HubHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, handler_cls, transport: "DevTransport") -> None:
        super().__init__(addr, handler_cls)
        self.hub_transport = transport


class DevTransport(Transport):
    """The dev transport of CONTRACT.md §3: HTTP + SSE on loopback."""

    def __init__(self, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, inference=None, log=None) -> None:
        self.host = host
        self.port = int(port)
        self.inference = inference
        self._log = log if log is not None else (lambda line: print(line, flush=True))
        self._callbacks: list = []
        self._subscribers: list[_Subscriber] = []
        self._lock = threading.Lock()
        self._server: _HubHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @classmethod
    def from_env(cls, inference=None, log=None) -> "DevTransport":
        """Build a transport from ``HUB_URL`` (or ``HUB_HOST``/``HUB_PORT``)."""
        url = os.environ.get("HUB_URL")
        if url:
            parsed = urllib.parse.urlparse(url if "//" in url else "//" + url, scheme="http")
            host = parsed.hostname or DEFAULT_HOST
            port = parsed.port or DEFAULT_PORT
        else:
            host = os.environ.get("HUB_HOST") or DEFAULT_HOST
            port = int(os.environ.get("HUB_PORT") or DEFAULT_PORT)
        return cls(host, port, inference=inference, log=log)

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    # ------------------------------------------------------ Transport API
    def send(self, message: str, meta: dict | None = None) -> None:
        """Broadcast one outgoing protocol message to every SSE subscriber."""
        meta = meta or {}
        kind = meta.get("kind") or self._guess_kind(message)
        data = self._event_data(kind, message, meta)
        payload = f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")
        with self._lock:
            subs = list(self._subscribers)
        for sub in subs:
            sub.events.put(payload)

    def on_message(self, callback) -> None:
        self._callbacks.append(callback)

    def dispatch(self, message: Message) -> None:
        """Feed one incoming message to the registered callbacks (the hub core)."""
        for cb in list(self._callbacks):
            cb(message)

    def peers(self) -> list[str]:
        with self._lock:
            ids = [sub.id for sub in self._subscribers]
        return ["hub"] + ids

    def start(self) -> None:
        self._server = _HubHTTPServer((self.host, self.port), _Handler, self)
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(
            target=self._server.serve_forever, name="hub-dev-server", daemon=True
        )
        self._thread.start()
        self._log(f"{_now()} [hub] dev transport listening on {self.url}")

    def close(self) -> None:
        server, self._server = self._server, None
        if server is not None:
            server.shutdown()
            server.server_close()
        with self._lock:
            subs = list(self._subscribers)
            self._subscribers.clear()
        for sub in subs:
            sub.events.put(None)  # wake the SSE writer threads so they can exit
        self._log(f"{_now()} [hub] dev transport closed")

    # ------------------------------------------------------------ internal
    @staticmethod
    def _guess_kind(message: str) -> str:
        if message.strip() == protocol.ACK_TEXT:
            return "ack"
        if protocol.is_loc_only(message):
            return "loc"
        return "talk"

    @staticmethod
    def _event_data(kind: str, message: str, meta: dict) -> dict:
        if kind in ("ack", "answer"):
            return {"ask_id": meta.get("ask_id"), "text": message}
        if kind == "error":
            return {"ask_id": meta.get("ask_id"), "error": meta.get("error", message)}
        if kind == "loc":
            loc = meta.get("loc")
            if loc is None:
                _, loc = protocol.split_loc(message)
            data = {"from": meta.get("from_peer") or meta.get("from") or "hub", "loc": loc}
            if message and not protocol.is_loc_only(message):
                data["text"] = message
            return data
        return {"from": meta.get("from_peer") or meta.get("from") or "hub", "text": message}

    def _add_subscriber(self, sub: _Subscriber) -> None:
        with self._lock:
            self._subscribers.append(sub)
            count = len(self._subscribers)
        self._log(f"{_now()} [sse] subscriber {sub.id!r} connected ({count} connected)")

    def _remove_subscriber(self, sub: _Subscriber) -> None:
        with self._lock:
            if sub in self._subscribers:
                self._subscribers.remove(sub)
            count = len(self._subscribers)
        self._log(f"{_now()} [sse] subscriber {sub.id!r} disconnected ({count} connected)")


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "DisasterMeshHub/0.1"

    @property
    def transport(self) -> DevTransport:
        return self.server.hub_transport

    def log_message(self, fmt, *args):  # route http access logs through the hub log
        self.transport._log(f"{_now()} [http] {self.address_string()} {fmt % args}")

    # ------------------------------------------------------------- helpers
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")

    def _send_json(self, code: int, obj) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None, (400, {"error": "invalid Content-Length"})
        if length <= 0:
            return None, (400, {"error": "missing JSON body"})
        if length > MAX_BODY_BYTES:
            return None, (413, {"error": "body too large (mesh messages are short plain text)"})
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8")), None
        except (ValueError, UnicodeDecodeError):
            return None, (400, {"error": "body is not valid JSON"})

    # --------------------------------------------------------------- verbs
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/v1/health":
            self._handle_health()
        elif path == "/v1/peers":
            self._send_json(200, {"peers": self.transport.peers(), "hub": True})
        elif path == "/v1/events":
            query = urllib.parse.parse_qs(parsed.query)
            sub_id = (query.get("id") or ["mesh"])[0]
            self._handle_events(sub_id)
        else:
            self._send_json(404, {"error": f"not found: {path}"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        body, err = self._read_json_body()
        if err is not None:
            self._send_json(err[0], err[1])
            return
        if not isinstance(body, dict):
            self._send_json(400, {"error": "JSON object expected"})
            return
        if path == "/v1/ask":
            self._handle_ask(body)
        elif path == "/v1/loc":
            self._handle_loc(body)
        elif path == "/v1/talk":
            self._handle_talk(body)
        else:
            self._send_json(404, {"error": f"not found: {path}"})

    # ------------------------------------------------------------ handlers
    def _handle_health(self):
        inference = self.transport.inference
        model = getattr(inference, "model", None)
        up = bool(inference.is_up()) if inference is not None else False
        self._send_json(200, {"ok": True, "model": model, "inference": "up" if up else "down"})

    def _handle_ask(self, body: dict):
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            self._send_json(400, {"error": "field 'text' (non-empty string) is required"})
            return
        ask_id = body.get("id")
        if ask_id is not None and not isinstance(ask_id, str):
            self._send_json(400, {"error": "field 'id' must be a string"})
            return
        if not ask_id:
            ask_id = uuid.uuid4().hex
        loc = body.get("loc")
        if loc is not None and (
            not isinstance(loc, str) or protocol.parse_loc_line(protocol.LOC_PREFIX + " " + loc) is None
        ):
            self._send_json(400, {"error": "field 'loc' must be a '<lat>,<lon>' string or null"})
            return
        message = Message(
            text=protocol.format_question(text, loc), kind="question", ask_id=ask_id, peer="phone"
        )
        self.transport.dispatch(message)
        self._send_json(202, {"status": "accepted", "id": ask_id})

    def _handle_loc(self, body: dict):
        loc = body.get("loc")
        if not isinstance(loc, str) or protocol.parse_loc_line(protocol.LOC_PREFIX + " " + loc) is None:
            self._send_json(400, {"error": "field 'loc' (string '<lat>,<lon>') is required"})
            return
        note = body.get("note")
        if note is not None and not isinstance(note, str):
            self._send_json(400, {"error": "field 'note' must be a string or null"})
            return
        message = Message(text=protocol.format_loc_message(loc, note), kind="loc", peer="phone")
        self.transport.dispatch(message)
        self._send_json(202, {"status": "accepted"})

    def _handle_talk(self, body: dict):
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            self._send_json(400, {"error": "field 'text' (non-empty string) is required"})
            return
        message = Message(text=text.strip(), kind="talk", peer="phone")
        self.transport.dispatch(message)
        self._send_json(202, {"status": "accepted"})

    def _handle_events(self, sub_id: str):
        """Serve the SSE stream: one ``event:``/``data:`` pair per protocol message."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self._cors()
        self.end_headers()
        sub = _Subscriber(sub_id)
        transport = self.transport
        transport._add_subscriber(sub)
        try:
            self.wfile.write(b"retry: 3000\n\n")  # EventSource reconnect hint
            self.wfile.flush()
            while True:
                try:
                    payload = sub.events.get(timeout=SSE_KEEPALIVE_S)
                except queue_mod.Empty:
                    self.wfile.write(b": keepalive\n\n")  # comment line, ignored by EventSource
                    self.wfile.flush()
                    continue
                if payload is None:  # transport closed
                    break
                self.wfile.write(payload)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass  # client went away (curl -N killed, browser tab closed)
        finally:
            transport._remove_subscriber(sub)
            self.close_connection = True
