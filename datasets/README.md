# datasets/

The data from [DATASETS.md](../DATASETS.md), downloaded on 21 November 2026 and laid out by where it lives. Large files are git-ignored. Run `scripts/fetch_all.sh` to rebuild everything. It can resume after an interruption.

| Folder | Tier in DATASETS.md | Who uses it | Size |
|---|---|---|---|
| [phone/](phone/) | **0. On the phone** | Android **and** iOS apps, as the same files | ~0.6 GB |
| [hub/](hub/) | **1. On the hub** | DGX Spark retrieval (RAG) and "nearest X" lookups | ~19 GB |
| [feeds/](feeds/) | **2. Live, via the hub** | Hub bulletins; demo replay when there's no live connection | ~1 MB per snapshot |

Every file in `phone/` and `hub/` is listed in `<tier>/manifest.json`, with its size, SHA-256, licence and attribution. Apps should read the manifest to check that the bundle is present and intact.

## phone/: one bundle for Android and iOS

Every format here works on both platforms, so neither app needs its own conversion step.

| Path | What | Format | Open it with |
|---|---|---|---|
| `map/london.pmtiles` | Greater London vector basemap, z0–15 (Protomaps build 20261121) | PMTiles v3, MVT tiles | MapLibre Native, using a `pmtiles://file://…` source (recent Android and iOS SDKs support it; check the version you pin) |
| `pois/london_pois.sqlite` | About 22k emergency POIs. Table `pois(id, category, type, name, lat, lon, opening_hours, tags)` | SQLite | Android `SQLiteDatabase`, iOS GRDB / SQLite.swift / sqlite3 |
| `pois/<category>.geojson` | The same POIs as GeoJSON, one file per category, for map layers | GeoJSON | MapLibre `GeoJSONSource` on both |
| `zim/*.zim` | WikiMed mini, NHS medicines, Kiwix water/medicine/food-prep libraries, Wikivoyage Europe | ZIM | [libkiwix Android](https://github.com/kiwix/java-libkiwix) / [libkiwix iOS (CoreKiwix.xcframework)](https://github.com/kiwix/kiwix-apple) |
| `guides/pdf/` | IFRC first-aid guidelines 2020, WHO Psychological First Aid, Be Ready checklist | PDF | Android `PdfRenderer`, iOS PDFKit |
| `guides/govuk/*.json` | UK CMOs' power-outage scripts (water, food, warmth), food safety in a power cut, carbon monoxide, National Risk Register | GOV.UK Content API JSON (`details.body` is HTML) | Any JSON parser |
| `guides/beready/*.html` | Every Be Ready (formerly Prepare) hazard and preparedness page | HTML | WebView / WKWebView |
| `givefood/` | UK food banks and donation points | JSON + GeoJSON | Any JSON parser |

POI categories: `aed` (652), `medical` (4,225), `water` (695), `toilets` (1,134), `shelter` (5,872), `food` (6,891), `power` (1,331), `fuel` (529), `emergency_services` (321).

**Getting the bundle into the apps**

- **Android:** files bigger than about 100 MB can't go in `assets/` of a Play-store APK. For the hackathon, either put the small files in `app/src/main/assets/offline/` and push the rest with `adb push phone/ /sdcard/Android/data/<pkg>/files/offline/`, or use Play Asset Delivery (install-time pack) later. MapLibre and libkiwix need a real file path, so copy any assets to `filesDir` on first run.
- **iOS:** drag `phone/` into Xcode as a **folder reference** (blue folder) so the paths survive, and read it from `Bundle.main.url(forResource: "phone", withExtension: nil)`. For anything that has to change after install, copy it to `Application Support` and mark it `isExcludedFromBackup`. Use On-Demand Resources if the app gets too large.
- If the phones only need first aid plus the map, ship `map/`, `pois/`, `guides/` and `zim/wikipedia_en_medicine_mini_*.zim` (about 0.4 GB). The other ZIMs are optional.

## hub/: the DGX Spark library

| Path | What | Licence |
|---|---|---|
| `osm/greater-london-latest.osm.pbf` | Raw OSM for London (Geofabrik). Use it for POI search and offline routing (GraphHopper, Valhalla, OSRM) | ODbL |
| `zim/wikipedia_en_medicine_nopic_*.zim` | Full WikiMed, text only, for RAG | CC BY-SA |
| `zim/wikipedia_en_top_nopic_*.zim` | Top Wikipedia articles, general knowledge | CC BY-SA |
| `zim/ifixit_en_all_*.zim` | All iFixit repair guides | **CC BY-NC-SA, non-commercial** |
| `zim/ready.gov_en_all_*.zim`, `wwwnc.cdc.gov_*`, `irp.fas.org_en_military-medicine_*`, `trueprepper.com_*` | Preparedness, travel health, military medicine and prepper libraries | Check each source's terms |
| `zim/appropedia_*` | Appropriate technology (water filters, solar, cooking) | CC BY-SA |
| `zim/*.stackexchange.com_*` | DIY, Electrical Engineering, Outdoors, Amateur Radio, Sustainability, Cooking | CC BY-SA |
| `pdf/hesperian_where_there_is_no_doctor_2025/` | *Where There Is No Doctor*, all chapters | **Free or at-cost redistribution only** |
| `pdf/ifrc_first_aid_guidelines_2020.pdf` | IFRC evidence base | IFRC |

To serve the ZIMs as HTTP for the retrieval pipeline, run `kiwix-serve hub/zim/*.zim`. To extract them to text, use `python-libzim`.

## feeds/: live snapshots

`scripts/snapshot_feeds.sh` writes `feeds/<UTC timestamp>/` and points `feeds/latest` at it. `_index.jsonl` records each file's URL, HTTP status and fetch time, which gives the "as of 14:05" stamp that DATASETS.md asks for. A cron job running it every 5–15 minutes on the hub gives you the "last snapshot with its age" fallback.

| File | Source | Terms |
|---|---|---|
| `govuk_emergency_alerts.atom` | GOV.UK Emergency Alerts | OGL |
| `ea_flood_warnings.json` | Environment Agency flood monitoring | OGL, attribution statement required |
| `metoffice_warnings_{uk,se}.atom` | Met Office severe weather warnings | **Relay verbatim**, don't paraphrase |
| `ukhsa_{heat,cold}_alerts.json` | UKHSA weather-health alerts (community-documented endpoint) | OGL |
| `ukpn_live_faults.json` | UK Power Networks live faults (London, SE, East) | UKPN open data |
| `nged_live_power_cuts.csv` | NGED live power cuts (Midlands, SW, Wales) | NGED open data |
| `tfl_line_status.json`, `tfl_road_disruptions.json` | TfL Unified API (works without a key, but rate-limited) | TfL open data |
| `gdacs_events.json`, `gdacs_rss.xml` | GDACS global disaster alerts | Free |

## Not downloaded, and why

| Item | Reason | Next step |
|---|---|---|
| The Circuit (BHF AED register) | Can't be used in an app without BHF's written consent | Use OSM `aed` (included) or ask BHF |
| NHS Website Content API, NHS Service Search | Needs a developer-portal key | Register, then add it to `download_guides.sh` |
| BNF via NICE | Needs a licence | Apply (no fee for UK-only use) |
| ReliefWeb | Needs a pre-approved `appname` | Request one |
| Fuel Finder | OAuth through GOV.UK One Login | Register |
| ERG 2024 (CAMEO companion) | PHMSA returns 403 to scripted downloads | Download by hand from phmsa.dot.gov into `phone/guides/pdf/` |
| UK Hazchem / EAC list (NCEC) | No open download found | Check with NCEC |
| WikEM | Not in the current Kiwix catalogue | Look for it on wikem.org |
| Falling Fruit | Mixed, mostly non-commercial licences, and the blueprint rules out plant ID | Leave out |
| "Run, Hide, Tell" / "Remove, Remove, Remove" | No stable GOV.UK page found by the API | Curate by hand into the first-aid cards |
| EA 3-day flood forecast | Endpoint not confirmed | Find it in the EA/FFC docs |
| Full Wikipedia (49 GB), Electronics SE beyond the current set | Not needed for the MVP | Add to `download_zims.sh` if wanted |

The **first-aid cards** (rank 3 in DATASETS.md) still have to be written by hand from the IFRC, NHS and CMO sources here. They aren't a download.

## Scripts

| Script | Does |
|---|---|
| `scripts/fetch_all.sh [phone\|hub\|all]` | Everything below, in order |
| `scripts/extract_pois.py PBF OUTDIR` | OSM to POI GeoJSON + SQLite (pyosmium) |
| `scripts/extract_pmtiles.py URL OUT MINLON MINLAT MAXLON MAXLAT MAXZOOM` | Fallback only. A pure-Python version of `pmtiles extract`. `fetch_all.sh` uses the official `pmtiles` CLI v1.31.2 (installed in `.tools/`, checked against GitHub's SHA-256 digest) and switches to this script if the CLI is unavailable |
| `scripts/download_zims.sh [phone\|hub\|all]` | Kiwix ZIMs from the dotsrc mirror (falls back to download.kiwix.org), with SHA-256 checks |
| `scripts/download_guides.sh` | PDFs, GOV.UK Content API, Be Ready pages, Give Food, Hesperian |
| `scripts/snapshot_feeds.sh` | One timestamped snapshot of every live feed |
| `scripts/build_manifest.py phone hub` | Writes `manifest.json` for each tier |
