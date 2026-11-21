#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
source_dir="$root/bitchat/bitchat/Services/Hub"
temp=$(mktemp -d "${TMPDIR:-/tmp}/hub-tests.XXXXXX")
pids=''
cleanup() {
    for pid in $pids; do kill "$pid" 2>/dev/null || true; done
    rm -rf "$temp"
}
trap cleanup EXIT HUP INT TERM
"$root/hub/swiftc.sh" -swift-version 5 -parse-as-library \
    "$source_dir/HubProtocol.swift" "$source_dir/OllamaClient.swift" \
    "$source_dir/HubResponder.swift" "$source_dir/HubConfig.swift" \
    "$here/HubTests.swift" -o "$temp/hub-tests"
for mode in ok slow error500 empty badjson; do
    python3 "$here/fake_ollama.py" --mode "$mode" --port 0 --port-file "$temp/port-$mode" --record "$temp/requests-$mode" >"$temp/server-$mode.log" 2>&1 &
    pids="$pids $!"
done
for mode in ok slow error500 empty badjson; do
    attempts=0
    while [ ! -s "$temp/port-$mode" ]; do
        attempts=$((attempts + 1))
        if [ "$attempts" -gt 100 ]; then cat "$temp/server-$mode.log" >&2; exit 1; fi
        sleep 0.05
    done
done
"$temp/hub-tests" "$root/protocol/vectors.json" "$temp"
