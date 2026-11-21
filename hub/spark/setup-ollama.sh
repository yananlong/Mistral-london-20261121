#!/bin/sh
set -eu
model='ministral-3:14b-instruct-2512-q4_K_M'
address=''
pull=0
dry=0
for arg in "$@"; do
    case "$arg" in
        --pull) pull=1 ;;
        --dry-run) dry=1 ;;
        --*) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
        *) if [ -n "$address" ]; then printf 'Expected one local-link address\n' >&2; exit 2; fi; address=$arg ;;
    esac
done
case "$address" in
    ''|0.0.0.0|::|'[::]'|*" "*|*[!a-zA-Z0-9.:_-]*)
        printf 'Provide a specific local-link address, not a wildcard\n' >&2; exit 2 ;;
esac
case "$address" in *:*) host="[$address]" ;; *) host=$address ;; esac
contents="[Service]
Environment=\"OLLAMA_HOST=$host:11434\"
Environment=\"OLLAMA_NUM_PARALLEL=4\"
Environment=\"OLLAMA_KEEP_ALIVE=-1\"
Environment=\"OLLAMA_CONTEXT_LENGTH=8192\""
if [ "$dry" -eq 1 ]; then
    printf '%s\n' 'Would write /etc/systemd/system/ollama.service.d/hub.conf:' "$contents"
    printf '%s\n' 'Would run: sudo systemctl daemon-reload' 'Would run: sudo systemctl restart ollama.service'
    if [ "$pull" -eq 1 ]; then printf 'Would run: OLLAMA_HOST=%s:11434 ollama pull %s\n' "$host" "$model"; fi
    printf 'Would verify: OLLAMA_HOST=%s:11434 ollama list contains %s\n' "$host" "$model"
    exit 0
fi
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '%s\n' "$contents" | sudo tee /etc/systemd/system/ollama.service.d/hub.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart ollama.service
OLLAMA_HOST="$host:11434"
export OLLAMA_HOST
if [ "$pull" -eq 1 ]; then ollama pull "$model"; fi
if ! ollama list | awk -v model="$model" 'NR > 1 && $1 == model {found=1} END {exit !found}'; then
    printf 'Model %s is absent. Run again with --pull while online.\n' "$model" >&2
    exit 1
fi
printf 'Model ready: %s\n' "$model"
