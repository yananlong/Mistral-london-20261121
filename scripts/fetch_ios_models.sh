#!/usr/bin/env bash
# Download and verify the iOS offline model files listed in phone/ios/models.json (run on the Mac, with internet).
# Usage: scripts/fetch_ios_models.sh [12GB|8GB|all] [MODEL_DIR=./models]
#   12GB: Q4_K_M + Q8_0 projector (~2.6 GB)          8GB / all: also Q3_K_M (~4.4 GB)
set -euo pipefail

CLASS="${1:-all}"
MODEL_DIR="${2:-./models}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/phone/ios/models.json"
command -v jq >/dev/null || { echo "needs jq (brew install jq)" >&2; exit 1; }

sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# Files needed by the tiers pushed to this device class.
case "$CLASS" in
  12GB|8GB) TIERS=$(jq -c --arg c "$CLASS" '.devices[$c].push' "$MANIFEST") ;;
  all) TIERS='["full","lean","tight","textOnly"]' ;;
  *) echo "class must be 12GB, 8GB or all" >&2; exit 1 ;;
esac

mkdir -p "$MODEL_DIR"
jq -r --argjson t "$TIERS" '.files[] | select(any(.tiers[]; . as $x | $t | index($x))) | [.file, .url, .bytes, .sha256] | @tsv' "$MANIFEST" |
while IFS=$'\t' read -r file url bytes sha; do
  out="$MODEL_DIR/$file"
  if [[ -f "$out" && "$(wc -c <"$out" | tr -d ' ')" == "$bytes" && "$(sha256_of "$out")" == "$sha" ]]; then
    echo "ok (cached): $file"; continue
  fi
  echo "downloading $file ($((bytes / 1000000)) MB)"
  curl -L --fail --retry 3 -C - -o "$out.part" "$url"
  mv "$out.part" "$out"
  [[ "$(sha256_of "$out")" == "$sha" ]] || { echo "SHA-256 MISMATCH: $file" >&2; exit 1; }
  echo "ok (verified): $file"
done
echo "Models for $CLASS are in $MODEL_DIR. Next: scripts/push_ios.sh <UDID> <APP_BUNDLE_ID> $CLASS $MODEL_DIR"
