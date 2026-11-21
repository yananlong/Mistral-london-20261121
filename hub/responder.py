#!/usr/bin/env python3
"""Offline hub responder: the DGX Spark side of the Ask flow.

A BitChat peer (the demo Mac) POSTs plain-text mesh questions here over the
local link, and this server answers them with the local Ollama model. No
cloud API is ever called. The only outbound HTTP is the local Ollama
endpoint and the caller's callback_url, whose host must be local/private
(see callback_host_allowed).

Endpoints:
    GET  /health -> 200 {"status": "ok"}
    POST /api/chat -> Ollama-compatible, loopback only, for the Swift hub in
                    the BitChat build: the hub's system prompt, knowledge
                    base, model tag and queue are applied; no ack, no label.
    POST /ask    -> JSON {sender, question, loc?, callback_url?, wait?}
                    202 {"status": "accepted", "ack": ...} in async mode
                    (callback_url required), or 200 {"sender", "ack",
                    "answer", "parts", "status"} when wait=true. "parts"
                    are the mesh messages to send, each <= 255 UTF-8 bytes.

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
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import kb

log = logging.getLogger("hub.responder")

ACK = "Received. Working on an answer."
DISCLAIMER = "AI answer from an open-weight model on the hub. Not verified emergency advice."
# Demo decision: the fp16 build is the one pulled on the Spark. The q4_K_M tag
# named in BLUEPRINT_1.md is not pulled, so defaulting to it made every Ask
# fail with HTTP 404. Override with HUB_MODEL (setup_spark.sh: MODEL_TAG).
DEFAULT_MODEL = "ministral-3:14b-instruct-2512-fp16"
DEFAULT_OLLAMA_PORT = 11434

# "Short numbered steps in plain language, with the most urgent action first"
# (BLUEPRINT_1.md). The extra rules come from the hub eval's prompt A/B: the
# first prompt never said 999 on life-threatening questions, used US units,
# wrote Markdown and invented place names. Later rounds (prompt C): 999 is
# step 1 only when someone is in danger now, never untreated water, name only
# places from the dataset facts, and the mesh only reaches people nearby.
SYSTEM_PROMPT = (
    "You are the assistant on an offline hub in a disaster area in the UK. "
    "People reach you over a Bluetooth mesh, so answers travel slowly. Answer "
    "in short numbered steps in plain language, with the most urgent action "
    "first.\n"
    "Step 1 is \"Call 999 (or 112) if any phone works; if not, send someone "
    "to get help\" whenever someone is injured, ill, trapped or in danger "
    "right now, and whenever the question is about a hospital or A&E. Do not "
    "add this step when nobody is in danger.\n"
    "The hub has offline maps (hospitals, water points, shelters, food banks) "
    "and official UK guides. When facts from them are included in the "
    "message, use them and name the place with its distance and direction, but do "
    "not describe a route. Name only places "
    "given in those facts; never name other hospitals, streets, shops or "
    "landmarks from memory, and never invent addresses, distances, times or "
    "phone numbers. Only when the question asks where something is and no "
    "facts were given, say the hub has no matching place nearby and suggest "
    "the app's map; otherwise do not mention places.\n"
    "You have no live information about the current disaster: no live alerts, "
    "news or feeds. Say so when asked.\n"
    "You cannot send messages or contact anyone. The mesh only reaches people "
    "nearby.\n"
    "Never suggest drinking untreated water.\n"
    "Use UK units (litres, metres, °C) and UK emergency numbers (999, 112, "
    "111, 105).\n"
    "Plain text only, no Markdown: no bold, no headings, no bullet sub-lists.\n"
    "At most 6 steps, under 120 words. Answer in the language of the question."
)

MAX_BODY_BYTES = 1 << 20  # mesh messages are short text; 1 MiB is generous
CALLBACK_TIMEOUT_SECONDS = 30
MAX_QUESTION_CHARS = 4000  # per-field cap: a question is a short mesh text
MAX_SENDER_CHARS = 64
BUSY_REASON = "the hub is busy answering other questions"

# BitChat rejects a private message whose content is over 255 UTF-8 bytes
# (bitchat/Protocols/Packets.swift, PrivateMessagePacket.encode: 1-byte TLV
# length). So an answer crosses the mesh as parts "(i/n) <text>", each at most
# 255 bytes, with the disclaimer alone as the last part. This is the wire
# format of protocol/README.md (PR #17); split_answer() is a port of its
# reference implementation.
MAX_MESSAGE_BYTES = 255
PART_BODY_BYTES = MAX_MESSAGE_BYTES - len("(9/9) ")
PROTOCOL_MAX_ANSWER_PARTS = 9  # "(i/n) " has one digit each
DEFAULT_MAX_ANSWER_PARTS = 5  # 4 body parts + the disclaimer part
MAX_QUESTION_BYTES = 200  # a question plus its loc line fits one message
# The one-message reply when the hub cannot answer (protocol HUB_ERROR_TEXT).
HUB_ERROR_TEXT = "The hub could not answer right now. Please try again."
# Byte budget of the whole answer text, disclaimer included: about 700 bytes
# of model text, which normally packs into 3 body parts.
DEFAULT_MAX_ANSWER_BYTES = 780
# Total deadline for one question, from arrival: queue wait plus model run.
# Measured on the Spark (fp16): one answer alone decodes at about 9 tok/s
# (warm about 26 s, cold about 36 s); four in parallel decode at about
# 3.5 tok/s each. num_predict bounds a run at 233 tokens by default, about
# 67 s in the worst case (four in parallel). A queued question waits at most
# 25 s, so it still has 75 s for its own run inside the 100 s deadline.
DEFAULT_ANSWER_TIMEOUT_SECONDS = 100.0
DEFAULT_QUEUE_WAIT_SECONDS = 25.0
DEFAULT_NUM_PREDICT = 256  # upper bound; the default is sized to the byte budget
DEFAULT_MAX_QUEUED = 16

LOC_LINE_RE = re.compile(
    r"^\s*loc:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$", re.IGNORECASE
)


APPROX_LOC_RE = re.compile(
    r"\n*The person's approximate location:\s*(-?\d{1,3}(?:\.\d+)?)\s*,"
    r"\s*(-?\d{1,3}(?:\.\d+)?)\s*\(London, UK\)\.\s*$"
)


class ModelError(Exception):
    """The local model call failed (unreachable, bad response, empty answer).

    str(e) is the detail for the hub log. `public` is the short reason that
    goes to the asker over the mesh: no URLs, no internals.
    """

    public = "the model gave no usable answer"
    code = None  # Ollama's HTTP status, when it answered with an error

    def __init__(self, detail, public=None, code=None):
        super().__init__(detail)
        if public is not None:
            self.public = public
        self.code = code


class ModelTimeout(ModelError):
    """The local model call exceeded the answer deadline."""

    public = "the model took too long"


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
    if "." not in host and ":" not in host:
        # a single-label name ("mac", "mac-peer") is a local-link name, never
        # a public internet host
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
    # the mesh contract caps a question at 200 UTF-8 bytes; cut, do not reject
    question = prefix_bytes(question, MAX_QUESTION_BYTES).rstrip()
    if not wait and callback_url is None:
        # without it the answer could not be delivered: the asker would see
        # "Received by hub" forever
        raise ValueError("callback_url is required unless wait is true")
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
    ("HUB_MAX_ANSWER_BYTES", int, 1, None),
    ("HUB_NUM_PREDICT", int, 1, None),
    ("HUB_MAX_ANSWER_PARTS", int, 2, PROTOCOL_MAX_ANSWER_PARTS),
    ("HUB_QUEUE_WAIT_SECONDS", float, 0, None),
    ("HUB_MAX_QUEUED", int, 0, None),
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
    problems.extend(config_problems())
    if problems:
        sys.exit("invalid hub configuration: " + "; ".join(problems))


def is_cloud_model_tag(tag):
    """Ollama ':cloud' / '-cloud' tags run off the box. The hub never uses them."""
    name = tag.strip().lower()
    return name.endswith(":cloud") or name.endswith("-cloud")


def config_problems():
    """Settings that would break the offline rule: a cloud tag or a public Ollama address."""
    problems = []
    if is_cloud_model_tag(model_name()):
        problems.append(
            "HUB_MODEL=%r is a cloud tag; the hub only runs local open-weight models"
            % model_name()
        )
    host = urllib.parse.urlparse(ollama_base_url()).hostname or ""
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        addr = None  # a hostname: resolved on the local link
    if addr is not None and (
        addr.is_unspecified
        or not (addr.is_loopback or addr.is_private or addr.is_link_local)
    ):
        problems.append(
            "OLLAMA_HOST=%s is not a loopback or local-link address" % ollama_base_url()
        )
    return problems


def is_wildcard_bind(bind):
    """True for any wildcard bind form: "", 0.0.0.0, ::, 0:0:0:0:0:0:0:0, [::], ..."""
    text = bind.strip().strip("[]")
    if not text:
        return True
    try:
        return ipaddress.ip_address(text).is_unspecified
    except ValueError:
        return False  # a hostname; it must resolve to one specific address


def local_link_ip():
    """SPARK_LOCAL_LINK_IP: the address setup_spark.sh binds Ollama to."""
    return (os.environ.get("SPARK_LOCAL_LINK_IP") or "").strip()


def default_bind():
    return local_link_ip() or "127.0.0.1"


def ollama_base_url():
    """OLLAMA_HOST, else the local-link address that setup_spark.sh binds, else loopback."""
    host = (os.environ.get("OLLAMA_HOST") or "").strip()
    if not host:
        host = "%s:%d" % (local_link_ip() or "127.0.0.1", DEFAULT_OLLAMA_PORT)
    if "://" not in host:
        host = "http://" + host
    return host.rstrip("/")


def model_name():
    return os.environ.get("HUB_MODEL") or DEFAULT_MODEL


def answer_timeout():
    """Total deadline for one question, from arrival: queue wait plus model run."""
    return env_float("HUB_ANSWER_TIMEOUT_SECONDS", DEFAULT_ANSWER_TIMEOUT_SECONDS)


def queue_wait_seconds():
    """Longest a question waits for a free model slot before the busy answer."""
    return max(0.0, env_float("HUB_QUEUE_WAIT_SECONDS", DEFAULT_QUEUE_WAIT_SECONDS))


def max_queued():
    return max(0, env_int("HUB_MAX_QUEUED", DEFAULT_MAX_QUEUED))


def max_answer_chars():
    # never disabled: cap <= 0 would mean "no truncation"
    return max(1, env_int("HUB_MAX_ANSWER_CHARS", 1200))


def max_answer_bytes():
    """UTF-8 byte budget of the whole answer message, disclaimer included."""
    return max(1, env_int("HUB_MAX_ANSWER_BYTES", DEFAULT_MAX_ANSWER_BYTES))


def model_part_max_bytes():
    """Bytes left for the model's text once the newline and disclaimer are reserved."""
    return max(1, max_answer_bytes() - len(DISCLAIMER.encode("utf-8")) - 1)


