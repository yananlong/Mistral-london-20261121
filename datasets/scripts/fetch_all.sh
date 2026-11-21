#!/usr/bin/env bash
# One command to (re)build every dataset in DATASETS.md. Resumable.
# Needs: bash, curl, wget, jq, python3 (venv). ~22 GB disk for everything, ~0.5 GB for phone/.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs

[[ -x .tools/venv/bin/python ]] || python3 -m venv .tools/venv
.tools/venv/bin/pip -q install osmium pmtiles requests
PY=".tools/venv/bin/python -I -u"

# Protomaps keeps daily builds for ~a week: pin today's (or override PROTOMAPS_BUILD=YYYYMMDD)
BUILD="${PROTOMAPS_BUILD:-$(date -u +%Y%m%d)}"
LONDON_BBOX="-0.5104 51.2868 0.3340 51.6919"   # Greater London

mkdir -p hub/osm phone/map
wget -q -c -O hub/osm/greater-london-latest.osm.pbf \
  https://download.geofabrik.de/europe/united-kingdom/england/greater-london/greater-london-latest.osm.pbf
$PY scripts/extract_pois.py hub/osm/greater-london-latest.osm.pbf phone/pois
# Official pmtiles CLI (digest checked against GitHub); pure-Python extractor as fallback
PMV=1.31.2; ARCH=$(uname -m | sed 's/aarch64/arm64/'); OS=$(uname -s)
if [[ ! -x .tools/pmtiles ]]; then
  asset="go-pmtiles_${PMV}_${OS}_${ARCH}.tar.gz"
  curl -sfL -o .tools/pm.tgz "https://github.com/protomaps/go-pmtiles/releases/download/v$PMV/$asset" || true
  want=$(curl -sfL "https://api.github.com/repos/protomaps/go-pmtiles/releases/tags/v$PMV" | jq -r --arg a "$asset" '.assets[]|select(.name==$a)|.digest' | sed 's/^sha256://')
  if [[ -s .tools/pm.tgz && -n "$want" && "$(sha256sum .tools/pm.tgz | cut -d' ' -f1)" == "$want" ]]; then
    tar xzf .tools/pm.tgz -C .tools pmtiles
  else echo "pmtiles CLI unavailable or digest mismatch; using Python extractor" >&2; fi
  rm -f .tools/pm.tgz
fi
if [[ ! -s phone/map/london.pmtiles ]]; then
  if [[ -x .tools/pmtiles ]]; then
    .tools/pmtiles extract "https://build.protomaps.com/$BUILD.pmtiles" phone/map/london.pmtiles \
      --bbox="$(echo $LONDON_BBOX | tr ' ' ',')" --maxzoom=15 && .tools/pmtiles verify phone/map/london.pmtiles
  else
    $PY scripts/extract_pmtiles.py "https://build.protomaps.com/$BUILD.pmtiles" phone/map/london.pmtiles $LONDON_BBOX 15
  fi
fi
scripts/download_guides.sh
# Foraging: London fruit/poisonous trees from OSM, then CC0/CC-BY species photos (GBIF) + Wikipedia text
$PY scripts/extract_fruit_trees.py hub/osm/greater-london-latest.osm.pbf phone/foraging
$PY scripts/fetch_foraging.py 30
scripts/download_zims.sh "${1:-all}"
scripts/snapshot_feeds.sh
$PY scripts/build_manifest.py phone hub
