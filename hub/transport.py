"""Transport interface between the hub core and the message network.

The hub core (``hub/core.py``) only ever talks to this interface, so the dev
HTTP/SSE transport in ``hub/server.py`` can later be replaced by the BitChat
macOS build without touching the core (PLAN.md §4 "one small Transport
interface", CONTRACT.md B1). To plug BitChat in, subclass :class:`Transport`
and forward mesh traffic through :meth:`Transport.send` / :meth:`Transport.on_message`.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass


@dataclass
class Message:
    """One message arriving from the network.

    Attributes:
        text:   the full plain-text body, exactly as it travels the mesh
                (a question may end with a ``loc: <lat>,<lon>`` line).
        kind:   ``"question"`` | ``"loc"`` | ``"talk"`` — how the sender meant it.
        ask_id: transport-level id used to correlate ACK/answer events
                (the dev transport's ``POST /v1/ask`` id; ``None`` on the mesh).
        peer:   human-readable sender name for the terminal log.
    """

    text: str
    kind: str = "question"
    ask_id: str | None = None
    peer: str = "phone"


class Transport(abc.ABC):
    """How the hub sends and receives plain-text mesh messages."""

    @abc.abstractmethod
    def send(self, message: str, meta: dict | None = None) -> None:
        """Send one plain-text message to the mesh.

        ``meta`` is optional transport metadata, e.g.
        ``{"kind": "ack"|"answer"|"talk"|"loc"|"error", "ask_id": ..., "from": ...}``.
        Transports that cannot use it (e.g. raw BitChat text) may ignore it.
        """

    @abc.abstractmethod
    def on_message(self, callback) -> None:
        """Register ``callback(Message)``, called for every incoming message."""

    @abc.abstractmethod
    def peers(self) -> list[str]:
        """Currently reachable peers (including the hub itself)."""

    @abc.abstractmethod
    def start(self) -> None:
        """Start the transport (bind sockets, start threads, ...)."""

    @abc.abstractmethod
    def close(self) -> None:
        """Stop the transport and release its resources."""