def num_predict():
    """Token cap for one answer: the byte budget at about 3 bytes per token, at most 256."""
    sized = min(DEFAULT_NUM_PREDICT, max(32, model_part_max_bytes() // 3))
    return max(1, env_int("HUB_NUM_PREDICT", sized))


def max_answer_parts():
    """Most mesh messages one answer may take, the disclaimer part included (2..9)."""
    parts = env_int("HUB_MAX_ANSWER_PARTS", DEFAULT_MAX_ANSWER_PARTS)
    return min(PROTOCOL_MAX_ANSWER_PARTS, max(2, parts))


def keep_alive():
    """Sent with every request so the model stays loaded (blueprint: OLLAMA_KEEP_ALIVE=-1)."""
    raw = (os.environ.get("OLLAMA_KEEP_ALIVE") or "-1").strip()
    try:
        return int(raw)
    except ValueError:
        return raw  # a duration string such as "30m"


def num_ctx():
    return env_int("OLLAMA_CONTEXT_LENGTH", 8192)


def max_concurrent_answers():
    """Concurrent model runs the hub allows, sized from OLLAMA_NUM_PARALLEL (blueprint: 4)."""
    return max(1, env_int("OLLAMA_NUM_PARALLEL", 4))


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
        "keep_alive": keep_alive(),
        "options": {"num_ctx": num_ctx(), "num_predict": num_predict()},
    }


def call_model(question, loc, timeout=None):
    """POST /api/chat to the local Ollama server; return the raw answer text.

    `timeout` (default HUB_ANSWER_TIMEOUT_SECONDS) is a total wall-clock
    deadline, not a per-socket-operation timeout, so a trickling response
    cannot keep the hub waiting past it.
    """
    reply, content = parse_chat_reply(
        ollama_chat_raw(build_chat_payload(question, loc), timeout)
    )
    return tidy_model_content(reply, content)


def parse_chat_reply(raw):
    """(reply object, answer text) from a non-stream /api/chat response body."""
    try:
        reply = json.loads(raw.decode("utf-8"))
        content = reply["message"]["content"]
    except (ValueError, KeyError, TypeError) as e:
        raise ModelError("malformed response from ollama") from e
    if not isinstance(content, str) or not content.strip():
        raise ModelError("ollama returned an empty answer")
    return reply, content.strip()


def tidy_model_content(reply, content):
    """Drop the unfinished last sentence when num_predict stopped the model."""
    if reply.get("done_reason") == "length":
        content = drop_unfinished_tail(content)
    return content


def drop_unfinished_tail(text):
    """Cut back to the last finished sentence; keep the text when there is none."""
    end = -1
    for m in SENTENCE_END_RE.finditer(text):
        if not LIST_MARKER_AT_END_RE.search(text[: m.end()]):
            end = m.end()
    if end <= 0:
        return text
    cut = text[:end].rstrip()
    return DANGLING_MARKER_RE.sub("", cut).rstrip() or text


def ollama_chat_raw(payload, timeout=None):
    """POST the payload to Ollama /api/chat; return the raw response body.

    Raises ModelTimeout after `timeout` seconds of wall clock, and ModelError
    when Ollama is unreachable or answers with an HTTP error.
    """
    url = ollama_base_url() + "/api/chat"
    if timeout is None:
        timeout = answer_timeout()
    timeout = max(0.001, timeout)
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
            public = (
                "the model is not installed on the hub"
                if e.code == 404
                else "the model server returned an error"
            )
            raise ModelError("ollama returned HTTP %s" % e.code, public, e.code) from e
        if isinstance(e, urllib.error.URLError):
            reason = getattr(e, "reason", e)
            if isinstance(reason, (socket.timeout, TimeoutError)):
                raise ModelTimeout("ollama did not answer within %gs" % timeout) from e
            raise ModelError(
                "ollama unreachable at %s: %s" % (url, reason),
                "the model server is not reachable",
            ) from e
        if isinstance(e, (socket.timeout, TimeoutError)):
            raise ModelTimeout("ollama did not answer within %gs" % timeout) from e
        raise ModelError("model call failed: %s" % e, "the model call failed") from e
    return outcome["raw"]


# --- Ollama-compatible /api/chat for the Swift hub (BitChat build) ---------------


def parse_chat_user_content(content):
    """(question, loc) from the user message that the Swift hub sends.

    The Swift hub appends "The person's approximate location: <lat>, <lon>
    (London, UK)." (protocol/README.md, "Prompt"). A trailing "loc:" line is
    understood too. Anything else is all question.
    """
    text = content.replace("\r\n", "\n").replace("\r", "\n").strip()
    m = APPROX_LOC_RE.search(text)
    if m:
        try:
            return text[: m.start()].strip(), parse_loc(m.group(1), m.group(2))
        except ValueError:
            pass
    try:
        return parse_question(text)
    except ValueError:
        return text, None


def build_proxy_chat_payload(body):
    """Turn the Swift hub's /api/chat request into the hub's own model request.

    Keeps only the question (the last user message) and its location. The
    system prompt, knowledge-base facts, model tag and options are the hub's,
    exactly as for /ask, whatever the caller sent. Raises ValueError (400).
    """
    if not isinstance(body, dict):
        raise ValueError("body must be a JSON object")
    messages = body.get("messages")
    if not isinstance(messages, list):
        raise ValueError("messages must be a list")
    users = [
        m["content"] for m in messages
        if isinstance(m, dict) and m.get("role") == "user" and isinstance(m.get("content"), str)
    ]
    if not users:
        raise ValueError("messages must hold a user message")
    if len(users[-1]) > MAX_QUESTION_CHARS:
        raise ValueError("question is too long (max %d chars)" % MAX_QUESTION_CHARS)
    question, loc = parse_chat_user_content(users[-1])
    question = prefix_bytes(question, MAX_QUESTION_BYTES).rstrip()
    if not question:
        raise ValueError("question text is empty")
    payload = build_chat_payload(question, loc)
    # Ollama streams unless the caller says "stream": false
    payload["stream"] = body.get("stream", True) is not False
    # Keep the caller's options (the Swift hub sends temperature and
    # num_predict). num_predict is capped, so a run fits the hub's deadline.
    # num_ctx is set to the hub's value (8192) when the caller sends none:
    # measured on the Spark, a request without num_ctx made Ollama reload the
    # model at its default context (262144 tokens, 69 GB), and it reloaded
    # again for every /ask at 8192.
    options = dict(body["options"]) if isinstance(body.get("options"), dict) else {}
    options.setdefault("num_ctx", num_ctx())
    asked = options.get("num_predict")
    cap = num_predict()
    if not isinstance(asked, int) or isinstance(asked, bool) or asked <= 0 or asked > cap:
        options["num_predict"] = cap
    payload["options"] = options
    return payload


def proxy_chat_payload_or_original(body):
    """build_proxy_chat_payload with a fail-safe.

    A malformed request is still a ValueError (400). If anything else fails
    (the knowledge base, the prompt override), the caller's own request goes
    to Ollama unchanged except for the model tag, so the hub still answers.
    """
    try:
        return build_proxy_chat_payload(body)
    except ValueError:
        raise
    except Exception as e:
        log.error("/api/chat override failed (%s); forwarding the caller's request", e)
        payload = dict(body)
        payload["model"] = model_name()
        payload["stream"] = body.get("stream", True) is not False
        return payload


def shape_proxy_reply(raw):
    """Same JSON shape as Ollama's reply; only message.content is tidied to plain text."""
    try:
        reply, content = parse_chat_reply(raw)
    except ModelError:
        return raw  # not ours to fix: the caller handles a bad reply
    reply["message"]["content"] = tidy_model_content(reply, strip_markdown(content))
    return json.dumps(reply).encode("utf-8")


SENTENCE_END_RE = re.compile(r"[.!?…]+(?=\s|$)")
# A bare "3." or "3)" is a list marker, not a sentence end. One or two digits
# only, so "Call 999." still ends a sentence.
LIST_MARKER_AT_END_RE = re.compile(r"(?:^|\s)\d{1,2}[.)]$")
# A list marker ("3.", "-", "*") left with nothing after it by a cut.
DANGLING_MARKER_RE = re.compile(r"(?:^|\s)(?:\d{1,2}[.)]|[-*•])[ \t]*$")
MARKDOWN_BOLD_RE = re.compile(r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1")
MARKDOWN_HEADING_RE = re.compile(r"(?m)^[ \t]*#{1,6}[ \t]+")


def strip_markdown(text):
    """Answers are plain-text mesh messages: drop Markdown bold and headings."""
    return MARKDOWN_HEADING_RE.sub("", MARKDOWN_BOLD_RE.sub(r"\2", text))


def truncate_at_sentence(text, cap, max_bytes=None):
    """Truncate to at most `cap` characters and `max_bytes` UTF-8 bytes.

    Cuts at the last sentence end, else the last line break, else the last
    space. A list marker ("3.") never counts as a sentence end, and a cut
    never leaves a bare list marker as the last line.
    """
    fits_chars = cap <= 0 or len(text) <= cap
    fits_bytes = max_bytes is None or len(text.encode("utf-8")) <= max_bytes
    if fits_chars and fits_bytes:
        return text
    head = text if cap <= 0 else text[:cap]
    if max_bytes is not None:
        # errors="ignore" drops a multi-byte character split by the byte cut
        head = head.encode("utf-8")[:max_bytes].decode("utf-8", "ignore")
    limit = len(head)
    end = -1
    for m in SENTENCE_END_RE.finditer(text):
        if m.end() > limit:
            break
        if not LIST_MARKER_AT_END_RE.search(text[: m.end()]):
            end = m.end()
    if end >= limit // 2:
        cut = head[:end]
    else:
        newline = head.rfind("\n")
        space = head.rfind(" ")
        if newline >= limit // 2:
            cut = head[:newline]
        elif space > 0:
            cut = head[:space]
        else:
            cut = head
    cut = cut.rstrip()
    while True:
        trimmed = DANGLING_MARKER_RE.sub("", cut).rstrip()
        if trimmed == cut or not trimmed:
            break
        cut = trimmed
    return cut


def prefix_bytes(text, limit):
    """Longest prefix of text with at most `limit` UTF-8 bytes, never splitting a character."""
    return text.encode("utf-8")[: max(0, limit)].decode("utf-8", "ignore")


def split_answer(body, max_body_parts=PROTOCOL_MAX_ANSWER_PARTS - 1):
    """Pack body lines into chunks that fit one mesh message after the "(i/n) " prefix.

    A port of split_answer in protocol/make_vectors.py (PR #17): pack whole
    lines while they fit, break a line that is too long at its last space in
    the second half, else at the byte limit. Chunks past max_body_parts are
    dropped and the last kept one ends with an ellipsis.
    """
    limit = PART_BODY_BYTES
    chunks, cur = [], ""
    for line in body.split("\n"):
        while len(line.encode("utf-8")) > limit:
            head = prefix_bytes(line, limit)
            space = head.rfind(" ")
            if space >= len(head) // 2:
                head = head[:space]
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(head)
            line = line[len(head):].lstrip()
        candidate = line if cur == "" else cur + "\n" + line
        if len(candidate.encode("utf-8")) <= limit:
            cur = candidate
        else:
            chunks.append(cur)
            cur = line
    chunks.append(cur)
    chunks = [c.strip() for c in chunks if c.strip()]
    if len(chunks) > max_body_parts:
        chunks = chunks[:max_body_parts]
        chunks[-1] = prefix_bytes(chunks[-1], limit - len("\u2026".encode("utf-8"))).rstrip() + "\u2026"
    return chunks


def compose_answer(raw):
    """Shape the model output into (answer, parts).

    `parts` are the mesh messages in send order: "(i/n) <text>", each at most
    255 UTF-8 bytes, the last one the disclaimer alone. `answer` is the same
    text in one string: the part texts joined with newlines, so it ENDS with
    the disclaimer. Both are plain text within HUB_MAX_ANSWER_BYTES.
    """
    lines = raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    text = strip_markdown("\n".join(lines).strip())
    if DISCLAIMER in text:
        # the hub adds the label itself, once, as the last part: drop any copy
        # the model wrote (protocol/README.md, "Compose the answer")
        kept = [re.sub(r" {2,}", " ", line.replace(DISCLAIMER, "")).rstrip()
                for line in text.split("\n")]
        text = "\n".join(
            line for line, orig in zip(kept, text.split("\n"))
            if line.strip() or DISCLAIMER not in orig
        ).strip()
    text = truncate_at_sentence(text, max_answer_chars(), model_part_max_bytes())
    chunks = split_answer(text, max_answer_parts() - 1)
    texts = chunks + [DISCLAIMER]
    parts = ["(%d/%d) %s" % (i, len(texts), t) for i, t in enumerate(texts, 1)]
    return "\n".join(texts), parts


def finalize_answer(raw):
    """The answer as one string: plain text, within the byte budget, ENDING with the disclaimer."""
    return compose_answer(raw)[0]


def assemble_parts(parts):
    """The answer text that a phone rebuilds from the "(i/n) " parts (for tests and checks)."""
    return "\n".join(p.split(") ", 1)[1] for p in parts)


def error_answer(reason):
    """The answer sent when the hub cannot answer; it tells the asker to retry.

    It starts with "No answer:" so nobody mistakes it for advice, and it
    still ends with the disclaimer like every second message from the hub.
    """
    return finalize_answer(
        "No answer: the hub could not answer right now (%s). "
        "Please retry your question." % reason
    )


def busy_answer():
    """The answer for a question that waited HUB_QUEUE_WAIT_SECONDS without a free slot."""
    return finalize_answer(
        "No answer: %s. Please retry your question in a minute." % BUSY_REASON
    )


def answer_question(question, loc, timeout=None):
    """Run the model and shape the answer. Raises ModelError/ModelTimeout."""
    return answer_with_parts(question, loc, timeout)[0]


def answer_with_parts(question, loc, timeout=None):
    """Run the model; return (answer, parts). Raises ModelError/ModelTimeout."""
    answer, parts = compose_answer(call_model(question, loc, timeout))
    if len(parts) < 2:  # nothing but the disclaimer
        raise ModelError("the model answer was empty after shaping")
    return answer, parts


def produce_answer(server, request, arrived=None):
    """Queue for a model slot, run the model and return (status, answer, parts, detail).

    status is "answered", "busy" (no slot within HUB_QUEUE_WAIT_SECONDS, or
    the queue is full) or "error". `parts` are the mesh messages to send: the
    "(i/n) " answer parts, or the single HUB_ERROR_TEXT message when there is
    no answer. Never raises. The total time from `arrived` stays within
    HUB_ANSWER_TIMEOUT_SECONDS.
    """
    if arrived is None:
        arrived = time.monotonic()
    deadline = arrived + answer_timeout()
    sender = request["sender"]
    wait = min(queue_wait_seconds(), max(0.0, deadline - time.monotonic()))
    if not server.acquire_slot(wait):
        log.warning("no model slot for %s within %gs; sending the busy answer", sender, wait)
        return "busy", busy_answer(), [HUB_ERROR_TEXT], BUSY_REASON
    try:
        remaining = deadline - time.monotonic()
        answer, parts = answer_with_parts(request["question"], request["loc"], remaining)
        return "answered", answer, parts, None
    except ModelError as e:
        log.warning("answering %s failed: %s", sender, e)
        return "error", error_answer(e.public), [HUB_ERROR_TEXT], str(e)
    except Exception as e:  # anything else: never drop the asker
        detail = str(e) or e.__class__.__name__
        log.warning("answering %s failed: %s", sender, detail)
        return "error", error_answer("internal error"), [HUB_ERROR_TEXT], detail
    finally:
        server.release_slot()


def post_callback(callback_url, sender, answer, status="answered", parts=None):
    """POST {sender, answer, parts, status} to the BitChat peer so it can relay over the mesh."""
    req = urllib.request.Request(
        callback_url,
        data=json.dumps(
            {"sender": sender, "answer": answer, "parts": parts or [], "status": status}
        ).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=CALLBACK_TIMEOUT_SECONDS) as resp:
        resp.read()


def run_async(request, server, arrived=None):
    """Worker-thread body: answer the question, then POST it to callback_url.

    Never raises: whatever goes wrong after the 202 ack, the asker still gets
    a second message (the retry or busy answer on failure).
    """
    sender = request["sender"]
    try:
        status, answer, parts, _ = produce_answer(server, request, arrived)
        try:
            post_callback(request["callback_url"], sender, answer, status, parts)
        except Exception as e:
            log.warning(
                "callback to %s failed (%s); retrying once", request["callback_url"], e
            )
            post_callback(request["callback_url"], sender, answer, status, parts)
        log.info(
            "%s %s (%d bytes, %d parts)", status, sender,
            len(answer.encode("utf-8")), len(parts),
        )
    except Exception as e:
        log.error("could not deliver an answer to %s: %s", sender, e)


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

    def do_chat_proxy(self, body):
        """POST /api/chat: Ollama-compatible, for the Swift hub in the BitChat build.

        No ack and no disclaimer here: the Swift side sends the ack, splits
        the answer into parts and adds the label. Loopback callers only (the
        Mac reaches it through `ssh -L`). Same queue and deadline as /ask.
        """
        arrived = time.monotonic()
        try:
            loopback = ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            loopback = False
        if not loopback:
            self._send_json(403, {"error": "/api/chat is served to loopback callers only"})
            return
        try:
            payload = proxy_chat_payload_or_original(body)
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
            return
        deadline = arrived + answer_timeout()
        wait = min(queue_wait_seconds(), max(0.0, deadline - time.monotonic()))
        if not self.server.acquire_slot(wait):
            log.warning("no model slot for /api/chat within %gs", wait)
            self._send_json(503, {"error": BUSY_REASON + "; please retry"})
            return
        try:
            remaining = deadline - time.monotonic()
            if payload["stream"]:
                self._proxy_stream(payload, remaining)
            else:
                raw = shape_proxy_reply(ollama_chat_raw(payload, remaining))
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                log.info("answered /api/chat in %.1fs", time.monotonic() - arrived)
        except ModelTimeout as e:
            log.warning("/api/chat failed: %s", e)
            self._send_json(504, {"error": str(e)})
        except ModelError as e:
            log.warning("/api/chat failed: %s", e)
            self._send_json(e.code or 502, {"error": str(e)})
        except Exception as e:
            log.warning("/api/chat failed: %s", e)
            self._send_json(502, {"error": "internal error"})
        finally:
            self.server.release_slot()

    def _proxy_stream(self, payload, timeout):
        """Pass Ollama's NDJSON stream through unchanged, within the deadline."""
        deadline = time.monotonic() + max(0.001, timeout)
        req = urllib.request.Request(
            ollama_base_url() + "/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            resp = urllib.request.urlopen(req, timeout=max(0.001, timeout))
        except urllib.error.HTTPError as e:
            raise ModelError("ollama returned HTTP %s" % e.code, None, e.code) from e
        except (socket.timeout, TimeoutError) as e:
            raise ModelTimeout("ollama did not answer within %gs" % timeout) from e
        except urllib.error.URLError as e:
            raise ModelError("ollama unreachable: %s" % getattr(e, "reason", e)) from e
        with resp:
            self.close_connection = True
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                for line in resp:
                    self.wfile.write(b"%x\r\n%s\r\n" % (len(line), line))
                    self.wfile.flush()
                    if time.monotonic() > deadline:
                        log.warning("/api/chat stream cut at the answer deadline")
                        break
            except (socket.timeout, TimeoutError):
                log.warning("/api/chat stream timed out")
            self.wfile.write(b"0\r\n\r\n")

    def do_POST(self):
        path = self.path.split("?")[0]
        if path not in ("/ask", "/api/chat"):
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
        if path == "/api/chat":
            self.do_chat_proxy(body)
            return
        try:
            request = validate_ask_payload(body, peer_host=self.client_address[0])
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
            return
        arrived = time.monotonic()
        if request["wait"]:
            status, answer, parts, detail = produce_answer(self.server, request, arrived)
            # "ack" lets a caller without a callback listener (remote testing
            # through an SSH tunnel) show both mesh messages from one response
            payload = {"sender": request["sender"], "ack": ACK, "answer": answer,
                       "parts": parts, "status": status}
            if status == "answered":
                self._send_json(200, payload)
            else:
                payload["error"] = detail
                self._send_json(503 if status == "busy" else 502, payload)
            return
        # The ack never waits on the model or on a free slot: the question
        # queues in its worker thread, and the answer follows by callback.
        threading.Thread(
            target=run_async, args=(request, self.server, arrived), daemon=True
        ).start()
        self._send_json(202, {"status": "accepted", "ack": ACK})

    def log_message(self, fmt, *args):
        log.debug("%s - %s", self.address_string(), fmt % args)


class ResponderServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    # the default listen backlog of 5 resets connections when 20 askers
    # arrive at once (seen on the Spark)
    request_queue_size = 128

    def __init__(self, address, handler_class, max_concurrent=4, max_queued=DEFAULT_MAX_QUEUED):
        super().__init__(address, handler_class)
        # Bounds concurrent model runs; sized from OLLAMA_NUM_PARALLEL
        # (blueprint: 4). The rest queue here ("answers several questions in
        # parallel and queues the rest"), at most max_queued at a time.
        self.answer_slots = threading.BoundedSemaphore(max(1, max_concurrent))
        self.max_queued = max(0, max_queued)
        self._queue_lock = threading.Lock()
        self._queued = 0

    def acquire_slot(self, timeout):
        """Take a model slot, queueing up to `timeout` seconds. False = hub busy."""
        if self.answer_slots.acquire(blocking=False):
            return True
        with self._queue_lock:
            if self._queued >= self.max_queued:
                return False
            self._queued += 1
        try:
            if timeout <= 0:
                return False
            return self.answer_slots.acquire(timeout=timeout)
        finally:
            with self._queue_lock:
                self._queued -= 1

    def release_slot(self):
        self.answer_slots.release()


def make_server(host, port):
    return ResponderServer(
        (host, port), ResponderHandler, max_concurrent_answers(), max_queued()
    )


def warm_up_model():
    """Best effort at startup: load the model so the first Ask is not a cold start.

    An empty /api/chat makes Ollama load the model (keep_alive keeps it
    loaded). A 404 here means the model tag is not pulled: say so loudly.
    """
    url = ollama_base_url() + "/api/chat"
    body = {"model": model_name(), "messages": [], "stream": False,
            "keep_alive": keep_alive(), "options": {"num_ctx": num_ctx()}}
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            resp.read()
        log.info("model %s is loaded and ready", model_name())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            log.error(
                "model %s is NOT in Ollama at %s: every Ask will fail. "
                "Pull it before going offline, or set HUB_MODEL to a pulled tag",
                model_name(), ollama_base_url(),
            )
        else:
            log.error("model warm-up failed: ollama returned HTTP %s", e.code)
    except Exception as e:
        log.error("model warm-up failed: ollama at %s: %s", ollama_base_url(), e)


def main():
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    validate_numeric_env()
    bind = (os.environ.get("HUB_BIND") or default_bind()).strip()
    if is_wildcard_bind(bind):
        sys.exit(
            "refusing HUB_BIND=%r; bind the hub's specific local-link address, "
            "never a wildcard address (0.0.0.0, ::, ...)" % bind
        )
    port = env_int("HUB_PORT", 8080)
    kb.get_kb()  # build the KB index once at startup, not on the first question
    server = make_server(bind, port)
    log.info(
        "hub responder on http://%s:%d, ollama at %s, model %s",
        bind,
        port,
        ollama_base_url(),
        model_name(),
    )
    log.info(
        "answer deadline %gs (queue wait up to %gs), %d parallel, answers <= %d bytes, "
        "num_predict %d",
        answer_timeout(), queue_wait_seconds(), max_concurrent_answers(),
        max_answer_bytes(), num_predict(),
    )
    if os.environ.get("HUB_WARMUP", "1").strip() != "0":
        threading.Thread(target=warm_up_model, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
