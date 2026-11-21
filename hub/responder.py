#!/usr/bin/env python3
"""Offline hub responder: the DGX Spark side of the Ask flow.

A BitChat peer (the demo Mac) POSTs plain-text mesh questions here over the
local link, and this server answers them with the local Ollama model. No
cloud API is ever called. The only outbound HTTP is the local Ollama
endpoint and the caller's callback_url, whose host must be local/private
(see callback_host_allowed).

Endpoints:
    GET  /health -> 200 {"status": "ok"}
    POST /ask    -> JSON {sender, question, loc?, callback_url?, wait?}
                    202 {"status": "accepted", "ack": ...} in async mode, or
                    200 {"sender", "answer"} when wait=true.

Message format (see BLUEPRINT_1.md): a question is question lines plus an
optional "loc: <lat>,<lon>" line. The first mesh reply is the ack; the second
carries the answer, which ends with the disclaimer.

Python 3 standard library only: the hub is offline and needs no pip installs.
"""

import ipaddress
import json
import logging
import os
import re
import socket
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger("hub.responder")

ACK = "Received. Working on an answer."
DISCLAIMER = "AI answer from an open-weight model on the hub. Not verified emergency advice."
DEFAULT_MODEL = "ministral-3:14b-instruct-2512-q4_K_M"
DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"

SYSTEM_PROMPT = (
    "You are the assistant on an offline hub in a disaster area. People reach "
    "you over a Bluetooth mesh with no internet, so answers travel slowly. "
    "Answer in short numbered steps in plain language, with the most urgent "
    "action first. Keep the answer brief and practical. You have no live "
    "information about the current disaster; say so when you do not know."
)

MAX_BODY_BYTES = 1 << 20  # mesh messages are short text; 1 MiB is generous
CALLBACK_TIMEOUT_SECONDS = 30
MAX_QUESTION_CHARS = 4000  # per-field cap: a question is a short mesh text
MAX_SENDER_CHARS = 64
BUSY_REASON = "the hub is already answering too many questions right now"

LOC_LINE_RE = re.compile(
    r"^\s*loc:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$", re.IGNORECASE
)


class ModelError(Exception):
    """The local model call failed (unreachable, bad response, empty answer)."""


class ModelTimeout(ModelError):
    """The local model call exceeded HUB_ANSWER_TIMEOUT_SECONDS."""


# --- message format parsing (pure) -------------------------------------------


def parse_loc(lat, lon):
    lat = float(lat)
    lon = float(lon)
    if not -90.0 <= lat <= 90.0:
        raise ValueError("latitude out of range: %s" % lat)
    if not -180.0 <= lon <= 180.0:
        raise ValueError("longitude out of range: %s" % lon)
    return {"lat": lat, "lon": lon}


def parse_question(text):
    """Split a mesh message into (question, loc).

    The format is question lines plus one optional trailing
    "loc: <lat>,<lon>" line (BLUEPRINT_1.md). Only the last line can be the
    loc line; a loc-looking line anywhere else is ordinary question text.
    More than one loc-looking line is ambiguous and rejected.
    """
    lines = text.splitlines()
    loc_indexes = [i for i, line in enumerate(lines) if LOC_LINE_RE.match(line)]
    if len(loc_indexes) > 1:
        raise ValueError("multiple loc lines; at most one trailing 'loc:' line is allowed")
    loc = None
    if loc_indexes and loc_indexes[0] == len(lines) - 1:
        m = LOC_LINE_RE.match(lines[-1])
        loc = parse_loc(m.group(1), m.group(2))
        lines = lines[:-1]
    question = "\n".join(lines).strip()
    if not question:
        raise ValueError("question text is empty")
    return question, loc


def parse_loc_field(value):
    """Parse the optional JSON "loc" field: a "<lat>,<lon>" string or [lat, lon]."""
    if isinstance(value, str):
        parts = value.split(",")
        if len(parts) != 2:
            raise ValueError("loc must be '<lat>,<lon>'")
        return parse_loc(parts[0].strip(), parts[1].strip())
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return parse_loc(value[0], value[1])
    raise ValueError("loc must be '<lat>,<lon>' or [lat, lon]")


# --- request validation (boundary) --------------------------------------------


