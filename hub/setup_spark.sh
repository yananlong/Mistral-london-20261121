#!/usr/bin/env bash
# Runbook: set up Ollama on the DGX Spark as the offline hub.
#
# The Spark answers mesh questions with its local model only. It never talks
# to the internet, so Ollama binds to the local-link address, never 0.0.0.0.
#
# Usage:
#   SPARK_LOCAL_LINK_IP=10.0.0.2 ./setup_spark.sh                 # full setup (needs the network once, to pull the model)
#   SPARK_LOCAL_LINK_IP=10.0.0.2 ./setup_spark.sh offline-check   # run AFTER disconnecting the network
#
# Without SPARK_LOCAL_LINK_IP (and without OLLAMA_HOST) the offline check
# talks to Ollama on 127.0.0.1:11434. MODEL_TAG picks the model (default fp16).
#
# Without root (Ollama started by hand, not by systemd), start it like this:
#   OLLAMA_HOST=<local-link-ip>:11434 OLLAMA_NUM_PARALLEL=4 OLLAMA_KEEP_ALIVE=-1 \
#     OLLAMA_CONTEXT_LENGTH=8192 OLLAMA_NO_CLOUD=1 ollama serve
#
# SPARK_LOCAL_LINK_IP is the Spark's address on the local link to the Mac (the
# BitChat peer). Find it with:  ip -4 addr show <link-interface>
set -euo pipefail

# Demo decision: the fp16 build (28 GB) is the one pulled on the Spark. Override
# with MODEL_TAG=... or HUB_MODEL=... (for example the blueprint's
# ministral-3:14b-instruct-2512-q4_K_M) and pull that tag before going offline.
MODEL_TAG="${MODEL_TAG:-${HUB_MODEL:-ministral-3:14b-instruct-2512-fp16}}"
case "$MODEL_TAG" in
  *:cloud|*-cloud) echo "refusing MODEL_TAG=$MODEL_TAG: cloud tags run off the box; the hub is offline" >&2; exit 2 ;;
esac
# responder.py answers with the same tag that this script pulls and checks.
export HUB_MODEL="$MODEL_TAG"
# Byte-exact from BLUEPRINT_1.md: the hub ends every answer with this label.
DISCLAIMER="AI answer from an open-weight model on the hub. Not verified emergency advice."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cmd="${1:-setup}"
case "$cmd" in
  setup|offline-check) ;;
  *) echo "usage: $0 [setup|offline-check]   (set SPARK_LOCAL_LINK_IP for setup)" >&2; exit 2 ;;
esac

if [[ "$cmd" == "setup" ]]; then
  SPARK_LOCAL_LINK_IP="${SPARK_LOCAL_LINK_IP:?set SPARK_LOCAL_LINK_IP to the local-link IP of the Spark, e.g. SPARK_LOCAL_LINK_IP=10.0.0.2 $0}"
  if [[ "$SPARK_LOCAL_LINK_IP" == "0.0.0.0" ]]; then
    echo "refusing OLLAMA_HOST=0.0.0.0; use the local-link address, never 0.0.0.0" >&2
    exit 2
  fi

  # Ollama server settings for the hub (BLUEPRINT_1.md, "Ollama on the hub").
  # OLLAMA_HOST is the bind address of `ollama serve`: the local link only.
  export OLLAMA_HOST="${SPARK_LOCAL_LINK_IP}:11434"
  export OLLAMA_NUM_PARALLEL=4      # answer several questions in parallel, queue the rest
  export OLLAMA_KEEP_ALIVE=-1       # keep the model loaded in unified memory
  export OLLAMA_CONTEXT_LENGTH=8192 # context length per request
  echo "OLLAMA_HOST=$OLLAMA_HOST OLLAMA_NUM_PARALLEL=$OLLAMA_NUM_PARALLEL OLLAMA_KEEP_ALIVE=$OLLAMA_KEEP_ALIVE OLLAMA_CONTEXT_LENGTH=$OLLAMA_CONTEXT_LENGTH"
  echo

  # Persist the env for the ollama service so it survives a reboot of the Spark.
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files ollama.service >/dev/null 2>&1; then
    if [[ "$(id -u)" -eq 0 ]]; then
      mkdir -p /etc/systemd/system/ollama.service.d
      cat > /etc/systemd/system/ollama.service.d/10-hub.conf <<EOF
[Service]
Environment=OLLAMA_HOST=${OLLAMA_HOST}
Environment=OLLAMA_NUM_PARALLEL=${OLLAMA_NUM_PARALLEL}
Environment=OLLAMA_KEEP_ALIVE=${OLLAMA_KEEP_ALIVE}
Environment=OLLAMA_CONTEXT_LENGTH=${OLLAMA_CONTEXT_LENGTH}
Environment=OLLAMA_NO_CLOUD=1
EOF
      systemctl daemon-reload
      systemctl restart ollama
      echo "ollama restarted with the hub settings"
    else
      echo "note: not root, so the systemd drop-in was NOT written. Run 'sudo systemctl edit ollama.service' and add under [Service]:" >&2
      printf '  Environment="%s"\n' "OLLAMA_HOST=$OLLAMA_HOST" "OLLAMA_NUM_PARALLEL=4" "OLLAMA_KEEP_ALIVE=-1" "OLLAMA_CONTEXT_LENGTH=8192" "OLLAMA_NO_CLOUD=1" >&2
      echo "then: sudo systemctl daemon-reload && sudo systemctl restart ollama" >&2
    fi
  else
    echo "note: no systemd ollama unit found; start the server by hand with:" >&2
    echo "  OLLAMA_HOST=$OLLAMA_HOST OLLAMA_NUM_PARALLEL=4 OLLAMA_KEEP_ALIVE=-1 OLLAMA_CONTEXT_LENGTH=8192 OLLAMA_NO_CLOUD=1 ollama serve" >&2
  fi
  echo

  echo "== pulling $MODEL_TAG (needs the network once; do this before going offline) =="
  ollama pull "$MODEL_TAG"
  echo
  ollama list
  echo
  echo "setup done. Now disconnect the network and run: $0 offline-check"
