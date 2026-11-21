#!/usr/bin/env python3
"""Offline hub responder: the DGX Spark side of the Ask flow.

A BitChat peer (the demo Mac) POSTs plain-text mesh questions here over the
local link, and this server answers them with the local Ollama model. No
cloud API is ever called. The only outbound HTTP is the local Ollama
endpoint and the caller's callback_url.

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

import json
import logging
import os
import re
import socket
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import kb

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
    "information about the current disaster; say so when you do not know. "
    "When the message includes facts from the hub's datasets, use them for any "
    "place, distance or number, and do not invent others."
)

MAX_BODY_BYTES = 1 << 20  # mesh messages are short text; 1 MiB is generous
CALLBACK_TIMEOUT_SECONDS = 30

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

    The format is question lines plus an optional "loc: <lat>,<lon>" line.
    The loc line is stripped from the question and returned as structured
    data, or None when the message has no loc line.
    """
    loc = None
    lines = []
    for line in text.splitlines():
        m = LOC_LINE_RE.match(line)
        if m:
            loc = parse_loc(m.group(1), m.group(2))
        else:
            lines.append(line)
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


def validate_ask_payload(body):
    """Validate a parsed JSON POST /ask body and narrow it to an AskRequest.

    Returns {sender, question, loc, callback_url, wait}. Raises ValueError on
    malformed input; the handler turns that into a 400.
    """
    if not isinstance(body, dict):
        raise ValueError("body must be a JSON object")
    sender = body.get("sender")
    if not isinstance(sender, str) or not sender.strip():
        raise ValueError("sender must be a non-empty string")
    raw_question = body.get("question")
    if not isinstance(raw_question, str) or not raw_question.strip():
        raise ValueError("question must be a non-empty string")
    callback_url = body.get("callback_url")
    if callback_url is not None and (
        not isinstance(callback_url, str)
        or not callback_url.startswith(("http://", "https://"))
    ):
        raise ValueError("callback_url must be an http(s) URL")
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


# --- configuration (environment, read per call) --------------------------------


def ollama_base_url():
    host = os.environ.get("OLLAMA_HOST") or DEFAULT_OLLAMA_HOST
    if "://" not in host:
        host = "http://" + host
    return host.rstrip("/")


def model_name():
    return os.environ.get("HUB_MODEL") or DEFAULT_MODEL


def answer_timeout():
    return float(os.environ.get("HUB_ANSWER_TIMEOUT_SECONDS", "120"))


def max_answer_chars():
    return int(os.environ.get("HUB_MAX_ANSWER_CHARS", "1200"))


def num_ctx():
    return int(os.environ.get("OLLAMA_CONTEXT_LENGTH", "8192"))


# --- model call and answer shaping ---------------------------------------------


def kb_facts(question, loc):
    """Dataset facts for this question from the hub KB; [] when the KB is off or fails."""
    base = kb.get_kb()
    if base is None:
        return []
    try:
        return base.facts(question, loc)
    except Exception as e:  # the KB must never stop an answer
        log.warning("KB lookup failed: %s", e)
        return []


def build_user_content(question, loc):
    """The loc line is stripped from the question and passed as structured data.

    When the hub KB has matching facts, they follow as a numbered block.
    """
    content = question
    if loc is not None:
        content = "%s\n\nAsker location (lat, lon): %s, %s" % (question, loc["lat"], loc["lon"])
    facts = kb_facts(question, loc)
    if facts:
        content += "\n\n" + kb.format_facts(facts)
    return content


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
    """POST /api/chat to the local Ollama server; return the raw answer text."""
    url = ollama_base_url() + "/api/chat"
    req = urllib.request.Request(
        url,
        data=json.dumps(build_chat_payload(question, loc)).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    timeout = answer_timeout()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        raise ModelError("ollama returned HTTP %s" % e.code) from e
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, (socket.timeout, TimeoutError)):
            raise ModelTimeout("ollama did not answer within %gs" % timeout) from e
        raise ModelError("ollama unreachable at %s: %s" % (url, reason)) from e
    except (socket.timeout, TimeoutError) as e:
        raise ModelTimeout("ollama did not answer within %gs" % timeout) from e
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
    """Cap the answer length, then make sure the disclaimer is on it."""
    text = truncate_at_sentence(raw.strip(), max_answer_chars())
    if DISCLAIMER not in text:
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


def run_async(request):
    """Worker-thread body: answer the question, then POST it to callback_url."""
    sender = request["sender"]
    try:
        answer = answer_question(request["question"], request["loc"])
    except ModelError as e:
        log.warning("model call failed for %s: %s", sender, e)
        answer = error_answer(str(e))
    if not request["callback_url"]:
        log.warning("no callback_url for %s; answer not delivered", sender)
        return
    try:
        post_callback(request["callback_url"], sender, answer)
        log.info("answered %s (%d chars)", sender, len(answer))
    except (urllib.error.URLError, OSError) as e:
        log.error("callback to %s failed: %s", request["callback_url"], e)


# --- HTTP shell -----------------------------------------------------------------


class ResponderHandler(BaseHTTPRequestHandler):
    server_version = "HubResponder/1.0"
    protocol_version = "HTTP/1.1"

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
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
            self._send_json(400, {"error": "invalid Content-Length"})
            return
        if length <= 0:
            self._send_json(400, {"error": "missing request body"})
            return
        if length > MAX_BODY_BYTES:
            self._send_json(413, {"error": "request body too large"})
            return
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"error": "body is not valid JSON"})
            return
        try:
            request = validate_ask_payload(body)
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
            return
        if request["wait"]:
            try:
                answer = answer_question(request["question"], request["loc"])
            except ModelError as e:
                self._send_json(
                    502,
                    {
                        "sender": request["sender"],
                        "answer": error_answer(str(e)),
                        "error": str(e),
                    },
                )
                return
            self._send_json(200, {"sender": request["sender"], "answer": answer})
            return
        threading.Thread(target=run_async, args=(request,), daemon=True).start()
        self._send_json(202, {"status": "accepted", "ack": ACK})

    def log_message(self, fmt, *args):
        log.debug("%s - %s", self.address_string(), fmt % args)


class ResponderServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(host, port):
    return ResponderServer((host, port), ResponderHandler)


def main():
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    bind = os.environ.get("HUB_BIND", "127.0.0.1").strip()
    if bind in ("", "0.0.0.0", "::"):
        sys.exit(
            "refusing HUB_BIND=%r; bind the hub's specific local-link address, "
            "never 0.0.0.0" % bind
        )
    port = int(os.environ.get("HUB_PORT", "8080"))
    kb.get_kb()  # build the KB index once at startup, not on the first question
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
