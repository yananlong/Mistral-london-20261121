#!/usr/bin/env bash
# Offline realtime STT server: Voxtral Mini 4B Realtime 2602 on vLLM, port 8001.
# One-time (online) setup:
#   uvx --from huggingface_hub hf download mistralai/Voxtral-Mini-4B-Realtime-2602 --local-dir ~/models/voxtral-stt
#   docker build -t voxtral-stt:vllm0.33 -f voxtral/Dockerfile.stt voxtral
# Test: uv run voxtral/stt.py some_audio.wav
set -euo pipefail
docker rm -f voxtral-stt >/dev/null 2>&1 || true
docker run -d --name voxtral-stt --restart unless-stopped \
  --gpus all --network host --ipc host \
  -v ~/models/voxtral-stt:/model:ro \
  -e HF_HUB_OFFLINE=1 -e VLLM_DISABLE_COMPILE_CACHE=1 \
  voxtral-stt:vllm0.33 \
  /model --served-model-name voxtral-stt --port 8001 \
    --gpu-memory-utilization 0.15 --max-num-seqs 4 --max-model-len 32768 \
    --compilation_config '{"cudagraph_mode": "PIECEWISE"}'
echo "Starting; ready in ~1-2 min when this answers: curl localhost:8001/v1/models"
