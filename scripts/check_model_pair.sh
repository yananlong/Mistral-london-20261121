#!/usr/bin/env bash
# Verify the Ministral 3 3B GGUF pair on Linux (arm64/x86_64, e.g. DGX Spark) before touching a phone.
# Usage: scripts/check_model_pair.sh [MODEL_DIR=./models] [IMAGE.jpg]
# Env:   LLAMA_DIR (default ./llama.cpp-b12606), PORT (default 8089)
# NOT run by the author: it downloads ~2.6 GB and builds llama.cpp.
set -euo pipefail

MODEL_DIR="${1:-./models}"
IMAGE="${2:-}"
LLAMA_DIR="${LLAMA_DIR:-./llama.cpp-b12606}"
PORT="${PORT:-8089}"
TAG="b12606"

MAIN_REPO="https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF/resolve/main"
GGML_REPO="https://huggingface.co/ggml-org/Ministral-3-3B-Instruct-2512-GGUF/resolve/main"
MODEL="Ministral-3-3B-Instruct-2512-Q4_K_M.gguf"
MODEL_SHA="9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8"
MM_Q8="mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf"          # default projector
MM_Q8_SHA="57af826536cde496dde1e8343b8e72c89fdbd89084d58e18eb391ef34c39c9f2"
MM_BF16="Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf"         # quality-comparison alternative
MM_BF16_SHA="70ca26e41ecea9da997e2887462ad68b848fbf64da011ff4107bbe7353519ee0"

# Must match GenerationOptions.defaultSystemPrompt in MinistralEngine.swift.
SYS="You are a helpful, concise assistant running offline on a phone. Answer briefly and accurately."
USER_PROMPT="Describe this image in one sentence."

sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

fetch() { # url file sha
  local url="$1" file="$MODEL_DIR/$2" sha="$3"
  if [[ -f "$file" && "$(sha256_of "$file")" == "$sha" ]]; then echo "ok (cached): $2"; return; fi
  echo "downloading $2"
  curl -L --fail --retry 3 -C - -o "$file.part" "$url/$2"
  mv "$file.part" "$file"
  [[ "$(sha256_of "$file")" == "$sha" ]] || { echo "SHA-256 MISMATCH: $2" >&2; exit 1; }
  echo "ok (verified): $2"
}

mkdir -p "$MODEL_DIR"
fetch "$MAIN_REPO" "$MODEL" "$MODEL_SHA"
fetch "$GGML_REPO" "$MM_Q8" "$MM_Q8_SHA"
fetch "$MAIN_REPO" "$MM_BF16" "$MM_BF16_SHA"

# ---- build llama.cpp b12606 ----
if [[ ! -d "$LLAMA_DIR" ]]; then
  git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/llama.cpp "$LLAMA_DIR"
fi
CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF)
if command -v nvcc >/dev/null; then CMAKE_ARGS+=(-DGGML_CUDA=ON); echo "CUDA build"; else echo "CPU build"; fi
cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build" "${CMAKE_ARGS[@]}"
cmake --build "$LLAMA_DIR/build" -j "$(nproc)" --target llama-mtmd-cli llama-server
BIN="$LLAMA_DIR/build/bin"

# ---- 1. mtmd-cli with each projector; print wall time and the encode timings llama.cpp logs ----
for MM in "$MM_Q8" "$MM_BF16"; do
  echo "=== llama-mtmd-cli with $MM ==="
  ARGS=(-m "$MODEL_DIR/$MODEL" --mmproj "$MODEL_DIR/$MM" --temp 0.1 -n 128 -c 4096 -p "$USER_PROMPT")
  # Flag name unverified for b12606; fall back to the default system prompt if absent.
  if "$BIN/llama-mtmd-cli" --help 2>&1 | grep -q -- '--system-prompt'; then ARGS+=(--system-prompt "$SYS"); else echo "WARN: no --system-prompt flag; template default prompt will be injected" >&2; fi
  if [[ -n "$IMAGE" ]]; then ARGS+=(--image "$IMAGE"); else echo "(no image given: text-only run)"; fi
  START=$(date +%s.%N)
  "$BIN/llama-mtmd-cli" "${ARGS[@]}" 2>&1 | tee "$MODEL_DIR/.cli-$MM.log" | tail -n 25
  END=$(date +%s.%N)
  echo "--- $MM wall time: $(awk -v a="$START" -v b="$END" 'BEGIN{printf "%.2f", b-a}') s"
  # llama.cpp logs image encode time as e.g. "image slice encoded in N ms" (wording may vary).
  grep -iE "encoded in|image decoded|encode" "$MODEL_DIR/.cli-$MM.log" | head -n 5 || echo "(no encode timing line found; compare wall times)"
  echo "A multi-second image encode on a GPU box suggests the projector ran on CPU."
done

# ---- 2. llama-server /apply-template: Jinja-rendered prompt to diff against the Swift hand-rendering ----
"$BIN/llama-server" -m "$MODEL_DIR/$MODEL" --mmproj "$MODEL_DIR/$MM_Q8" -c 4096 --host 127.0.0.1 --port "$PORT" >"$MODEL_DIR/.server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "llama-server died; see $MODEL_DIR/.server.log" >&2; exit 1; }
  sleep 1
done
echo "=== /apply-template (text-only) ==="
curl -sf "http://127.0.0.1:$PORT/apply-template" -H 'Content-Type: application/json' \
  -d "{\"messages\":[{\"role\":\"system\",\"content\":\"$SYS\"},{\"role\":\"user\",\"content\":\"$USER_PROMPT\"}]}"
echo
echo "Swift renders: <s>[SYSTEM_PROMPT]$SYS[/SYSTEM_PROMPT][INST]<media marker>$USER_PROMPT[/INST]  (marker omitted if no image; <s> comes from add_special)"
