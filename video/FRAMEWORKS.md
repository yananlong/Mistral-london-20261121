# Orchestration framework comparison (for the video pipeline)

Question: which multi-agent framework is most efficient here — coding power,
output quality, and speed to a working pipeline for a 35-40 s Remotion video?

## What this pipeline actually needs

1. **Fan-out/fan-in**: 2+ generator agents produce candidates for every shot in parallel.
2. **Cycles with caps**: curator → regenerate weak shots (max N attempts); QA → re-assemble.
3. **A human-in-the-loop gate** that pauses the run and resumes on a verdict file.
4. **Typed contracts between agents** (storyboard JSON, scores, EDL) so failures are loud, not vibes.
5. **Long-running, resumable steps** (a render takes minutes) with per-stage timing logs.
6. **Zero-dependency testability in CI** (the repo's hub is stdlib-only; CI has no GPU/keys).

## Options compared (2026 landscape)

| Framework | Orchestration model | Strengths for this job | Weaknesses for this job | Verdict |
|---|---|---|---|---|
| **Custom graph, zero-dep (shipped)** | explicit nodes/edges, `asyncio` fan-out inside the generate node | full control of loops/gates/retries; runs in CI with no install; contracts are pydantic; ~300 LOC; stage timings built in | you own checkpoint/resume and observability | **default** — right size for a 6-node pipeline |
| **LangGraph** | stateful graph; `Send` for dynamic fan-out, conditional edges for loops, `interrupt()` for HITL, checkpointer for resume | exactly matches needs 1-5; largest production footprint; great observability (LangSmith); durable resume after a crashed render | extra dependency + concepts (state reducers, supersteps); overkill if you never need distributed resume | **recommended upgrade path** when the pipeline grows or runs unattended |
| **CrewAI** | role-based crews, sequential/parallel processes | fastest to prototype a role crew (director/generators/curator as YAML-ish roles) | weak on cyclic retry loops, HITL interrupts and observability; harder to enforce typed contracts; teams usually migrate to LangGraph at production | good for a 1-day v0 demo only |
| **AutoGen / AG2** | conversational group chat | strong multi-agent debate/verification patterns (could power the curator) | conversation-driven control flow is hard to cap/timing-test; heavier to make deterministic | use for the curator's internal debate if wanted, not the backbone |
| **Microsoft Agent Framework** | actors + workflows | good if the team is .NET; solid HITL | Python video/ffmpeg tooling ecosystem is weaker; new (1.0 in 2026) | no |
| **OpenAI Agents SDK / Google ADK / PydanticAI / smolagents / Mastra** | handoffs / agent trees / graphs / code-agents / TS | each fine for narrow flows | ADK/SDK are provider-tied; Mastra is TS (our render tooling is Python+ffmpeg); smolagents is code-agent oriented | no |
| **Orca workers (in-session)** | orchestrator agent supervises child agents | lets a human watch the crew work live in this CLI | not a repo artifact; no persistence | can drive the same `agents/*.run(state, ctx)` functions live |

## Recommendation

Ship the **zero-dependency native executor** (what's in `pipeline/graph.py`) as
the default: it is the fastest to a *tested* pipeline (21 tests green in CI with
just ffmpeg), and the graph is declarative, so porting to **LangGraph** later is
mechanical: `generate` → `Send` fan-out per (shot × variant), curate/qa edges →
conditional edges, the review gate → `interrupt()` + checkpointer. If we want a
managed runtime *now* instead, use LangGraph directly — it is the best
coding-power/quality trade-off of the 2026 options for loops + HITL + fan-out.
CrewAI only if the priority is a same-day role-play demo with no tests.

The agent functions (`pipeline/agents/*.run(state, ctx)`) are executor-agnostic:
the same crew can be driven by the native executor, a LangGraph adapter, or Orca
workers in a live session.