else
  # offline-check: run this AFTER disconnecting the Spark's network.
  echo "== offline check (the network must be disconnected now) =="
  if ip route show default 2>/dev/null | grep -q .; then
    echo "FAIL: a default route still exists; disconnect the network first" >&2
    exit 1
  fi
  echo "no default route: the Spark is offline"
  echo

  # Export the env BEFORE any ollama CLI call, so `ollama list` hits the same
  # server the hub will use (the systemd drop-in binds Ollama to the
  # local-link address, not 127.0.0.1). responder.py prepends http:// when
  # OLLAMA_HOST has no scheme.
  export OLLAMA_HOST="${OLLAMA_HOST:-${SPARK_LOCAL_LINK_IP:-127.0.0.1}:11434}"
  export HUB_BIND=127.0.0.1
  export HUB_PORT="${HUB_PORT:-8080}"
  echo "effective env for this check: OLLAMA_HOST=$OLLAMA_HOST HUB_BIND=$HUB_BIND HUB_PORT=$HUB_PORT"
  case "$OLLAMA_HOST" in
    0.0.0.0|0.0.0.0:*|*://0.0.0.0|*://0.0.0.0:*)
      echo "FAIL: OLLAMA_HOST must never be 0.0.0.0 (internet-facing)" >&2
      exit 1
      ;;
  esac
  echo

  echo "-- ollama list (the model must still be there, served from local storage) --"
  if ! MODEL_LISTING="$(ollama list)"; then
    echo "FAIL: 'ollama list' failed; is the ollama service running on $OLLAMA_HOST?" >&2
    exit 1
  fi
  echo "$MODEL_LISTING"
  if ! grep -qF "$MODEL_TAG" <<<"$MODEL_LISTING"; then
    echo "FAIL: $MODEL_TAG is not in ollama list (set MODEL_TAG to a pulled tag)" >&2
    exit 1
  fi
  if grep -qiE '(:|-)cloud([[:space:]]|$)' <<<"$MODEL_LISTING"; then
    echo "FAIL: ollama list shows a cloud tag; remove it (ollama rm <tag>), the hub runs local models only" >&2
    exit 1
  fi
  echo
  echo "-- ollama ps (once the model is loaded: expect 100% GPU, context 8192, UNTIL Forever) --"
  ollama ps || true
  echo

  echo "-- local test question through hub/responder.py --"
  ASK_RESPONSE="$(mktemp)"
  RESPONDER_PID=""
  cleanup() {
    [[ -n "$RESPONDER_PID" ]] && kill "$RESPONDER_PID" 2>/dev/null || true
    rm -f "$ASK_RESPONSE"
  }
  trap cleanup EXIT
  HUB_WARMUP=0 python3 "$SCRIPT_DIR/responder.py" &
  RESPONDER_PID=$!
  for _ in $(seq 1 50); do
    if curl -sf "http://127.0.0.1:${HUB_PORT}/health" >/dev/null; then break; fi
    sleep 0.1
  done
  if ! curl -sf "http://127.0.0.1:${HUB_PORT}/health" >/dev/null; then
    echo "FAIL: responder.py did not come up on 127.0.0.1:${HUB_PORT}" >&2
    exit 1
  fi
  echo "GET /health:"
  curl -sf "http://127.0.0.1:${HUB_PORT}/health"; echo
  echo "POST /ask (wait=true, full answer in one response):"
  if ! HTTP_CODE="$(curl -s -o "$ASK_RESPONSE" -w '%{http_code}' -X POST \
      "http://127.0.0.1:${HUB_PORT}/ask" \
      -H 'Content-Type: application/json' \
      -d '{"sender":"offline-check","question":"How do I make river water safe to drink?","wait":true}')"; then
    echo "FAIL: could not reach the responder at http://127.0.0.1:${HUB_PORT}/ask" >&2
    exit 1
  fi
  echo "HTTP $HTTP_CODE:"
  cat "$ASK_RESPONSE"; echo
  # The check passes only when the hub really answered: HTTP 200, a real
  # answer (not the retry error answer) that carries the disclaimer.
  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "FAIL: POST /ask returned HTTP $HTTP_CODE, expected 200" >&2
    exit 1
  fi
  if grep -qE "could not answer|No answer:" "$ASK_RESPONSE"; then
    echo "FAIL: the hub returned the retry error answer, not a real answer" >&2
    exit 1
  fi
  if ! grep -qF "$DISCLAIMER" "$ASK_RESPONSE"; then
    echo "FAIL: the answer does not contain the disclaimer" >&2
    exit 1
  fi
  cleanup
  trap - EXIT
  echo
  echo "offline check passed: the hub answered with no network"
fi
