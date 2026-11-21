"""Identify a foraged mushroom, berry, fruit or nut from a photo with local Mistral vision models (Ollama),
then decide what to tell the user with a fixed safety policy.

The model never decides edibility. It only describes what it sees and picks candidate species_ids from
the closed list in datasets/phone/foraging/species.json. Edibility, lookalikes and the verdict come
from that file and from `verdict()` below:

  DO_NOT_EAT             any model puts a deadly/toxic species in its candidates (>= DANGER_CONF),
                         or the agreed species is deadly, toxic or not recommended
  EXPERT_CHECK_REQUIRED  agreed edible FUNGUS: shows the ID, lookalikes and checks, but never says "eat".
                         No photo can rule out a deadly Amanita or webcap.
  CHECK_THEN_EDIBLE      agreed edible PLANT with high confidence: shows features to confirm,
                         lookalikes and preparation
  UNSURE_DO_NOT_EAT      models disagree, low confidence, poor photo, or not in the list

Usage:
  python3 foraging/identify.py photo.jpg [more.jpg ...] [--models m1,m2] [--json]
  python3 foraging/identify.py --export-prompt datasets/phone/foraging/vision_prompt.json
Needs: Ollama on localhost:11434 (OLLAMA_HOST to override) with the models pulled. Standard library only.
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

KB_PATH = Path(__file__).resolve().parent.parent / "datasets/phone/foraging/species.json"
OLLAMA = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
if not OLLAMA.startswith("http"):
    OLLAMA = "http://" + OLLAMA
# Hub default: two different Mistral vision models must agree. The phone runs Ministral 3 3B alone.
DEFAULT_MODELS = ["ministral-3:14b-instruct-2512-fp16", "mistral-small3.2:24b-instruct-2506-fp16"]

DANGER_CONF = 0.15   # a deadly/toxic candidate at or above this, from any model, forces DO_NOT_EAT
MIN_CONF = 0.6       # agreed top-1 confidence needed for anything but UNSURE
MIN_CONF_DEADLY_LOOKALIKE = 0.8  # ... when the species has a deadly lookalike in the list
DANGEROUS = {"deadly", "toxic"}
EDIBLE = {"edible", "edible_with_preparation"}

KB = json.loads(KB_PATH.read_text())
SPECIES = {s["id"]: s for s in KB["species"]}


def system_prompt():
    lines = [f"{s['id']} | {s['scientific_name']} | {', '.join(s['common_names'])} | {s['kind']}" for s in KB["species"]]
    return (
        "You are a field botanist and mycologist looking at one photo taken in the UK. "
        "Identify the main mushroom, plant, berry, fruit or nut.\n"
        "1. In `observations` (at most 80 words), describe only what is visible: colours, shape, gills/pores/ridges/spines, ring, "
        "base or volva, stem, leaves, thorns, how the fruit is attached, habitat. Say what is NOT visible "
        "(for example the stem base of a mushroom).\n"
        "2. In `candidates`, give up to 3 species_ids from the catalogue below, most likely first, with a confidence "
        "between 0 and 1. Always include a dangerous lookalike as a candidate if the photo cannot rule it out. "
        "Use `unknown` if it is not in the catalogue or you cannot tell.\n"
        "3. Do not judge whether it is edible. That is decided elsewhere.\n\n"
        "Catalogue (species_id | scientific name | common names | kind):\n" + "\n".join(lines)
    )


def schema():
    ids = list(SPECIES) + ["unknown"]
    return {
        "type": "object",
        "properties": {
            "subject": {"type": "string", "enum": ["fungus", "plant", "other", "nothing_clear"]},
            "image_quality": {"type": "string", "enum": ["good", "partial", "poor"]},
            "observations": {"type": "string"},
            "candidates": {"type": "array", "minItems": 1, "maxItems": 3, "items": {
                "type": "object",
                "properties": {"species_id": {"type": "string", "enum": ids},
                               "confidence": {"type": "number", "minimum": 0, "maximum": 1}},
                "required": ["species_id", "confidence"]}},
        },
        "required": ["subject", "image_quality", "observations", "candidates"],
    }


def ask(model, image_bytes, timeout=300):
    """One model, one photo -> parsed prediction dict (+ seconds)."""
    body = {"model": model, "stream": False, "format": schema(), "keep_alive": "30m",
            "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 300},
            "messages": [{"role": "system", "content": system_prompt()},
                         {"role": "user", "content": "Identify this.",
                          "images": [base64.b64encode(image_bytes).decode()]}]}
    req = urllib.request.Request(f"{OLLAMA}/api/chat", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        msg = json.load(r)["message"]["content"]
    pred = json.loads(msg)
    pred["candidates"] = [c for c in pred.get("candidates", []) if c.get("species_id") in SPECIES or c.get("species_id") == "unknown"]
    pred.update(model=model, seconds=round(time.time() - t, 1))
    return pred


def _top(pred):
    c = sorted(pred["candidates"], key=lambda c: -c["confidence"])
    return c[0] if c else {"species_id": "unknown", "confidence": 0}


def verdict(preds):
    """Combine one or more model predictions into a verdict. Pure function of the predictions and species.json."""
    dangers = {}
    for p in preds:
        for c in p["candidates"]:
            sp = SPECIES.get(c["species_id"])
            if sp and sp["edibility"] in DANGEROUS and c["confidence"] >= DANGER_CONF:
                dangers[sp["id"]] = max(dangers.get(sp["id"], 0), c["confidence"])
    tops = [_top(p) for p in preds]
    ids = {t["species_id"] for t in tops}
    agreed = ids.pop() if len(ids) == 1 else None
    conf = min(t["confidence"] for t in tops)
    sp = SPECIES.get(agreed)
    out = {"species_id": agreed if sp else None, "confidence": round(conf, 2),
           "possible_dangers": sorted(dangers, key=lambda k: -dangers[k]),
           "models": {p["model"]: _top(p)["species_id"] for p in preds}}

    if dangers:
        out["verdict"] = "DO_NOT_EAT"
    elif sp is None or any(p["image_quality"] == "poor" for p in preds):
        out["verdict"] = "UNSURE_DO_NOT_EAT"
    elif sp["edibility"] in DANGEROUS or sp["edibility"] == "not_recommended":
        out["verdict"] = "DO_NOT_EAT"
    else:
        deadly_lookalike = any(SPECIES.get(l.get("id"), {}).get("edibility") == "deadly" for l in sp["lookalikes"])
        need = MIN_CONF_DEADLY_LOOKALIKE if deadly_lookalike else MIN_CONF
        if conf < need:
            out["verdict"] = "UNSURE_DO_NOT_EAT"
        elif sp["kind"] == "fungus":
            out["verdict"] = "EXPERT_CHECK_REQUIRED"
        else:
            out["verdict"] = "CHECK_THEN_EDIBLE"
    return out


HEADLINE = {
    "DO_NOT_EAT": "DO NOT EAT.",
    "UNSURE_DO_NOT_EAT": "Not sure what this is. Do not eat it.",
    "EXPERT_CHECK_REQUIRED": "Do not eat on this ID alone. Wild mushrooms need an expert to check them in person.",
    "CHECK_THEN_EDIBLE": "Probably edible, but only if every check below is true.",
}


def explain(v):
    """Deterministic user-facing text built only from species.json (no model-written safety advice)."""
    lines = [HEADLINE[v["verdict"]]]
    for d in v["possible_dangers"]:
        s = SPECIES[d]
        lines.append(f"Could be {s['common_names'][0]} ({s['scientific_name']}), which is {s['edibility'].upper()}. {s.get('notes', '')}".strip())
    sp = SPECIES.get(v["species_id"])
    if sp:
        deadly = [SPECIES[l["id"]] for l in sp["lookalikes"] if SPECIES.get(l.get("id"), {}).get("edibility") == "deadly"]
        if deadly and v["verdict"] != "DO_NOT_EAT":
            lines.append("Photos cannot rule out: " + ", ".join(f"{d['common_names'][0]} (DEADLY)" for d in deadly) + ".")
        lines.append(f"Best match: {sp['common_names'][0]} ({sp['scientific_name']}), {sp['edibility'].replace('_', ' ')}, "
                     f"agreement confidence {v['confidence']:.0%}.")
        if v["verdict"] in ("CHECK_THEN_EDIBLE", "EXPERT_CHECK_REQUIRED"):
            lines.append("Check all of these: " + "; ".join(sp["key_features"]) + ".")
            for l in sp["lookalikes"]:
                ls = SPECIES.get(l.get("id"))
                name = f"{ls['common_names'][0]} ({ls['edibility']})" if ls else l.get("name")
                lines.append(f"Lookalike: {name}. {l.get('how_to_tell', '')}".strip())
            if sp.get("preparation"):
                lines.append("Preparation: " + sp["preparation"])
    elif len(set(v["models"].values())) > 1:
        lines.append("The models disagree: " + ", ".join(f"{m.split(':')[0]} says {s}" for m, s in v["models"].items()) + ".")
    lines.append("AI-generated, not verified. If anyone has eaten something and feels unwell, call 999 or NHS 111 and keep a sample.")
    return "\n".join(lines)


def identify(image_bytes, models=DEFAULT_MODELS):
    preds = [ask(m, image_bytes) for m in models]
    v = verdict(preds)
    return {"verdict": v, "text": explain(v), "predictions": preds}


def export_prompt(path):
    Path(path).write_text(json.dumps({
        "version": KB["version"], "generated_by": "foraging/identify.py --export-prompt",
        "system_prompt": system_prompt(), "user_prompt": "Identify this.", "json_schema": schema(),
        "sampling": {"temperature": 0, "max_new_tokens": 300},
        "policy": {"danger_conf": DANGER_CONF, "min_conf": MIN_CONF,
                   "min_conf_deadly_lookalike": MIN_CONF_DEADLY_LOOKALIKE,
                   "rules": __doc__.split("Usage:")[0].strip()},
    }, indent=1, ensure_ascii=False))
    print(f"wrote {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="*")
    ap.add_argument("--models", default=",".join(DEFAULT_MODELS))
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--export-prompt")
    a = ap.parse_args()
    if a.export_prompt:
        return export_prompt(a.export_prompt)
    if not a.images:
        ap.error("give at least one image")
    for img in a.images:
        r = identify(Path(img).read_bytes(), a.models.split(","))
        if a.json:
            print(json.dumps({"image": img, **r}, ensure_ascii=False))
        else:
            print(f"== {img}")
            for p in r["predictions"]:
                print(f"  [{p['model']} {p['seconds']}s] {p['observations']}")
                print("    " + ", ".join(f"{c['species_id']} {c['confidence']:.2f}" for c in p["candidates"]))
            print(r["text"] + "\n")


if __name__ == "__main__":
    sys.exit(main())
