"""Schedule projection: simulate a full run with the configured latencies.

No API calls, no ffmpeg — answers "how long will this take and what does it
cost?" using generators[i].latency_s / cost_per_s and llm.latency_s. The
generate stage is fanned out with `concurrency` workers (greedy scheduler),
which is the critical path for any remote backend.
"""
from __future__ import annotations

from .timing import plan_durations


def project(config: dict, brief: dict) -> dict:
    dur = config.get("duration", {})
    target = float(brief.get("target_duration_s", dur.get("target_s", 38.0)))
    feats = brief.get("features") or ["Feature"]
    weights = [1.0] + [1.6] * min(3, len(feats)) + ([2.2] if len(feats) > 1 else []) + [1.0]
    shot_durs = plan_durations(target, weights)
    gens = config.get("generators", [])
    conc = int(config.get("concurrency", 4))
    llm_s = float(config.get("llm", {}).get("latency_s", 3))

    timeline = []
    t = 0.0
    timeline.append({"stage": "director", "start": t, "end": t + llm_s, "detail": "1 LLM call"})
    t += llm_s

    # greedy scheduler over (shot x generator) tasks
    tasks = []
    for i, d in enumerate(shot_durs):
        for g in gens:
            tasks.append({"shot": f"s{i+1:02d}", "variant": g["name"], "dur_s": d,
                          "latency_s": float(g.get("latency_s", 30)),
                          "cost": round(d * float(g.get("cost_per_s", 0)), 3)})
    tasks.sort(key=lambda x: -x["latency_s"])
    workers = [0.0] * conc
    for task in tasks:
        w = min(range(conc), key=lambda i: workers[i])
        start = max(t, workers[w])
        end = start + task["latency_s"]
        workers[w] = end
        timeline.append({"stage": "generate", "start": start, "end": end,
                         "detail": f'{task["shot"]} x {task["variant"]} ({task["dur_s"]}s clip)'})
    t = max(workers) if workers else t

    cur_s = llm_s * 2
    timeline.append({"stage": "curate", "start": t, "end": t + cur_s, "detail": "1 LLM call over all candidates"})
    t += cur_s

    asm = config.get("assemble", {})
    total_video = sum(shot_durs)
    asm_s = total_video * float(asm.get("render_seconds_per_video_second", 0.5)) + 10
    timeline.append({"stage": "assemble", "start": t, "end": t + asm_s, "detail": f"render {total_video}s video"})
    t += asm_s
    timeline.append({"stage": "qa", "start": t, "end": t + 2, "detail": "ffprobe checks"})
    t += 2
    timeline.append({"stage": "review", "start": t, "end": t, "detail": "human gate (not counted)"})

    cost = round(sum(x["cost"] for x in tasks), 3)
    gen_span = max((e["end"] for e in timeline if e["stage"] == "generate"), default=t)
    return {
        "target_duration_s": target,
        "planned_shots": len(shot_durs),
        "shot_durations_s": shot_durs,
        "total_video_s": round(total_video, 3),
        "wall_clock_s": round(t, 1),
        "critical_path": "generate (parallel fan-out, limited by concurrency)"
                         if gen_span >= t * 0.5 else "see timeline",
        "generation_span_s": round(gen_span - llm_s, 1),
        "estimated_cost_credits": cost,
        "timeline": timeline,
    }
