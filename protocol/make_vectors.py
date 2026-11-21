#!/usr/bin/env python3
"""Reference implementation of the message contract in protocol/README.md.

Running it rewrites protocol/vectors.json. The app (TypeScript) and the hub
(Swift) test suites both read that file, so the two sides cannot drift apart.
"""
import json
import re
from pathlib import Path

HUB_NICKNAME = "hub"
ACK_TEXT = "Received. Working on an answer."
ANSWER_LABEL = "AI answer from an open-weight model on the hub. Not verified emergency advice."
HUB_ERROR_TEXT = "The hub could not answer right now. Please try again."
HUB_EMPTY_TEXT = "Send a question in plain words, for example: How do I make water safe to drink?"
LOCATION_SHARE_DEFAULT_NOTE = "Shared location"
MAX_QUESTION_UNITS = 500
MAX_ANSWER_BODY_UNITS = 900
ACK_TIMEOUT_MS = 30_000
ANSWER_TIMEOUT_MS = 150_000
HUB_MODEL_TIMEOUT_MS = 120_000

LOC_RE = re.compile(r"^loc:\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$")


def units(s):
    """Length in UTF-16 code units, the unit both JS and Swift (utf16) count."""
    return len(s.encode("utf-16-le")) // 2


def prefix_units(s, n):
    """Longest prefix of s with at most n UTF-16 units, never splitting a character."""
    out, used = [], 0
    for ch in s:
        w = units(ch)
        if used + w > n:
            break
        out.append(ch)
        used += w
    return "".join(out)


def normalize(text):
    return text.replace("\r\n", "\n").replace("\r", "\n")


def encode_loc(lat, lon):
    return f"loc: {lat:.5f},{lon:.5f}"


