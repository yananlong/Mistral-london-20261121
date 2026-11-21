#!/usr/bin/env bash
# Download static guides (PDF / GOV.UK content JSON / Be Ready pages) and Give Food data.
# Usage: scripts/download_guides.sh
set -uo pipefail
cd "$(dirname "$0")/.."
UA="Mozilla/5.0 (compatible; offline-emergency-dataset/0.1)"
get(){ # url out
  mkdir -p "$(dirname "$2")"
  if curl -sfL -A "$UA" -m 120 -o "$2.tmp" "$1"; then mv "$2.tmp" "$2"; echo "ok   $2"; else rm -f "$2.tmp"; echo "FAIL $1" >&2; fi
}

# --- Tier 0 (phone): first aid, psychological first aid, preparedness -------------
P=phone/guides
get https://www.ifrc.org/sites/default/files/2022-02/EN_GFARC_GUIDELINES_2020.pdf          $P/pdf/ifrc_first_aid_guidelines_2020.pdf
get https://iris.who.int/server/api/core/bitstreams/e7e129fb-b306-496d-84a5-67bb70abc130/content $P/pdf/who_psychological_first_aid_2011.pdf
get https://beready.campaign.gov.uk/wp-content/uploads/sites/252/2026/10/Be-Ready-Checklist_English.pdf $P/pdf/beready_checklist_en.pdf

# GOV.UK Content API (OGL v3): structured JSON with the body HTML, easy to parse on device
for path in \
  government/publications/public-health-advice-from-uk-cmos-during-a-national-power-outage \
  government/publications/public-health-advice-from-uk-cmos-during-a-national-power-outage/water-and-sanitation-scripts-for-broadcast-media \
  government/publications/public-health-advice-from-uk-cmos-during-a-national-power-outage/food-and-nutrition-scripts-for-broadcast-media \
  government/publications/public-health-advice-from-uk-cmos-during-a-national-power-outage/keeping-warm-or-cool-in-extreme-weather-scripts-for-broadcast-media \
  government/publications/food-safety-in-a-power-cut-advice-for-consumers \
  government/publications/carbon-monoxide-poisoning \
  government/publications/national-risk-register-2025 ; do
  get "https://www.gov.uk/api/content/$path" "$P/govuk/$(basename "$path").json"
done

# Be Ready (formerly Prepare) campaign site: every hazard / preparedness page as HTML
mkdir -p $P/beready
for page in $(curl -sfL -A "$UA" https://beready.campaign.gov.uk/ https://beready.campaign.gov.uk/be-informed-about-hazards/ https://beready.campaign.gov.uk/be-ready-for-emergencies/ \
     | grep -oE 'href="https://beready\.campaign\.gov\.uk/(be-informed-about-hazards|be-ready-for-emergencies|play-your-part-in-your-community)/[^"#?]*"' \
     | sed -E 's/href="|"$//g' | sort -u); do
  name=$(echo "$page" | sed -E 's#https://beready\.campaign\.gov\.uk/##; s#/$##; s#/#__#g')
  get "$page" "$P/beready/$name.html"
done

# Give Food: UK food banks (credit + link back to givefood.org.uk; contact them before launch)
get "https://www.givefood.org.uk/api/2/foodbanks/"                 phone/givefood/foodbanks.json
get "https://www.givefood.org.uk/api/2/foodbanks/?format=geojson"  phone/givefood/foodbanks.geojson
get "https://www.givefood.org.uk/api/2/locations/"                 phone/givefood/locations.json

# --- Tier 1 (hub): Where There Is No Doctor 2025 (Hesperian; free/at-cost redistribution only)
H=hub/pdf/hesperian_where_there_is_no_doctor_2025
for c in fm 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23 bm; do
  get "https://hesperian.org/wp-content/uploads/pdf/en_wtnd_2025/en_wtnd_2025_$c.pdf" "$H/en_wtnd_2025_$c.pdf"
done
get https://www.ifrc.org/sites/default/files/2022-02/EN_GFARC_GUIDELINES_2020.pdf hub/pdf/ifrc_first_aid_guidelines_2020.pdf
