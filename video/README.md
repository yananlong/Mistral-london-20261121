# video/ — multi-agent Remotion video pipeline

A small orchestrator runs a crew of agents to produce a **35-40 s Remotion
(React) video** that showcases the app, with a human review gate at the end:

```
brief ──▶ DIRECTOR ──▶ GENERATOR agents (parallel fan-out, 2+ variants per shot)
                     │        each variant = own LLM/model + style, writes a scene .tsx
                     ▼
                   CURATOR ◀──────────────┐ scores all candidates, picks winners, │
                     │                     │ flags retries ──────────────────────┘
                     ▼
                   EDITOR ──▶ renders ONE Remotion composition -> final.mp4 (+captions, audio)
                     ▼
                   QA (ffprobe: duration in [35,40]s, 1080p, fps, audio) ──fix loop──┐
                     ▼                                                            │
                   HUMAN REVIEW GATE (runs/<id>/review/REVIEW.md + verdict.json)     │
```

Nothing here designs the video yet: the stub LLM produces neutral placeholder
storyboards/scenes, so the whole loop can be tested offline before the design
lands.

## Quickstart (offline test, no API keys, no Chrome)

```sh
python3 -m video.pipeline smoke      # full run with stub LLM + stub ffmpeg clips
python3 -m video.pipeline project    # simulate schedule + cost with configured latencies
python3 -m unittest discover -s video/tests -t . -v   # 21 tests, needs only ffmpeg + pydantic
```

The smoke run renders a real `video/runs/smoke/final.mp4` (38.0 s, 1080p) and
writes `video/runs/smoke/review/REVIEW.md`. Exit code 2 means "awaiting human
review".

## Real run (Remotion)

```sh
cd video/studio && npm install && npx remotion browser ensure   # once
cd ../..
cp video/config.remotion.example.json video/config.local.json    # gitignored; edit models/keys
# MISTRAL_API_KEY in .env for the hosted LLM and Voxtral voiceover (SETUP_VOXTRAL.md)
python3 -m video.pipeline run --brief video/examples/brief.example.md
# review: open video/runs/<id>/review/REVIEW.md, watch final.mp4, then
#   echo '{"status": "approved"}' > video/runs/<id>/review/verdict.json
python3 -m video.pipeline validate --run video/runs/<id>
```

## How it works

| Piece | Where | Notes |
|---|---|---|
| Orchestrator graph | `pipeline/graph.py` | declarative nodes/edges + zero-dep native executor; see FRAMEWORKS.md for the LangGraph/Orca mapping |
| Agent roles | `pipeline/agents/` | `director` (storyboard), `generator` (fan-out), `curator` (score/pick/retry), `editor` (EDL+render), `qa`, `review` gate |
| Contracts | `pipeline/schemas.py` | pydantic models; every run persists `state.json`, so runs are reproducible/auditable |
| Prompts | `pipeline/prompts/*.md` | edit these as the design lands |
| LLM providers | `pipeline/llm.py` | `stub` (offline), `ollama` (DGX Spark), `mistral` (hosted); per-generator override via `generators[i].llm` |
| Video backends | `pipeline/backends/` | `stub` (ffmpeg placeholder clips, CI), `remotion` (scene writing + preview stills + final render). `clip`-kind backends (Runway/Kling/Veo APIs) slot in via the same interface |
| Remotion studio | `studio/` | installed once, symlinked into each `runs/<id>/studio`; scenes are generated per run |
| Timing | `pipeline/timing.py`, `pipeline/project.py` | shot durations planned to sum exactly into [35,40]s; QA verifies the rendered file; `project` simulates wall clock/cost |
| Audio | `pipeline/audio.py` | music bed via ffmpeg; voiceover via Voxtral (`voxtral/tts.py`) or stub |
| Human review | `pipeline/review.py` | `runs/<id>/review/REVIEW.md` + `verdict.json` gate |

### Run layout

```
video/runs/<id>/
├── state.json / manifest.json   # full orchestrator state after every node
├── timing.jsonl                 # per-stage wall-clock timings
├── clips/                       # one candidate per (shot x variant)
├── segments/, video_only.mp4    # concat path (clip backends)
├── studio/                      # remotion path: generated scenes + gen/main.tsx
├── final.mp4, captions.srt
└── review/REVIEW.md, verdict.json
```

## Config

`config.default.json` (stub, offline-safe) <- `config.local.json` (gitignored,
yours) <- `--config FILE` <- CLI flags. Copy `config.remotion.example.json` to
`config.local.json` for real Remotion runs. Key knobs: `duration.{min,max,target}_s`,
`generators[]` (one entry per generator agent), `concurrency`,
`curator.{max_attempts,min_total_score}`, `backends.remotion.{preview_mode,crf}`.

## Testing

`video/tests/` runs in CI (`.github/workflows/test.yml`, job `video-pipeline`):
timing math, schema contracts, a full stub end-to-end run asserting the rendered
file is 35-40 s, the curator retry loop fires, and all artifacts exist, plus a
Remotion scaffold test (scene + `gen/main.tsx` generation, no rendering).
