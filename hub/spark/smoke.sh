#!/bin/sh
set -eu
if [ "$#" -gt 1 ]; then printf 'Usage: %s [results.tsv]\n' "$0" >&2; exit 2; fi
output=${1:-ollama-answer-times.tsv}
OLLAMA_SMOKE_OUTPUT=$output python3 - <<'PY'
import datetime
import json
import os
import time
import urllib.request

url = os.environ.get('OLLAMA_URL', 'http://127.0.0.1:11434').rstrip('/') + '/api/chat'
model = os.environ.get('OLLAMA_MODEL', 'ministral-3:14b-instruct-2512-q4_K_M')
payload = json.dumps({
    'model': model, 'stream': False, 'keep_alive': -1,
    'messages': [{'role': 'user', 'content': 'How can I make water safe to drink?'}],
    'options': {'num_predict': 400, 'temperature': 0.3},
}).encode()
request = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
start = time.monotonic()
with urllib.request.urlopen(request, timeout=120) as response:
    answer = json.load(response)['message']['content']
seconds = time.monotonic() - start
if not isinstance(answer, str) or not answer.strip():
    raise SystemExit('Ollama returned an empty answer')
row = f"{datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}\t{model}\t{seconds:.3f}\t{len(answer)}"
with open(os.environ['OLLAMA_SMOKE_OUTPUT'], 'a', encoding='utf-8') as handle:
    handle.write(row + '\n')
print(answer)
print(f'Wall time: {seconds:.3f} s')
print(f'Recorded: {row}')
PY