def callback_host_allowed(url, peer_host=None):
    """True only when the callback URL can never leave the local link.

    The hub must never DNS-resolve and POST to an arbitrary internet host:
    answers can echo the question, and no question may reach a cloud host.
    Allowed: an operator allowlist (HUB_CALLBACK_ALLOW_HOSTS, comma-separated
    hosts or host:port), the peer we are serving, localhost / *.local names
    (mDNS stays on the link), and IP literals in loopback/private/link-local
    ranges. Everything else is rejected with 400 before any DNS lookup.
    """
    try:
        parsed = urllib.parse.urlparse(url)
        port = parsed.port
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    candidates = {host}
    if port is not None:
        candidates.add("%s:%d" % (host, port))
    allow = os.environ.get("HUB_CALLBACK_ALLOW_HOSTS", "")
    allowed = {entry.strip().lower() for entry in allow.split(",") if entry.strip()}
    if candidates & allowed:
        return True
    if peer_host and host == peer_host.strip().lower():
        return True
    if host == "localhost" or host.endswith(".local"):
        return True
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return bool(addr.is_loopback or addr.is_private or addr.is_link_local)


def validate_ask_payload(body, peer_host=None):
    """Validate a parsed JSON POST /ask body and narrow it to an AskRequest.

    Returns {sender, question, loc, callback_url, wait}. Raises ValueError on
    malformed input; the handler turns that into a 400.
    """
    if not isinstance(body, dict):
        raise ValueError("body must be a JSON object")
    sender = body.get("sender")
    if not isinstance(sender, str) or not sender.strip():
        raise ValueError("sender must be a non-empty string")
    if len(sender) > MAX_SENDER_CHARS:
        raise ValueError("sender is too long (max %d chars)" % MAX_SENDER_CHARS)
    raw_question = body.get("question")
    if not isinstance(raw_question, str) or not raw_question.strip():
        raise ValueError("question must be a non-empty string")
    if len(raw_question) > MAX_QUESTION_CHARS:
        raise ValueError("question is too long (max %d chars)" % MAX_QUESTION_CHARS)
    callback_url = body.get("callback_url")
    if callback_url is not None:
        if (
            not isinstance(callback_url, str)
            or not callback_url.startswith(("http://", "https://"))
        ):
            raise ValueError("callback_url must be an http(s) URL")
        if not callback_host_allowed(callback_url, peer_host):
            raise ValueError(
                "callback_url host %r is not allowed: it must be local/private, "
                "the peer address, or listed in HUB_CALLBACK_ALLOW_HOSTS"
                % urllib.parse.urlparse(callback_url).hostname
            )
    wait = body.get("wait", False)
    if not isinstance(wait, bool):
        raise ValueError("wait must be a boolean")
    loc = body.get("loc")
    if loc is not None:
        loc = parse_loc_field(loc)
    question, text_loc = parse_question(raw_question)
    return {
        "sender": sender.strip(),
        "question": question,
        "loc": text_loc if text_loc is not None else loc,
        "callback_url": callback_url,
        "wait": wait,
    }


# --- configuration (environment) ------------------------------------------------


def _env_number(name, default, cast):
    """Read a numeric env var; fall back to the default (with a warning) on a bad value."""
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return cast(raw.strip())
    except ValueError:
        log.warning("ignoring invalid %s=%r; using the default %s", name, raw, default)
        return default


def env_int(name, default):
    return _env_number(name, default, int)


def env_float(name, default):
    return _env_number(name, default, float)


# name, cast, minimum, maximum (None = no upper bound); validated once at startup
NUMERIC_ENV_SPECS = [
    ("HUB_PORT", int, 1, 65535),
    ("HUB_ANSWER_TIMEOUT_SECONDS", float, 0.001, None),
    ("HUB_MAX_ANSWER_CHARS", int, 1, None),
    ("OLLAMA_CONTEXT_LENGTH", int, 1, None),
    ("OLLAMA_NUM_PARALLEL", int, 1, None),
]


def validate_numeric_env():
    """Fail fast at startup on malformed numeric env vars (clear exit, not a per-request crash)."""
    problems = []
    for name, cast, lo, hi in NUMERIC_ENV_SPECS:
        raw = os.environ.get(name)
        if raw is None or not raw.strip():
            continue
        try:
            value = cast(raw.strip())
        except ValueError:
            problems.append("%s=%r is not a number" % (name, raw))
            continue
        if value < lo or (hi is not None and value > hi):
            problems.append("%s=%r is out of range" % (name, raw))
    if problems:
        sys.exit("invalid hub configuration: " + "; ".join(problems))


def is_wildcard_bind(bind):
    """True for any wildcard bind form: "", 0.0.0.0, ::, 0:0:0:0:0:0:0:0, [::], ..."""
    text = bind.strip().strip("[]")
    if not text:
        return True
    try:
        return ipaddress.ip_address(text).is_unspecified
    except ValueError:
        return False  # a hostname; it must resolve to one specific address


