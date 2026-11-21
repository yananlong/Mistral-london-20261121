"""``python3 -m hub`` — start the dev hub server (CONTRACT.md §3, item B1).

Wires a :class:`~hub.inference.ChatInference` client, the
:class:`~hub.server.DevTransport` (HTTP + SSE on loopback) and the
:class:`~hub.core.HubCore` loop together, then serves until Ctrl-C. The terminal
log shows every question, ACK, answer, model run and error with a timestamp —
this is the terminal the demo shows on the Mac mini.
"""

from __future__ import annotations

import sys
import time

from .core import HubCore, timestamp
from .inference import ChatInference
from .server import DevTransport


def main(argv: list[str] | None = None) -> int:
    def log(line: str) -> None:
        print(line, flush=True)

    inference = ChatInference()
    transport = DevTransport.from_env(inference=inference, log=log)
    core = HubCore(transport, inference, log=log)
    core.start()
    log(f"{timestamp()} [hub] dev transport on {transport.url}  (env HUB_URL / HUB_PORT to change)")
    log(
        f"{timestamp()} [hub] inference server {inference.base_url} "
        f"model={inference.model} timeout={inference.timeout:g}s "
        f"-> currently {'UP' if inference.is_up() else 'DOWN (answers will use the labelled fallback)'}"
    )
    log(
        f"{timestamp()} [hub] endpoints: POST /v1/ask  POST /v1/loc  POST /v1/talk  "
        f"GET /v1/events?id=<ask-id>  GET /v1/peers  GET /v1/health"
    )
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        log(f"{timestamp()} [hub] Ctrl-C — shutting down")
    finally:
        core.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
