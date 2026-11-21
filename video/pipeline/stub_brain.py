"""Deterministic stand-in for the LLM providers, used by --llm stub / smoke tests.

It produces VALID contract JSON (Storyboard / reviews / scene code) with
neutral placeholder content only — no design decisions — so the whole
orchestration, timing and review loop can be tested offline and in CI.
"""
from __future__ import annotations

import hashlib
import json

from .schemas import CandidateScore, ShotReview, ShotSpec, Storyboard
from .timing import plan_durations


def _h(*parts: str) -> int:
    return int(hashlib.sha256("|".join(parts).encode()).hexdigest(), 16)


def answer(agent: str, payload: dict, user: str) -> str:
    if agent == "director":
        return json.dumps(_director(payload), ensure_ascii=False)
    if agent == "curator":
        return json.dumps(_curator(payload), ensure_ascii=False)
    if agent == "scene_writer":
        return json.dumps({"code": _scene(payload)}, ensure_ascii=False)
    raise ValueError(f"stub brain has no answer for agent {agent!r}")


def _director(payload: dict) -> dict:
    brief = payload["brief"]
    feats = brief.get("features") or ["Feature"]
    beats = ["hook"] + [f"feature:{f}" for f in feats[:3]]
    if len(feats) > 1:
        beats.append("demo")
    beats.append("outro")
    weights = [1.0] + [1.6] * min(3, len(feats)) + ([2.2] if len(feats) > 1 else []) + [1.0]
    target = float(brief.get("target_duration_s") or 38.0)
    durs = plan_durations(target, weights)
    shots = [
        ShotSpec(
            id=f"s{i + 1:02d}",
            beat=b,
            duration_s=d,
            prompt=f"[stub placeholder] visual for beat '{b}' — replaced by the real director LLM once design lands",
            caption=b,
            voiceover_line="",
        )
        for i, (b, d) in enumerate(zip(beats, durs))
    ]
    sb = Storyboard(
        title=brief.get("title", "Untitled"),
        style_guide="[stub placeholder style guide]",
        shots=shots,
        voiceover_script="",
        duration_min_s=float(brief.get("duration_min_s", 35.0)),
        duration_max_s=float(brief.get("duration_max_s", 40.0)),
    )
    return sb.model_dump(mode="json")


def _curator(payload: dict) -> dict:
    attempt = int(payload.get("attempt", 1))
    reviews: dict[str, dict] = {}
    for idx, shot in enumerate(payload.get("shots", [])):
        sid = shot["id"]
        scores: dict[str, CandidateScore] = {}
        for cand in payload.get("candidates", {}).get(sid, []):
            h = _h(sid, cand["variant"], str(attempt))
            scores[cand["variant"]] = CandidateScore(
                on_brief=5 + h % 6,
                motion=5 + (h >> 8) % 6,
                artifacts=5 + (h >> 16) % 6,
                consistency=5 + (h >> 24) % 6,
                legibility=5 + (h >> 32) % 6,
                notes="stub score",
            )
        if not scores:
            continue
        winner = max(scores, key=lambda v: scores[v].total)
        # Force exactly one retry on the third shot at attempt 1, so the
        # generate -> curate loop is exercised in every smoke run.
        retry = attempt == 1 and idx == 2
        reviews[sid] = ShotReview(
            shot_id=sid,
            scores=scores,
            winner=winner,
            rationale="stub curator pick",
            retry=retry,
            retry_reason="stub: forced retry to exercise the loop" if retry else "",
        ).model_dump(mode="json")
    return {"reviews": reviews}


def _scene(payload: dict) -> str:
    shot = payload["shot"]
    variant = payload.get("variant", {})
    sid = shot["id"]
    beat = shot.get("beat", "")
    v = variant.get("name", "gen")
    return f'''import {{AbsoluteFill, useCurrentFrame, useVideoConfig}} from 'remotion';

// STUB scene for {sid} / {v} — placeholder visuals only, replaced by the
// real scene-writer LLM once the design lands.
export const Scene = () => {{
  const frame = useCurrentFrame();
  const {{durationInFrames}} = useVideoConfig();
  return (
    <AbsoluteFill style={{{{backgroundColor: '#101418', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif'}}}}>
      <div style={{{{color: '#e8eaed', fontSize: 64}}}}>[stub] {sid} / {v}</div>
      <div style={{{{color: '#9aa0a6', fontSize: 28, position: 'absolute', bottom: 40}}}}>
        {beat} — frame {{frame}} / {{durationInFrames}}
      </div>
    </AbsoluteFill>
  );
}};
'''