def ollama_base_url():
    host = os.environ.get("OLLAMA_HOST") or DEFAULT_OLLAMA_HOST
    if "://" not in host:
        host = "http://" + host
    return host.rstrip("/")


def model_name():
    return os.environ.get("HUB_MODEL") or DEFAULT_MODEL


def answer_timeout():
    return env_float("HUB_ANSWER_TIMEOUT_SECONDS", 120.0)


def max_answer_chars():
    # never disabled: cap <= 0 would mean "no truncation"
    return max(1, env_int("HUB_MAX_ANSWER_CHARS", 1200))


def num_ctx():
    return env_int("OLLAMA_CONTEXT_LENGTH", 8192)


def max_concurrent_answers():
    """Concurrent model runs the hub allows, sized from OLLAMA_NUM_PARALLEL (blueprint: 4)."""
    return max(1, env_int("OLLAMA_NUM_PARALLEL", 4))


# --- model call and answer shaping ---------------------------------------------


def build_user_content(question, loc):
    """The loc line is stripped from the question and passed as structured data."""
    if loc is None:
        return question
    return "%s\n\nAsker location (lat, lon): %s, %s" % (question, loc["lat"], loc["lon"])


def build_chat_payload(question, loc):
    return {
        "model": model_name(),
        "stream": False,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_content(question, loc)},
        ],
        "options": {"num_ctx": num_ctx()},
    }


def call_model(question, loc):
    """POST /api/chat to the local Ollama server; return the raw answer text.

    HUB_ANSWER_TIMEOUT_SECONDS is a total wall-clock deadline, not a
    per-socket-operation timeout, so a trickling response cannot keep the
    hub waiting past it.
    """
    url = ollama_base_url() + "/api/chat"
    payload = build_chat_payload(question, loc)
    timeout = answer_timeout()
    outcome = {}

    def fetch():
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                outcome["raw"] = resp.read()
        except Exception as e:  # mapped by the caller below
            outcome["error"] = e

    worker = threading.Thread(target=fetch, daemon=True)
    worker.start()
    worker.join(max(0.0, timeout))
    if worker.is_alive():
        raise ModelTimeout("ollama did not answer within %gs" % timeout)
    if "error" in outcome:
        e = outcome["error"]
        if isinstance(e, urllib.error.HTTPError):
            raise ModelError("ollama returned HTTP %s" % e.code) from e
        if isinstance(e, urllib.error.URLError):
            reason = getattr(e, "reason", e)
            if isinstance(reason, (socket.timeout, TimeoutError)):
                raise ModelTimeout("ollama did not answer within %gs" % timeout) from e
            raise ModelError("ollama unreachable at %s: %s" % (url, reason)) from e
        if isinstance(e, (socket.timeout, TimeoutError)):
            raise ModelTimeout("ollama did not answer within %gs" % timeout) from e
        raise ModelError("model call failed: %s" % e) from e
    raw = outcome["raw"]
    try:
        content = json.loads(raw.decode("utf-8"))["message"]["content"]
    except (ValueError, KeyError, TypeError) as e:
        raise ModelError("malformed response from ollama") from e
    if not isinstance(content, str) or not content.strip():
        raise ModelError("ollama returned an empty answer")
    return content.strip()


def truncate_at_sentence(text, cap):
    """Truncate to at most cap characters, cutting at a sentence boundary."""
    if cap <= 0 or len(text) <= cap:
        return text
    head = text[:cap]
    end = max(head.rfind("."), head.rfind("!"), head.rfind("?"), head.rfind("…"))
    if end >= cap // 2:
        return head[: end + 1].rstrip()
    space = head.rfind(" ")
    if space > 0:
        return head[:space].rstrip()
    return head


def finalize_answer(raw):
    """Cap the answer length, then make sure the answer ENDS with the disclaimer."""
    text = truncate_at_sentence(raw.strip(), max_answer_chars())
    if not text.endswith(DISCLAIMER):
        text = text + "\n" + DISCLAIMER
    return text


def error_answer(reason):
    """The answer sent when the model call fails; it tells the asker to retry."""
    return finalize_answer(
        "The hub could not answer right now (%s). Please retry your question." % reason
    )


def answer_question(question, loc):
    """Run the model and shape the answer. Raises ModelError/ModelTimeout."""
    return finalize_answer(call_model(question, loc))


