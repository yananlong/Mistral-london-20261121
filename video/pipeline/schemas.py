"""Pydantic contracts between the video-pipeline agents.

Every agent reads and writes these models, so any run is reproducible from
`runs/<id>/state.json` and reviewable by a human from `runs/<id>/review/`.
"""
from __future__ import annotations

import time
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class Brief(BaseModel):
    """Human input: what the video is about. Filled in once the design lands."""

    title: str = "Untitled video"
    target_duration_s: float = 38.0
    duration_min_s: float = 35.0
    duration_max_s: float = 40.0
    audience: str = ""
    features: list[str] = Field(default_factory=list)
    tone: str = ""
    voiceover: bool = True
    notes: str = ""


class ShotSpec(BaseModel):
    """One shot in the director's storyboard."""

    id: str
    beat: str
    duration_s: float = Field(gt=0, le=30)
    prompt: str = ""
    camera: str = ""
    caption: str = ""
    voiceover_line: str = ""
    style_tags: list[str] = Field(default_factory=list)


class Storyboard(BaseModel):
    """Director output. Total duration MUST land inside [duration_min_s, duration_max_s]."""

    title: str
    style_guide: str = ""
    shots: list[ShotSpec]
    voiceover_script: str = ""
    duration_min_s: float = 35.0
    duration_max_s: float = 40.0

    @property
    def total_duration_s(self) -> float:
        return round(sum(s.duration_s for s in self.shots), 3)

    @model_validator(mode="after")
    def _durations_in_range(self) -> "Storyboard":
        if not 1 <= len(self.shots) <= 24:
            raise ValueError(f"storyboard must have 1..24 shots, got {len(self.shots)}")
        total = self.total_duration_s
        if not (self.duration_min_s - 1e-6 <= total <= self.duration_max_s + 1e-6):
            raise ValueError(
                f"storyboard total {total}s is outside "
                f"[{self.duration_min_s}, {self.duration_max_s}]s"
            )
        return self


class CandidateScore(BaseModel):
    """Curator's per-candidate score. Each criterion is 0..10 (artifacts: 10 = clean)."""

    on_brief: int = Field(ge=0, le=10)
    motion: int = Field(ge=0, le=10)
    artifacts: int = Field(ge=0, le=10)
    consistency: int = Field(ge=0, le=10)
    legibility: int = Field(ge=0, le=10)
    notes: str = ""

    @property
    def total(self) -> int:
        return (
            self.on_brief + self.motion + self.artifacts + self.consistency + self.legibility
        )


class ClipCandidate(BaseModel):
    """One generated clip, produced by one generator agent (variant) for one shot."""

    shot_id: str
    variant: str
    backend: str
    model: str
    prompt_used: str
    file: str  # clip: video path; scene (remotion): scene module path relative to studio/
    poster: str = ""
    preview: str = ""  # rendered still/frame used by the curator
    duration_s: float
    width: int
    height: int
    bytes: int = 0
    seed: Optional[int] = None
    generation_seconds: float = 0.0  # wall-clock time of the backend call, as reported
    cost_credits: float = 0.0
    metrics: dict[str, float] = Field(default_factory=dict)
    created_at: float = Field(default_factory=time.time)


class ShotReview(BaseModel):
    """Curator's verdict for one shot across all candidate variants."""

    shot_id: str
    scores: dict[str, CandidateScore]  # variant name -> score
    winner: str
    rationale: str = ""
    retry: bool = False
    retry_reason: str = ""

    @model_validator(mode="after")
    def _winner_scored(self) -> "ShotReview":
        if self.winner not in self.scores:
            raise ValueError(f"winner {self.winner!r} has no score for shot {self.shot_id}")
        return self


class EDLEntry(BaseModel):
    shot_id: str
    file: str
    duration_s: float
    caption: str = ""


class EDL(BaseModel):
    """Editor's edit decision list: the final timeline."""

    entries: list[EDLEntry]
    total_duration_s: float
    transition_s: float = 0.0


class Check(BaseModel):
    name: str
    ok: bool
    detail: str = ""


class QAReport(BaseModel):
    """QA node output: is the rendered file inside spec?"""

    passed: bool
    duration_s: float
    duration_min_s: float
    duration_max_s: float
    width: int
    height: int
    fps: float
    has_audio: bool
    file: str
    checks: list[Check] = Field(default_factory=list)


class StageTiming(BaseModel):
    stage: str
    node: str
    started_at: float
    duration_s: float
    detail: dict = Field(default_factory=dict)


class RunState(BaseModel):
    """Full orchestrator state, persisted to runs/<id>/state.json after every node."""

    run_id: str
    status: str = "running"  # running | awaiting_review | approved | changes_requested | failed
    brief: Brief
    config: dict = Field(default_factory=dict)
    storyboard: Optional[Storyboard] = None
    candidates: list[ClipCandidate] = Field(default_factory=list)
    reviews: dict[str, ShotReview] = Field(default_factory=dict)
    retry_shots: list[str] = Field(default_factory=list)
    edl: Optional[EDL] = None
    final: str = ""
    qa: Optional[QAReport] = None
    attempts: dict[str, int] = Field(default_factory=dict)
    last_error: str = ""
    timings: list[StageTiming] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)
