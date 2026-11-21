#!/usr/bin/env bash
# Copy the offline models, the phone dataset bundle and the golden test set into the app's Documents/ over USB.
# Usage: scripts/push_ios.sh <UDID> <APP_BUNDLE_ID> [12GB|8GB] [MODEL_DIR=./models] [what=models,data,golden]
#   UDID: `xcrun devicectl list devices`. APP_BUNDLE_ID: see phone/ios/INSTALL.md.
#   Layout on the phone: Documents/<model>.gguf, Documents/datasets/<path from datasets/phone/>, Documents/golden/.
# Unverified: devicectl's --user mobile flag and whether it creates missing parent folders (INSTALL.md section 3).
set -euo pipefail

UDID="${1:?UDID}"; BUNDLE="${2:?APP_BUNDLE_ID}"
CLASS="${3:-12GB}"; MODEL_DIR="${4:-./models}"; WHAT="${5:-models,data,golden}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/phone/ios/models.json"
DATA="$ROOT/datasets/phone"
DEVICECTL_USER="${DEVICECTL_USER:-mobile}"   # set to "" to omit, or "root" (see INSTALL.md)

push() { # local-file destination-relative-to-container
  local args=(--device "$UDID" --domain-type appDataContainer --domain-identifier "$BUNDLE" --source "$1" --destination "$2")
  [[ -n "$DEVICECTL_USER" ]] && args+=(--user "$DEVICECTL_USER")
  xcrun devicectl device copy to "${args[@]}" >/dev/null
  echo "  $2"
}

if [[ ",$WHAT," == *",models,"* ]]; then
  echo "== models ($CLASS)"
  TIERS=$(jq -c --arg c "$CLASS" '.devices[$c].push' "$MANIFEST")
  jq -r --argjson t "$TIERS" '.files[] | select(any(.tiers[]; . as $x | $t | index($x))) | .file' "$MANIFEST" |
  while read -r f; do
    [[ -f "$MODEL_DIR/$f" ]] || { echo "missing $MODEL_DIR/$f: run scripts/fetch_ios_models.sh $CLASS $MODEL_DIR" >&2; exit 1; }
    push "$MODEL_DIR/$f" "Documents/$f"
  done
fi

if [[ ",$WHAT," == *",data,"* ]]; then
  echo "== datasets/phone ($(jq -r '.total_bytes / 1e6 | floor' "$DATA/manifest.json") MB)"
  push "$DATA/manifest.json" "Documents/datasets/manifest.json"
  jq -r '.files[].path' "$DATA/manifest.json" | while read -r p; do
    [[ -f "$DATA/$p" ]] || { echo "missing datasets/phone/$p: run datasets/scripts/fetch_all.sh" >&2; exit 1; }
    push "$DATA/$p" "Documents/datasets/$p"
  done
fi

if [[ ",$WHAT," == *",golden,"* ]]; then
  echo "== golden test set"
  for f in "$ROOT"/phone/test/golden/*; do
    [[ "$(basename "$f")" == README.md ]] && continue
    push "$f" "Documents/golden/$(basename "$f")"
  done
fi
echo "Done. On first launch the app checks Documents/datasets/ against manifest.json (OfflineBundle.verifyDatasets)."
