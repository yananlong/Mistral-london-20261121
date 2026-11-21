"""Offline object detection with YOLO26x (Ultralytics). No network needed once models/yolo26x.pt exists.
Usage: .venv/bin/python detect.py <image|video|0 for webcam> [--show]
Prints one line per frame as JSON: [{"label","conf","box":[x1,y1,x2,y2]}]; annotated output goes to out/."""
import json, sys
from pathlib import Path
from ultralytics import YOLO

src = sys.argv[1] if len(sys.argv) > 1 else "https://ultralytics.com/images/bus.jpg"
src = int(src) if src.isdigit() else src
model = YOLO(Path(__file__).parent / "models" / "yolo26x.pt")
for r in model(src, stream=True, device=0, save=True, show="--show" in sys.argv,
               project=str(Path(__file__).parent / "out"), name="run", exist_ok=True, verbose=False):
    print(json.dumps([{"label": r.names[int(b.cls)], "conf": round(float(b.conf), 3),
                       "box": [round(v) for v in b.xyxy[0].tolist()]} for b in r.boxes]))
