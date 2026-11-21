#!/bin/sh
# Use a process-local overlay only when Command Line Tools has both its old and
# new SwiftBridging module maps. No installed toolchain files are changed.
set -eu
compiler=$(xcrun --find swiftc 2>/dev/null || command -v swiftc)
toolchain=$(dirname "$(dirname "$compiler")")
old="$toolchain/include/swift/module.modulemap"
new="$toolchain/include/swift/bridging.modulemap"
if [ -f "$old" ] && [ -f "$new" ] && \
   [ "$(grep -c '^module ' "$old" || true)" -eq 1 ] && \
   grep -q '^module SwiftBridging ' "$old" && grep -q '^module SwiftBridging ' "$new"; then
    temp=$(mktemp -d "${TMPDIR:-/tmp}/hub-swiftc.XXXXXX")
    trap 'rm -rf "$temp"' EXIT HUP INT TERM
    : > "$temp/empty.modulemap"
    HUB_OLD_MODULEMAP=$old HUB_OVERLAY_DIR=$temp python3 - <<'PY'
import json
import os
from pathlib import Path
root = Path(os.environ['HUB_OVERLAY_DIR'])
(root / 'overlay.json').write_text(json.dumps({'version': 0, 'roots': [{
    'name': os.environ['HUB_OLD_MODULEMAP'], 'type': 'file', 'external-contents': str(root / 'empty.modulemap')
}]}))
PY
    swiftc -vfsoverlay "$temp/overlay.json" -Xcc -ivfsoverlay -Xcc "$temp/overlay.json" \
        -module-cache-path "$temp/cache" "$@"
else
    swiftc "$@"
fi
