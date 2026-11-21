#!/usr/bin/env bash
# Fail if the phone app and the hub disagree on the wire protocol strings.
# Precedent: scripts/check_model_pair.sh. Stdlib grep only.
set -euo pipefail
cd "$(dirname "$0")/.."

SIM=phone/app/src/transport/SimulatedTransport.ts
RESP=hub/responder.py

ts_const() { # file, name -> value of `export const NAME = '...'` (value may be on the next line)
  grep -zoP "const $2\s*=\s*'\K[^']+" "$1" | tr -d '\0' | head -1
}
py_const() { # file, name -> value of `NAME = "..."`
  grep -oP "^$2 = \"\K[^\"]+" "$1" | head -1
}

ack_phone=$(ts_const "$SIM" HUB_ACK_TEXT)
ack_hub=$(py_const "$RESP" ACK)
label_phone=$(ts_const "$SIM" HUB_ANSWER_LABEL)
label_hub=$(py_const "$RESP" DISCLAIMER)

echo "ack:    phone='$ack_phone' hub='$ack_hub'"
echo "label:  phone='$label_phone' hub='$label_hub'"

[ "$ack_phone" = "$ack_hub" ] || { echo "FAIL: ack text mismatch"; exit 1; }
[ "$label_phone" = "$label_hub" ] || { echo "FAIL: answer label/disclaimer mismatch"; exit 1; }
echo "ok: phone and hub protocol strings match"
