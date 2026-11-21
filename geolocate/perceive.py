"""Photo -> scene observation JSON (the input of fusion.estimate), with the same models the phones run.

  text     YOLO26n-text finds words, PP-OCRv5 mobile (English) reads them; words are grouped into lines.
  objects  YOLOE-26s with a fixed street-furniture and hazard vocabulary (VOCAB). Zero-shot: weak evidence only.
  vlm      optional: Ministral 3 3B (the phone's vision model) lists the readable signs as JSON, via Ollama
           on the Spark. Lines from it have no box and conf 0.6.

All of it runs offline once the weights are in yolo/models/ (export_mobile.py downloads and exports them).
Usage:
  yolo/.venv/bin/python geolocate/perceive.py photo.jpg [--vlm] [--hfov 65] [--heading 120] [--hub]
"""
import argparse
import base64
import contextlib
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "yolo" / "models"
PHONE_MODELS = {"text": "yolo26n-text.pt", "rec": "en_PP-OCRv5_mobile_rec", "objects": "yoloe-26s-seg.pt"}
HUB_MODELS = {"text": "yolo26s-text.pt", "rec": "PP-OCRv6_medium_rec", "objects": "yoloe-26l-seg.pt"}

# (prompt for YOLOE, label used downstream, minimum confidence). Prompts and thresholds were picked on
# 13 Commons photos of London streets (geolocate/README.md has the numbers); they are a starting point,
# not a calibrated detector. Labels starting with hazard_ never move the position estimate.
VOCAB = [
    ("street sign", "street_sign", 0.20),
    ("bus stop", "bus_stop_sign", 0.50),
    ("subway sign", "station_sign", 0.75),
    ("storefront", "shop_sign", 0.30),
    ("red post box", "post_box", 0.50),
    ("telephone booth", "telephone_box", 0.35),
    ("traffic light", "traffic_light", 0.30),
    ("flood", "hazard_flood", 0.50),
    ("fire", "hazard_fire", 0.50),
    ("smoke", "hazard_smoke", 0.50),
    ("fallen tree", "hazard_fallen_tree", 0.50),
    ("damaged building", "hazard_damaged_building", 0.60),
    ("debris", "hazard_debris", 0.50),
]
SIGN_CONTEXT = {"street_sign": "street", "bus_stop_sign": "bus_stop", "station_sign": "station", "shop_sign": "poi"}

VLM_MODEL = os.environ.get("GEO_VLM", "ministral-3:3b-instruct-2512-fp16")
OLLAMA = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
if not OLLAMA.startswith("http"):
    OLLAMA = "http://" + OLLAMA
VLM_PROMPT_PATH = ROOT / "datasets" / "phone" / "geo" / "scene_prompt.json"
VLM_KIND = {"street_sign": "street", "bus_stop": "bus_stop", "station": "station", "shop": "poi", "landmark": "landmark"}

_cache = {}


def _ocr(models):
    if "ocr" not in _cache:
        from ultralytics.solutions.ocr import OCR
        _cache["ocr"] = OCR(model=str(MODELS / models["text"]), recognizer=str(MODELS / models["rec"]),
                            imgsz=1280, show=False, verbose=False)
    return _cache["ocr"]


def _detector(models):
    if "det" not in _cache:
        from ultralytics import YOLOE
        m = YOLOE(str(MODELS / models["objects"]))
        m.set_classes([p for p, _, _ in VOCAB])
        _cache["det"] = m
    return _cache["det"]


def read_text(im, models):
    """Words -> lines, each line with its text, mean confidence and axis-aligned box."""
    words = _ocr(models).process(im).texts
    lines = {}
    for w in words:
        lines.setdefault(w["line"], []).append(w)
    out = []
    for ws in lines.values():
        xs = [p[0] for w in ws for p in w["polygon"]]
        ys = [p[1] for w in ws for p in w["polygon"]]
        out.append({"text": " ".join(w["text"] for w in ws),
                    "conf": round(sum(w["confidence"] for w in ws) / len(ws), 3),
                    "box": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))]})
    return out


def detect(path, models):
    r = _detector(models).predict(str(path), conf=0.15, verbose=False)[0]
    out = []
    for b in r.boxes:
        prompt, label, thr = VOCAB[int(b.cls)]
        if float(b.conf) >= thr:
            out.append({"label": label, "conf": round(float(b.conf), 3), "box": [round(v) for v in b.xyxy[0].tolist()]})
    return out


def vlm_lines(path):
    """Ask the phone's vision model (Ministral 3 3B) to list readable signs. Same prompt file the phone uses."""
    spec = json.loads(VLM_PROMPT_PATH.read_text())
    body = {"model": VLM_MODEL, "stream": False, "format": spec["json_schema"], "keep_alive": "30m",
            "options": {"temperature": 0, "num_predict": spec["sampling"]["max_new_tokens"]},
            "messages": [{"role": "system", "content": spec["system_prompt"]},
                         {"role": "user", "content": spec["user_prompt"],
                          "images": [base64.b64encode(Path(path).read_bytes()).decode()]}]}
    req = urllib.request.Request(f"{OLLAMA}/api/chat", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        reply = json.loads(json.load(r)["message"]["content"])
    return [{"text": t["text"], "conf": 0.6, "kind": VLM_KIND.get(t.get("kind"))}
            for t in reply.get("signs", []) if t.get("text", "").strip()]


def _inside(box, outer):
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return outer[0] <= cx <= outer[2] and outer[1] <= cy <= outer[3]


def perceive(path, use_vlm=False, hfov=None, heading=None, hub=False):
    import cv2
    models = HUB_MODELS if hub else PHONE_MODELS
    im = cv2.imread(str(path))
    if im is None:
        raise SystemExit(f"cannot read {path}")
    lines = read_text(im, models)
    objects = detect(path, models)
    for line in lines:  # a line inside a detected sign takes that sign's kind
        for o in objects:
            if o["label"] in SIGN_CONTEXT and _inside(line["box"], o["box"]):
                line["kind"] = SIGN_CONTEXT[o["label"]]
                break
    if use_vlm:
        lines += vlm_lines(path)
    scene = {"image": {"w": im.shape[1], "h": im.shape[0]}, "lines": lines, "objects": objects}
    if hfov:
        scene["image"]["hfov_deg"] = hfov
    if heading is not None:
        scene["heading_deg"] = heading
    return scene


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photos", nargs="+")
    ap.add_argument("--vlm", action="store_true", help="also ask Ministral 3 3B via Ollama")
    ap.add_argument("--hfov", type=float, help="camera horizontal field of view in degrees (iPhone main ~65)")
    ap.add_argument("--heading", type=float, help="compass heading when the photo was taken")
    ap.add_argument("--hub", action="store_true", help="use the larger hub-side models")
    a = ap.parse_args()
    for p in a.photos:
        with contextlib.redirect_stdout(sys.stderr):  # Ultralytics logs to stdout; keep stdout pure JSONL
            scene = perceive(p, a.vlm, a.hfov, a.heading, a.hub)
        print(json.dumps(scene), flush=True)


if __name__ == "__main__":
    sys.exit(main())
