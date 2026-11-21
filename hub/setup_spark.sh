#!/usr/bin/env bash
# Runbook: set up Ollama on the DGX Spark as the offline hub.
#
# The Spark answers mesh questions with its local model only. It never talks
# to the internet, so Ollama binds to the local-link address, never 0.0.0.0.
#
# Usage:
#   SPARK_LOCAL_LINK_IP=10.0.0.2 ./setup_spark.sh   # full setup (needs the network once, to pull the model)
#   ./setup_spark.sh offline-check                  # run AFTER disconnecting the network
#
# SPARK_LOCAL_LINK_IP is the Spark's address on the local link to the Mac (the
# BitChat peer). Find it with:  ip -4 addr show <link-interface>
set -euo pipefail

MODEL_TAG="ministral-3:14b-instruct-2512-q4_K_M"
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
EOF
      systemctl daemon-reload
      systemctl restart ollama
      echo "ollama restarted with the hub settings"
    else
      echo "note: run as root to write the systemd drop-in, or apply these exports to the ollama service yourself" >&2
    fi
  else
    echo "note: no systemd ollama unit found; start 'ollama serve' with these exports in its environment" >&2
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
    echo "WARNING: a default route still exists; disconnect the network first" >&2
  else
    echo "no default route: the Spark is offline"
  fi
  echo
  echo "-- ollama list (the model must still be there, served from local storage) --"
  ollama list
  ollama list | grep -q "ministral-3" || { echo "model missing from ollama list" >&2; exit 1; }
  echo

  echo "-- local test question through hub/responder.py --"
  export HUB_BIND=127.0.0.1
  export HUB_PORT="${HUB_PORT:-8080}"
  # responder.py prepends http:// when OLLAMA_HOST has no scheme.
  export OLLAMA_HOST="${OLLAMA_HOST:-${SPARK_LOCAL_LINK_IP:-127.0.0.1}:11434}"
  python3 "$SCRIPT_DIR/responder.py" &
  RESPONDER_PID=$!
  trap 'kill "$RESPONDER_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 50); do
    curl -sf "http://127.0.0.1:${HUB_PORT}/health" >/dev/null && break
    sleep 0.1
  done
  echo "GET /health:"
  curl -s "http://127.0.0.1:${HUB_PORT}/health"; echo
  echo "POST /ask (wait=true, full answer in one response):"
  curl -s -X POST "http://127.0.0.1:${HUB_PORT}/ask" \
    -H 'Content-Type: application/json' \
    -d '{"sender":"offline-check","question":"How do I make river water safe to drink?","wait":true}'
  echo
  kill "$RESPONDER_PID" 2>/dev/null || true
  trap - EXIT
  echo
  echo "offline check passed: the hub answered with no network"
fi