def post_callback(callback_url, sender, answer):
    """POST {sender, answer} to the BitChat peer so it can relay over the mesh."""
    req = urllib.request.Request(
        callback_url,
        data=json.dumps({"sender": sender, "answer": answer}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=CALLBACK_TIMEOUT_SECONDS) as resp:
        resp.read()


def busy_payload():
    """The 429 body: the hub is saturated; the asker should retry."""
    return {
        "status": "busy",
        "error": BUSY_REASON + "; please retry your question",
        "answer": error_answer(BUSY_REASON),
    }


def run_async(request, slots=None):
    """Worker-thread body: answer the question, then POST it to callback_url.

    Never raises: whatever goes wrong after the 202 ack, the asker still gets
    an answer (the retry error answer on failure), and the concurrency slot
    is always released.
    """
    sender = request["sender"]
    try:
        try:
            answer = answer_question(request["question"], request["loc"])
        except Exception as e:  # ModelError and anything else: never drop the asker
            reason = str(e) or e.__class__.__name__
            log.warning("answering %s failed: %s", sender, reason)
            answer = error_answer(reason)
        if not request["callback_url"]:
            log.warning("no callback_url for %s; answer not delivered", sender)
            return
        try:
            post_callback(request["callback_url"], sender, answer)
        except Exception as e:
            log.warning(
                "callback to %s failed (%s); retrying once", request["callback_url"], e
            )
            post_callback(request["callback_url"], sender, answer)
        log.info("answered %s (%d chars)", sender, len(answer))
    except Exception as e:
        log.error("could not deliver an answer to %s: %s", sender, e)
    finally:
        if slots is not None:
            slots.release()


# --- HTTP shell -----------------------------------------------------------------


class ResponderHandler(BaseHTTPRequestHandler):
    server_version = "HubResponder/1.0"
    protocol_version = "HTTP/1.1"
    timeout = 30  # bound how long a half-sent request can hold a thread

    def _send_json(self, status, payload, close=False):
        if close:
            # the request body was not (fully) read; do not reuse the connection
            self.close_connection = True
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if close:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            self._send_json(200, {"status": "ok"})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/ask":
            self._send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send_json(400, {"error": "invalid Content-Length"}, close=True)
            return
        if length <= 0:
            self._send_json(400, {"error": "missing request body"})
            return
        if length > MAX_BODY_BYTES:
            self._send_json(413, {"error": "request body too large"}, close=True)
            return
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"error": "body is not valid JSON"})
            return
        try:
            request = validate_ask_payload(body, peer_host=self.client_address[0])
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
            return
        slots = self.server.answer_slots
        if request["wait"]:
            if not slots.acquire(blocking=False):
                self._send_json(429, busy_payload())
                return
            try:
                try:
                    answer = answer_question(request["question"], request["loc"])
                except Exception as e:  # ModelError and anything else
                    reason = str(e) or e.__class__.__name__
                    log.warning("model call failed for %s: %s", request["sender"], reason)
                    self._send_json(
                        502,
                        {
                            "sender": request["sender"],
                            "answer": error_answer(reason),
                            "error": reason,
                        },
                    )
                    return
                self._send_json(200, {"sender": request["sender"], "answer": answer})
            finally:
                slots.release()
            return
        if not slots.acquire(blocking=False):
            self._send_json(429, busy_payload())
            return
        try:
            threading.Thread(
                target=run_async, args=(request, slots), daemon=True
            ).start()
        except Exception:
            slots.release()
            raise
        self._send_json(202, {"status": "accepted", "ack": ACK})

    def log_message(self, fmt, *args):
        log.debug("%s - %s", self.address_string(), fmt % args)


class ResponderServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler_class, max_concurrent=4):
        super().__init__(address, handler_class)
        # bounds concurrent model runs; sized from OLLAMA_NUM_PARALLEL (blueprint: 4)
        self.answer_slots = threading.BoundedSemaphore(max(1, max_concurrent))


def make_server(host, port):
    return ResponderServer((host, port), ResponderHandler, max_concurrent_answers())


def main():
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    validate_numeric_env()
    bind = os.environ.get("HUB_BIND", "127.0.0.1").strip()
    if is_wildcard_bind(bind):
        sys.exit(
            "refusing HUB_BIND=%r; bind the hub's specific local-link address, "
            "never a wildcard address (0.0.0.0, ::, ...)" % bind
        )
    port = env_int("HUB_PORT", 8080)
    server = make_server(bind, port)
    log.info(
        "hub responder on http://%s:%d, ollama at %s, model %s",
        bind,
        port,
        ollama_base_url(),
        model_name(),
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
