#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
source_dir="$root/bitchat/bitchat/Services/Hub"
mkdir -p "$here/.build"
"$root/hub/swiftc.sh" -swift-version 5 -parse-as-library \
    "$source_dir/HubProtocol.swift" "$source_dir/OllamaClient.swift" \
    "$source_dir/HubResponder.swift" "$source_dir/HubConfig.swift" \
    "$here/hub-ask.swift" -o "$here/.build/hub-ask"
printf '%s\n' "$here/.build/hub-ask"