def decode_loc(line):
    m = LOC_RE.match(line.strip())
    if not m:
        return None
    lat, lon = float(m.group(1)), float(m.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {"lat": lat, "lon": lon}


def split_trailing_loc(text):
    """Return (body, loc). Only the last non-empty line can be a loc line."""
    lines = normalize(text).split("\n")
    while lines and lines[-1].strip() == "":
        lines.pop()
    if lines:
        loc = decode_loc(lines[-1])
        if loc is not None:
            return "\n".join(lines[:-1]).strip(), loc
    return "\n".join(lines).strip(), None


def encode_question(text, loc):
    body = normalize(text).strip()
    return body if loc is None else body + "\n" + encode_loc(loc["lat"], loc["lon"])


def parse_question(wire):
    body, loc = split_trailing_loc(wire)
    if body == "":
        return {"kind": "empty", "body": "", "loc": loc}
    return {"kind": "question", "body": prefix_units(body, MAX_QUESTION_UNITS), "loc": loc}


def user_content(body, loc):
    if loc is None:
        return body
    return f"{body}\n\nThe person's approximate location: {loc['lat']:.5f}, {loc['lon']:.5f} (London, UK)."


def truncate_body(body, limit=MAX_ANSWER_BODY_UNITS):
    if units(body) <= limit:
        return body
    cut = prefix_units(body, limit - 1)
    floor = limit // 2
    nl = cut.rfind("\n")
    if nl >= floor:
        cut = cut[:nl]
    else:
        sp = cut.rfind(" ")
        if sp >= floor:
            cut = cut[:sp]
    return cut.rstrip() + "…"


def compose_answer(model_output):
    """Wire text of the hub's second reply, or None when the hub must send HUB_ERROR_TEXT."""
    lines = [l for l in normalize(model_output).split("\n") if l.strip() != ANSWER_LABEL]
    body = "\n".join(lines).strip()
    if body == "":
        return None
    return truncate_body(body) + "\n" + ANSWER_LABEL


def classify_hub_reply(wire):
    text = normalize(wire).strip()
    if text == ACK_TEXT:
        return {"kind": "ack"}
    if text == HUB_ERROR_TEXT:
        return {"kind": "hub_error"}
    lines = text.split("\n")
    if lines[-1].strip() == ANSWER_LABEL:
        return {"kind": "answer", "body": "\n".join(lines[:-1]).strip()}
    return {"kind": "other"}


def encode_location_share(note, lat, lon):
    note = (note or "").strip() or LOCATION_SHARE_DEFAULT_NOTE
    return note + "\n" + encode_loc(lat, lon)


def decode_location_share(wire):
    body, loc = split_trailing_loc(wire)
    if loc is None:
        return None
    return {"note": body, "lat": loc["lat"], "lon": loc["lon"]}


# Ask state machine: (state, event) -> next state. Pairs not listed leave the state unchanged.
ASK_STATES = ["idle", "sent", "received", "answered", "unreachable", "failed"]
ASK_EVENTS = ["submit", "ack", "answer", "hub_error", "ack_timeout", "answer_timeout", "retry", "reset"]
ASK_TABLE = {
    ("idle", "submit"): "sent",
    ("sent", "ack"): "received",
    ("sent", "answer"): "answered",
    ("sent", "hub_error"): "failed",
    ("sent", "ack_timeout"): "unreachable",
    ("received", "answer"): "answered",
    ("received", "hub_error"): "failed",
    ("received", "answer_timeout"): "failed",
    ("unreachable", "ack"): "received",
    ("unreachable", "answer"): "answered",
    ("unreachable", "retry"): "sent",
    ("unreachable", "reset"): "idle",
    ("failed", "answer"): "answered",
    ("failed", "retry"): "sent",
    ("failed", "reset"): "idle",
    ("answered", "reset"): "idle",
}


LONG_STEPS = "\n".join(
    f"{i}. Step {i}: keep the casualty warm, still and talking, and check their breathing every few minutes."
    for i in range(1, 15)
)
LONG_ONE_LINE = " ".join(["Boil the water for one full minute before you drink it."] * 20)


def build():
    loc_a = {"lat": 51.5007, "lon": -0.1246}
    loc_b = {"lat": 51.52345, "lon": -0.08761}
    loc_encode = [
        {"lat": 51.5007, "lon": -0.1246, "line": encode_loc(51.5007, -0.1246)},
        {"lat": 51.523456, "lon": -0.087612, "line": encode_loc(51.523456, -0.087612)},
        {"lat": -33.8688, "lon": 151.2093, "line": encode_loc(-33.8688, 151.2093)},
    ]
    loc_decode_lines = [
        "loc: 51.50070,-0.12460",
        "loc:51.5,-0.1",
        "loc: 51.50070, -0.12460",
        "  loc: 51.50070,-0.12460  ",
        "loc: 91.00000,0.00000",
        "loc: 51.50070,-181.00000",
        "loc: 51.5007",
        "location: 51.50070,-0.12460",
        "loc: abc,def",
        "LOC: 51.50070,-0.12460",
    ]
    questions = [
        ("How do I make river water safe to drink?", None),
        ("How do I make river water safe to drink?", loc_a),
        ("  How do I stop heavy bleeding?  \n", loc_b),
        ("My neighbour is cold.\nHow do I keep her warm?", None),
    ]
    parse_wires = [
        "How do I make river water safe to drink?\nloc: 51.50070,-0.12460",
        "How do I make river water safe to drink?",
        "How do I stop heavy bleeding?\r\nloc: 51.52345,-0.08761\r\n",
        "loc: 51.50070,-0.12460",
        "   \n  ",
        "Is loc: 51.50070,-0.12460 safe?",
        "Where is water?\nloc: 99.00000,0.00000",
        "My neighbour is cold.\nHow do I keep her warm?\nloc: 51.50070,-0.12460",
        "x" * 600,
    ]
    model_outputs = [
        "1. Let the water settle, then pour the clear part through a cloth.\n2. Bring it to a rolling boil for at least 1 minute.",
        "  1. Press hard on the wound.\r\n2. Call for help.  \n\n",
        "1. Open a window.\n" + ANSWER_LABEL,
        "",
        "   \n",
        ANSWER_LABEL,
        LONG_STEPS,
        LONG_ONE_LINE,
    ]
    replies = [
        ACK_TEXT,
        "  " + ACK_TEXT + "\n",
        HUB_ERROR_TEXT,
        HUB_EMPTY_TEXT,
        "1. Let the water settle.\n2. Boil it for 1 minute.\n" + ANSWER_LABEL,
        "1. Press hard on the wound.\r\n" + ANSWER_LABEL + "\r\n",
        "hello from phone B",
        "Received.",
    ]
    shares = [(None, 51.5007, -0.1246), ("I'm at the north gate", 51.52345, -0.08761), ("   ", 51.5007, -0.1246)]
    share_decode = [
        "Shared location\nloc: 51.50070,-0.12460",
        "I'm at the north gate\nloc: 51.52345,-0.08761",
        "loc: 51.50070,-0.12460",
        "just text",
    ]
    return {
        "_comment": "Generated by protocol/make_vectors.py. Do not edit by hand. Spec: protocol/README.md.",
        "constants": {
            "HUB_NICKNAME": HUB_NICKNAME,
            "ACK_TEXT": ACK_TEXT,
            "ANSWER_LABEL": ANSWER_LABEL,
            "HUB_ERROR_TEXT": HUB_ERROR_TEXT,
            "HUB_EMPTY_TEXT": HUB_EMPTY_TEXT,
            "LOCATION_SHARE_DEFAULT_NOTE": LOCATION_SHARE_DEFAULT_NOTE,
            "MAX_QUESTION_UNITS": MAX_QUESTION_UNITS,
            "MAX_ANSWER_BODY_UNITS": MAX_ANSWER_BODY_UNITS,
            "ACK_TIMEOUT_MS": ACK_TIMEOUT_MS,
            "ANSWER_TIMEOUT_MS": ANSWER_TIMEOUT_MS,
            "HUB_MODEL_TIMEOUT_MS": HUB_MODEL_TIMEOUT_MS,
        },
        "locEncode": loc_encode,
        "locDecode": [{"line": l, "result": decode_loc(l)} for l in loc_decode_lines],
        "encodeQuestion": [{"text": t, "loc": l, "wire": encode_question(t, l)} for t, l in questions],
        "parseQuestion": [{"wire": w, "result": parse_question(w)} for w in parse_wires],
        "userContent": [
            {"body": "How do I make river water safe to drink?", "loc": None,
             "content": user_content("How do I make river water safe to drink?", None)},
            {"body": "How do I make river water safe to drink?", "loc": loc_a,
             "content": user_content("How do I make river water safe to drink?", loc_a)},
        ],
        "composeAnswer": [{"modelOutput": m, "wire": compose_answer(m)} for m in model_outputs],
        "classifyHubReply": [{"wire": r, "result": classify_hub_reply(r)} for r in replies],
        "encodeLocationShare": [
            {"note": n, "lat": la, "lon": lo, "wire": encode_location_share(n, la, lo)} for n, la, lo in shares
        ],
        "decodeLocationShare": [{"wire": w, "result": decode_location_share(w)} for w in share_decode],
        "askStates": ASK_STATES,
        "askEvents": ASK_EVENTS,
        "askTransitions": [
            {"from": s, "event": e, "to": ASK_TABLE.get((s, e), s)} for s in ASK_STATES for e in ASK_EVENTS
        ],
    }


if __name__ == "__main__":
    out = Path(__file__).with_name("vectors.json")
    out.write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out}")
