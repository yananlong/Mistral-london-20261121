#!/usr/bin/env bash
# Download Kiwix ZIM libraries listed in DATASETS.md and verify their SHA-256.
# Usage: scripts/download_zims.sh [phone|hub|all]   (default: all)
# Resumable: re-run to continue interrupted downloads.
set -euo pipefail
cd "$(dirname "$0")/.."

MIRROR="${KIWIX_MIRROR:-https://mirrors.dotsrc.org/kiwix}"   # ~3 MB/s from London; download.kiwix.org redirects to slow mirrors
CANON="https://download.kiwix.org"                           # checksums come from the canonical host

# tier  kiwix-dir  file
ZIMS=$(cat <<'EOF'
phone wikipedia      wikipedia_en_medicine_mini_2026-10.zim
phone wikipedia      wikipedia_en_top_mini_2026-09.zim
phone zimit          nhs.uk_en_medicines_2026-09b.zim
phone other          zimgit-medicine_en_2024-08.zim
phone other          zimgit-water_en_2024-08.zim
phone other          zimgit-food-preparation_en_2024-08.zim
phone wikivoyage     wikivoyage_en_europe_nopic_2026-09.zim
hub   wikipedia      wikipedia_en_medicine_nopic_2026-10.zim
hub   wikipedia      wikipedia_en_top_nopic_2026-09.zim
hub   zimit          irp.fas.org_en_military-medicine_2026-10.zim
hub   zimit          wwwnc.cdc.gov_en_all_2024-11.zim
hub   other          appropedia_en_all_maxi_2026-02.zim
hub   other          trueprepper.com_en_all_2026-05.zim
hub   zimit          ready.gov_en_all_2026-10.zim
hub   ifixit         ifixit_en_all_2025-12.zim
hub   stack_exchange diy.stackexchange.com_en_all_2026-10.zim
hub   stack_exchange electronics.stackexchange.com_en_all_2026-10.zim
hub   stack_exchange outdoors.stackexchange.com_en_all_2026-10.zim
hub   stack_exchange ham.stackexchange.com_en_all_2026-10.zim
hub   stack_exchange sustainability.stackexchange.com_en_all_2026-10.zim
hub   stack_exchange cooking.stackexchange.com_en_all_2026-10.zim
EOF
)

WANT="${1:-all}"
echo "$ZIMS" | while read -r tier dir file; do
  [[ "$WANT" == all || "$WANT" == "$tier" ]] || continue
  out="$tier/zim"; mkdir -p "$out"
  if [[ -f "$out/$file.ok" ]]; then echo "skip $file (verified)"; continue; fi
  echo ">> $file"
  [[ -s "$out/$file" ]] || rm -f "$out/$file"
  if ! wget -q -c --tries=3 -O "$out/$file" "$MIRROR/zim/$dir/$file"; then
    echo "   mirror missing it, falling back to $CANON"
    [[ -s "$out/$file" ]] || rm -f "$out/$file"
    wget -q -c --tries=5 -O "$out/$file" "$CANON/zim/$dir/$file" || { echo "   FAILED $file" >&2; continue; }
  fi
  want=$(curl -sfL "$CANON/zim/$dir/$file.sha256" | awk '{print $1}')
  got=$(sha256sum "$out/$file" | awk '{print $1}')
  if [[ -n "$want" && "$want" == "$got" ]]; then touch "$out/$file.ok"; echo "   ok $got"
  else echo "   CHECKSUM MISMATCH ($file) want=$want got=$got" >&2; fi
done
