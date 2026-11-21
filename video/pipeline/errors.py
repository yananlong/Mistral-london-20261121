"""Shared error type for the video pipeline."""
from __future__ import annotations


class PipelineError(Exception):
    """Raised inside a pipeline node.

    retryable=True means the executor may run the same node again
    (up to the configured attempt cap) with `last_error` as feedback.
    """

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable
