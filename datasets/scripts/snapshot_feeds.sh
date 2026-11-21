#!/usr/bin/env bash
# Take a timestamped snapshot of every Tier 2 live feed in DATASETS.md.
# The hub serves the latest snapshot (with its age) when it loses internet,
# and the demo can replay a snapshot instead of a live connection.
# Usage: scripts/snapshot_feeds.sh            -> feeds/<UTC timestamp>/ and feeds/latest symlink
set -uo pipefail
cd "$(dirname "$0")/.."
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="feeds/$TS"; mkdir -p "$OUT"
UA="Mozilla/5.0 (compatible; offline-emergency-dataset/0.1)"

FEEDS=$(cat <<'EOF'
govuk_emergency_alerts.atom   https://www.gov.uk/alerts/feed.atom
ea_flood_warnings.json        https://environment.data.gov.uk/flood-monitoring/id/floods
metoffice_warnings_uk.atom    https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/UK
metoffice_warnings_se.atom    https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/se
ukhsa_heat_alerts.json        https://ukhsa-dashboard.data.gov.uk/api/proxy/alerts/v1/heat
ukhsa_cold_alerts.json        https://ukhsa-dashboard.data.gov.uk/api/proxy/alerts/v1/cold
ukpn_live_faults.json         https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/ukpn-live-faults/exports/json
nged_live_power_cuts.csv      https://connecteddata.nationalgrid.co.uk/dataset/d6672e1e-c684-4cea-bb78-c7e5248b62a2/resource/a1365982-4e05-463c-8304-8323a2ba0ccd/download/live_detailed_power_cuts.csv
tfl_line_status.json          https://api.tfl.gov.uk/Line/Mode/tube,dlr,overground,elizabeth-line,tram/Status
tfl_road_disruptions.json     https://api.tfl.gov.uk/Road/all/Disruption
gdacs_events.json             https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP
gdacs_rss.xml                 https://www.gdacs.org/xml/rss.xml
EOF
)

echo "$FEEDS" | while read -r name url; do
  code=$(curl -sL -A "$UA" -m 60 -o "$OUT/$name" -w '%{http_code}' "$url")
  size=$(stat -c %s "$OUT/$name" 2>/dev/null || echo 0)
  printf '{"file":"%s","url":"%s","http":%s,"bytes":%s,"fetched_utc":"%s"}\n' "$name" "$url" "$code" "$size" "$TS" >> "$OUT/_index.jsonl"
  [[ "$code" == 200 ]] && echo "ok   $name ($size B)" || { echo "FAIL $name http=$code" >&2; rm -f "$OUT/$name"; }
done
ln -sfn "$TS" feeds/latest
echo "snapshot -> $OUT"
