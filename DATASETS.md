# Datasets and live feeds (open draft)

A catalogue of data the project could carry or relay when the internet is down, focused on **urban emergencies in the UK (London first)**, because BitChat's Bluetooth mesh only works where phones are dense. Compiled on **21 November 2026**. Entries marked **✓** had their access and terms checked against a source on that date. Entries marked **?** are leads that still need checking. Nothing here has been integrated or tested yet.

See [README.md](README.md) for the concept, [BLUEPRINT_1.md](BLUEPRINT_1.md) for the MVP architecture and [PLAN.md](PLAN.md) for the open decisions.

**The target system.** A central hub has internet access, and people reach it by daisy-chaining phone to phone over the BitChat mesh. In the MVP described in [BLUEPRINT_1.md](BLUEPRINT_1.md#decisions), the hub is the team's DGX Spark, a remote GPU server that serves Ministral 3 14B Instruct through Ollama. The Mac bridge at the venue joins the mesh and forwards each question to the hub over the internet. The MVP uses that connection only to reach the hub's open-weight model, and the live feeds below come after the MVP. If the demo shows any of them, it uses recorded snapshots or a live connection, and the pitch says which. This doc also proposes answers to two of the blueprint's open questions and data for one stretch goal: which guides to load on the hub and under which licences, which tile source to use for the London map, and "nearest shelter or water source".

---

## 1. What information matters most

The purpose of this doc is to work out which information is most crucial in an urban emergency. It ranks information by four things: **how fast harm arrives without it**, **how many people need it**, **whether it changes over time** (anything that doesn't can be stored on the phone in advance) and **how bad a wrong answer would be**. The evidence below comes from real outages and disasters. None of it is from the UK, so treat it as a strong guide, not proof.

| Rank | Need | Why it ranks here | Changes over time? | Best home |
|---|---|---|---|---|
| **1** | **"Are my people safe?" / "I'm safe"** | After the 2011 Japan earthquake, most people's first calls were to check on their own safety and their family's. In the disaster zone it took about 4 hours on average to reach family or friends ([Weathernews][wn-japan]) | Yes. It's two-way and personal | **Through the hub to the internet** (SMS or email to named contacts, with a delivery receipt back). Only an internet-connected hub can do this |
| **2** | **Immediate danger and official instructions** (evacuate, shelter in place, flood, fire, chemical leak, water unsafe to drink) | Minutes to hours, affects everyone in an area, and only the authorities know it | Yes | **Live from the hub**, pushed to the mesh ahead of all other traffic |
| **3** | **Life-saving first aid and hidden killers** (bleeding, CPR and the nearest AED, choking, burns, **carbon monoxide from generators and barbecues used indoors**, hypothermia and heat) | Harm arrives in minutes. Most of the [246 deaths in the 2021 Texas winter storm][texas] were hypothermia, followed by crashes, CO poisoning and failures of medical equipment and home oxygen. Only 15 of 526 US generator CO deaths in 2004–2013 involved a generator run outdoors ([CPSC][cpsc]) | No | **On the phone.** A trip to the hub and back is too slow, and the hub might be unreachable |
| **4** | **Keeping medical care going** (which pharmacy, GP or A&E is open; how to store insulin without a fridge; where to power oxygen or other medical equipment) | A third of the estimated 4,645 excess deaths after Hurricane Maria came from delayed or interrupted care. The most common problems were getting medication (14.4%) and powering breathing equipment ([NEJM][maria]) | Partly. The advice is static, but which places are open is live | Advice on the phone; **opening status live from the hub** |
| **5** | **"What's happening, and when will it end?"** | In Spain's April 2025 blackout, 60% said official information was insufficient. They most wanted the cause (38%) and when power would return (26%). 62% listened to the radio, but only about half owned a battery radio ([CIS][cis-blackout]) | Yes | **Live from the hub**: a short news digest, the power restoration estimate, and which radio frequency to tune to |
| **6** | **Daily needs** (water stations and boil notices, food distribution, rest centres and warm or cool spaces, phone charging, cash, fuel, transport) | Hours to days, and affects everyone | Locations: no. Whether they're open or stocked: yes | Locations on the phone; **status live from the hub** |
| **7** | **Fixing and improvising** (repairs, water purification, power banks) | Useful over days, rarely urgent | No | Phone (selected guides) or hub (full libraries) |
| **8** | General knowledge, foraging | Low urgency, and foraging carries poisoning risk | No | Hub, if at all |

**What this means for the design:**

- **The internet-connected hub earns its place on ranks 1, 2, 4, 5 and 6.** All of those are *live and local*, and a phone can't store them in advance. Rank 3 has to be on the phone already. Rank 1 is the strongest case for the whole system, because no offline store can do it.
- **Mesh traffic needs priority levels.** Bandwidth is tiny, so send in this order: alerts, then safety check-ins, then requests for help, then answers to questions, then news.
- **Every live item needs a source and timestamp.** In the Spanish blackout, information was missing and rumours filled the gap. Answers like "UKPN: power back by 18:00 (as of 14:05)" keep the hub trustworthy.
- **The UK scenario to design for.** The [National Risk Register][nrr] has a regional electricity failure that brings down telecoms and transport with it. A 2026 guide to the register warns that a national power outage could cascade into water, communications and transport. That scenario is exactly where a phone mesh plus a hub fits.

---

## 2. The constraint that shapes everything: the mesh is tiny

BitChat sends **512-byte BLE packets**. Larger messages are split into fragments of about 469 bytes, and a packet starts with **TTL 7**, which relays cap at 5 in dense areas ([whitepaper][bitchat-wp], [fragmentation notes][bitchat-frag]). So every answer that crosses the mesh should fit in **one to three fragments (≤ ~1 KB)**. That gives each piece of data one of four places to live:

| Tier | Where the data lives | How the offline user gets it | Good for |
|---|---|---|---|
| **0. On the phone** | Downloaded before the emergency with the offline map | Instantly, with no mesh and no hub | Map tiles, place locations (water, AEDs, pharmacies, shelters) and a small set of first-aid cards. **The most robust tier**, because it still works when the hub is out of range |
| **1. On the hub** | Stored on the hub and searched by its open-weight Mistral model (the blueprint's "retrieval over the survival guides") | A BitChat private message with a short question, answered in the blueprint's two-message format | Guide collections too big for a phone (WikiMed, iFixit, Wikipedia), and "nearest X" lookups against OSM data on the hub |
| **2. Live, via the hub** | The hub pulls live feeds over its internet connection and condenses them into bulletins | Asking the hub "what's happening?", or bulletins posted to the public mesh channel, which phones cache and re-share so **one fetch serves the whole area** | Alerts, news, floods, power cuts, service status, transport (ranks 2, 4, 5 and 6) |
| **3. Made on the mesh** | Reports that users send to the hub | Shared back as aggregates | "I'm safe" check-ins, needs, sightings of working taps or open shops |

**When the hub loses its own connection,** it keeps serving the **last snapshot with its age** ("EA flood warnings as of 09:40, 3 h ago") instead of going silent. The same mechanism lets the MVP demo replay recorded feeds, if it shows any.

**Trust in the hub.** BitChat private messages use Noise sessions. The hub is not a BitChat peer, so each session ends at the Mac bridge. If a user verifies the Mac bridge's fingerprint once (in person or by QR code), answers can be traced back to the Mac bridge, and the link from the Mac bridge to the hub needs its own check. A separate signature (for example a 64-byte Ed25519 signature) only matters if phones re-share bulletins that other phones then rely on. Check how BitChat signs public messages before adding one. The team deferred hub identity verification, and [the blueprint's deferred questions](BLUEPRINT_1.md#deferred-questions) list it.

**Many queries need no LLM.** "Nearest drinking water" is a lookup against OpenStreetMap that returns three coordinates. Use Mistral where it adds value (answering first-aid or repair questions from retrieved guides, condensing feeds, translating) and let deterministic lookups win everywhere else. This is also what [critique.md](critique.md) asks for.

---

## 3. Catalogue by need

The headings follow the six needs in [IDEA.md](IDEA.md), plus repair, hazards and news.

### 3.1 First aid and medical

| Dataset | What it gives | Tier | Access and terms | |
|---|---|---|---|---|
| [IFRC International First Aid, Resuscitation and Education Guidelines][ifrc] | The evidence base for first aid. A 2025 edition exists, and the 2020 PDF is free | 0 / 1 | Free PDF. It's written for programme designers, so rewrite it into plain steps before showing it to the public | ✓ |
| [NHS Website Content API v2][nhs-api] | Health A–Z, medicines A–Z, mental health | 0 (cached subset) / 1 | Free syndication. Register on the developer portal and accept the syndication terms. The website content itself is OGL | ✓ |
| [WikiMed (Kiwix ZIM)][kiwix-wikimed] | 75,000+ medical Wikipedia articles. A "mini" version without images is about 85% smaller | 0 (mini) / 1 | CC BY-SA, free from library.kiwix.org | ✓ |
| WikEM (Kiwix ZIM) | Emergency-medicine wiki, aimed at clinicians | 1 | In Kiwix's [prepper selection][kiwix-preppers] | ✓ |
| [Where There Is No Doctor][hesperian] (Hesperian, 2025 edition) | The classic lay medical manual | 0 / 1 | Free PDF. Hesperian holds the copyright and allows reuse **only if it is distributed free or at cost** | ✓ |
| [WHO Psychological First Aid][who-pfa] | How to support people in distress, 62 pages | 0 | Free WHO publication | ✓ |
| [BNF via NICE syndication][nice] | Authoritative UK drug doses and interactions | 1 | Needs a licence. No fee for UK-only use | ✓ |
| openFDA / DailyMed drug labels | US drug labels as a fallback reference | 1 | US public domain | ? |
| "Remove, Remove, Remove" (chemical contamination) and "Run, Hide, Tell" (attacks) | Short official UK public-safety drills | 0 | GOV.UK content, likely OGL. Curate by hand | ? |
| NHS Pathways / NHS 111 triage | **Not available.** It's licensed, so don't let the agent imply it does NHS 111 triage | — | — | ✓ (gap) |

Places where help is available:

| Dataset | What it gives | Tier | Access and terms | |
|---|---|---|---|---|
| OpenStreetMap: `amenity=hospital`, `pharmacy`, `doctors`, `clinic` | Locations, sometimes opening hours | 0 | ODbL | ✓ |
| OpenStreetMap: [`emergency=defibrillator`][osm-aed] | Defibrillator (AED) locations. OSM UK ran a 2024 mapping drive | 0 | ODbL | ✓ |
| [The Circuit (BHF)][circuit] | The most complete UK AED register | — | **Can't be used in an app** without BHF's written consent, and isn't licensed for OSM. Ask BHF, or use OSM | ✓ |
| NHS Service Search / ODS | Pharmacies, GPs and A&E departments, with opening times | 0 / 1 | NHS API catalogue | ? |

### 3.2 Water and sanitation

| Dataset | What it gives | Tier | Access and terms | |
|---|---|---|---|---|
| OSM: `amenity=drinking_water`, `water_point`, `toilets`; `man_made=water_tap`; `natural=spring` | Where to get water in the city | 0 | ODbL | ✓ |
| [UK CMOs' scripts for a national power outage][cmo-scripts] (December 2025) | Official advice on water, sanitation, food and nutrition during a long blackout, written for broadcast | 0 | GOV.UK | ✓ |
| [Prepare (GOV.UK)][prepare] | Power cuts, water outages and phone/broadband outages, plus a supplies checklist | 0 | GOV.UK campaign site. Licence not confirmed | ✓ / ? |
| Sphere Handbook | Humanitarian minimum standards, e.g. litres of water per person per day | 0 | Free online at spherestandards.org | ? |
| Water company incident pages (Thames Water and others) | Where bottled-water stations and standpipes are | 2 | No known API, so the hub would have to scrape them | ? |

### 3.3 Food

| Dataset | What it gives | Tier | Access and terms | |
|---|---|---|---|---|
| [Give Food API][givefood] | 3,100+ UK food banks, 7,600+ donation points, and what each one needs | 0 / 2 | JSON or GeoJSON. Credit and link back. **Contact them before launch.** No explicit licence found | ✓ |
| OSM: supermarkets and convenience stores with `opening_hours`; `amenity=food_sharing` / `give_box` | Where food might be available, including community fridges | 0 | ODbL | ✓ |
| [Falling Fruit][fallingfruit] | Urban foraging map (fruit trees, etc.) | 0 | **The licence varies by source and many are non-commercial.** The public API isn't fully documented. **The blueprint rules out plant and fungus identification** because a wrong answer can poison someone. If this is used at all, show only mapped, named fruit trees and never have the model identify plants | ✓ |
| London Datastore street trees | Species-level tree locations, for finding fruit trees | 0 | London Datastore | ? |
| Food Standards Agency guidance | How long food is safe in a fridge or freezer without power | 0 | GOV.UK | ? |

### 3.4 Energy and power

| Dataset | What it gives | Tier | Access and terms | |
|---|---|---|---|---|
| [UK Power Networks live faults ("Powercast")][ukpn] | Near-real-time planned and unplanned power cuts in **London**, the South East and the East | 2 | Opendatasoft API. **May need an account.** Locations are aggregated by postcode for privacy | ✓ |
| [NGED live power cuts][nged] | The same for the Midlands, South West and Wales | 2 | National Grid connected-data portal | ✓ |
| Other network operators (SSEN, Northern Powergrid, ENWL, SPEN) | The rest of Great Britain | 2 | — | ? |
| [Fuel Finder][fuelfinder] | Statutory, per-forecourt fuel prices and amenities, updated within 30 minutes of a change. Useful for generators and car charging | 2 | OAuth with GOV.UK One Login. Users report token errors, and [RAC found data errors][rac] | ✓ |
| OSM: `amenity=charging_station`; libraries and community centres | Places that might have power | 0 | ODbL | ✓ |

### 3.5 Communication

| Dataset | What it gives | Tier | Access and terms | |
|---|---|---|---|---|
| [GOV.UK Emergency Alerts Atom feed][alerts-feed] | Every cell-broadcast alert. **Re-broadcast them over the mesh** to phones that were off or out of coverage | 2 | OGL. Rarely updated | ✓ |
| BBC local and national radio frequencies (Ofcom transmitter data) | "Tune a battery radio to …". The BBC is the UK's emergency broadcaster | 0 | Ofcom open data | ? |
| PMR446 channel plan; RAYNET-UK; UK repeater list | Licence-free walkie-talkies and volunteer emergency radio | 0 | Public | ? |
| Wikivoyage phrasebooks (Kiwix ZIM) | Offline phrases for non-English speakers | 0 | CC BY-SA | ? |
| British Red Cross / ICRC Restoring Family Links | Where people go to trace family | 0 (pointer only) | — | ? |

### 3.6 Navigation and places

| Dataset | What it gives | Tier | Access and terms | |
|---|---|---|---|---|
| [Protomaps PMTiles daily build][protomaps] | A single-file offline vector map. `pmtiles extract --bbox` cuts out London | 0 | ODbL. BLAKE3 hashes provided. **Old builds expire after about a week**, so pin a copy | ✓ |
| Geofabrik `greater-london-latest.osm.pbf` | Raw OSM data for POI search and offline routing (GraphHopper, Valhalla or OSRM) | 0 / 1 | ODbL | ? |
| OS Open Zoomstack / OS OpenMap Local | Ordnance Survey basemap | 0 | OGL | ? |
| OSM: `emergency=assembly_point`, `amenity=shelter`, `social_facility=shelter`, `community_centre`, `library`, `place_of_worship` | Places to gather or shelter. Council rest centres are **not** published in advance, so they arrive through Tier 2 | 0 | ODbL | ✓ |
| [EA flood-monitoring API][ea-flood] | Live flood warnings, river levels and a 3-day flood-risk forecast | 2 | **No key**, OGL. Requires an attribution statement. Still Beta | ✓ |
| Flood Map / Risk of Flooding from Rivers and Sea | Static flood zones, so routes can avoid them | 0 | EA, OGL | ? |
| [TfL Unified API][tfl] | Tube, bus and rail line status and disruptions, published every 30 seconds | 2 | Free. Registration recommended | ✓ |
| Bus Open Data Service; National Rail Darwin | Live bus positions and train running | 2 | DfT / Rail Delivery Group | ? |
| National Highways traffic data (NTIS / DATEX II) | Road closures and incidents on major roads | 2 | — | ? |

### 3.7 Repair and practical skills

| Dataset | What it gives | Tier | Access and terms | |
|---|---|---|---|---|
| [iFixit (Kiwix ZIM)][ifixit] | Every iFixit repair guide in 12 languages: phones, power banks, generators | 1 (whole) / 0 (selected guides) | CC BY-NC-SA (non-commercial) | ✓ |
| Stack Exchange ZIMs: DIY, Electrical Engineering, Outdoors, Amateur Radio | Q&A for fixing, wiring and improvising | 1 | CC BY-SA | ? |
| [Ready.gov (Zimit ZIM)][kiwix-zimit] | US disaster-preparedness guides | 0 | US public domain | ✓ |
| Kiwix prepper selection: *Food for Preppers*, *Military Medicine*, water-treatment and food-preservation books | Curated survival library | 0 / 1 | Free individually from Kiwix. The bundle is sold on hardware | ✓ |
| Appropedia | Appropriate technology: water filters, solar, cooking | 1 | CC BY-SA | ? |
| Wikipedia (full, no-pictures and "top" ZIMs) | General knowledge | 1 | CC BY-SA | ✓ |

### 3.8 Urban hazards

| Dataset | What it gives | Tier | Access and terms | |
|---|---|---|---|---|
| [Met Office severe weather warnings (RSS)][metoffice-rss] | Official UK weather warnings | 2 | Free with attribution. **Warnings must be shown without modification ([style guide][metoffice-style])**, so Mistral must not paraphrase them. Relay a verbatim excerpt | ✓ |
| [UKHSA weather-health alerts][ukhsa] | Heat and cold health alerts for England | 2 | Dashboard API with no authentication (Beta). The alerts endpoint is only community-documented | ✓ |
| [CAMEO Chemicals + ERG 2024][cameo] | Identify a chemical from a tanker's placard and see the safe distance and first aid | 0 | US government, works offline. **The UK uses Hazchem plates**, so pair it with the UK emergency action code list | ✓ |
| UK Dangerous Goods Emergency Action Code list (NCEC) | Decodes UK Hazchem plates | 0 | — | ? |
| London Air Quality Network / DEFRA UK-AIR | Smoke and pollution levels during fires | 2 | — | ? |

### 3.9 News and situational awareness

| Dataset | What it gives | Tier | Access and terms | |
|---|---|---|---|---|
| GOV.UK Content and Search APIs, plus department Atom feeds | Official statements (COBR, Cabinet Office, councils) | 2 | OGL | ? |
| BBC News RSS | Headlines | 2 | Copyright. **Relay headlines with a link, not rewritten articles** | ? |
| [GDACS API][gdacs] | Global disaster alerts as GeoJSON | 2 | Free | ✓ |
| [ReliefWeb API v2][reliefweb] | UN OCHA situation reports | 2 | Needs a pre-approved `appname`. Rights stay with each source | ✓ |
| GDELT | Global news events, updated every 15 minutes | 2 | Free | ? |
| Official accounts: Met Police, London Fire Brigade, London Ambulance Service, TfL, councils (Bluesky, Mastodon, X) | Fastest local updates | 2 | X's API is paid; Bluesky and Mastodon are open | ? |

### 3.10 Data made on the mesh (Tier 3)

These are datasets **we** create. They may matter most for the critique's "complete a useful job" test.

- **Safe and well check-ins.** "I'm OK" plus an optional coarse location, delivered by the hub to named family contacts, with delivery confirmed back to the sender.
- **Needs reports**, such as "2 people, need water, insulin". Use structured fields (possibly [HXL][hxl] tags) so responders can aggregate them.
- **Resource sightings**, such as "Tesco on X Road open", "tap at Y working" or "charging available at the library". Each one is timestamped and fades out as it ages.

Each of these needs consent, minimal location precision and an expiry, in line with the trust principles in PLAN.md.

---

## 4. On-device AI option

The blueprint runs question answering on the hub, so the phones spend no battery on it. The only model on the phones is the vision model for Locate. [Ministral 3 3B][ministral] (Apache 2.0, released December 2025) runs fully on a phone, and the blueprint names it as one candidate for that model. Martin owns the choice. A community int4 build is about 2.7 GB and decodes at about 17.6 tokens/s on an iPhone 17 Pro. Combined with Tier 0 data, it could also answer basic first-aid questions **when the hub is out of range**. That needs a large download in advance, so treat it as a fallback after the MVP, not the core flow.

---

## 5. Licence traps to settle before building

- **Non-commercial content** (iFixit, Hesperian, many Falling Fruit sources) conflicts with the commercial routes in critique.md. Keep it separate or get permission.
- **ODbL (OSM, Protomaps):** a derived database we distribute must be shared under ODbL, with attribution.
- **Must stay verbatim:** Met Office warnings. EA data needs its exact attribution statement.
- **Explicitly not for apps:** The Circuit defibrillator data.
- **Contact first:** Give Food, the NHS syndication terms, NICE (BNF) and ReliefWeb (`appname`).
- **Every relayed answer should state its source and time.** The trust promise in PLAN.md depends on it, and it separates official information from rumour.

---

## 6. Suggested hackathon shortlist

The shortlist follows the ranking in section 1. The MVP leaves the target hub's live information and outside messages out. If the demo shows items 1, 2, 4 or 5, they come from recorded snapshots and a simulated outbound delivery or from a live connection. The pitch says which, and [the blueprint's open questions](BLUEPRINT_1.md#open-questions) leave that choice open.

1. **Rank 1: safe and well check-in.** The phone sends "I'm safe" plus an optional location. The hub forwards it to a named contact (SMS or email) and sends a delivery receipt back over the mesh. This is the one thing only an internet-connected hub can do, and it closes the delivery gap in [critique.md](critique.md).
2. **Ranks 2 and 5: one live bulletin under about 400 bytes.** Combine the GOV.UK alerts feed, EA flood warnings and Met Office warnings (verbatim), the UKPN restoration estimate and TfL status. Give each item its source and timestamp, and push it ahead of other mesh traffic.
3. **Rank 3: life-saving cards on the phone.** Severe bleeding, CPR with the nearest AED from OSM, choking, burns, carbon monoxide, hypothermia and heat. Base them on IFRC, NHS and the UK CMOs' outage scripts. They are a few kilobytes of text and need no hub.
4. **Rank 4: "where can I get my medicine?"** Pharmacies and hospitals from OSM, with opening status from NHS service data where available.
5. **Rank 6: nearest water, shelter, charging point or food bank.** A Geofabrik London extract on the hub. This is a deterministic lookup that fits in one packet, so no model run is needed.
6. **Underneath everything:** a Protomaps extract of London, the demo map region, as the offline map (build step 4), and a guide library on the hub for other questions (WikiMed mini, the WHO Psychological First Aid guide, the Prepare pages and iFixit). The hub should **name the guide each answer came from**.
7. **The evaluation set.** Yanan's evals own the test questions and the answer rubric, which [the blueprint defers](BLUEPRINT_1.md#deferred-questions). Draw candidate scenarios from ranks 1 to 6. Use the guides and feeds above as the source of expected facts, so that a "correct answer" means one that matches a named source.

## 7. Open questions

- [x] Is the hub online or offline in the demo? [The blueprint's decisions](BLUEPRINT_1.md#decisions) answer it. The hub is the remote DGX Spark, and the Mac bridge reaches it over the internet, so do not call the demo hub offline. The phones have no internet. Live feeds and delivery to family come after the MVP, and [the blueprint's open questions](BLUEPRINT_1.md#open-questions) still ask whether the demo shows them with recorded data or a live connection.
- [ ] Does the team agree with the ranking in section 1? A quick check with someone from a local resilience forum or the British Red Cross would strengthen it.
- [ ] How much Tier 0 data can each iPhone hold? [The blueprint's decisions](BLUEPRINT_1.md#decisions) set London as the demo map region.
- [ ] How do users verify the hub's identity, and does the team need a signature beyond BitChat's own? The team deferred this question, and [the blueprint's deferred questions](BLUEPRINT_1.md#deferred-questions) list it.
- [ ] Do we keep anything non-commercial (iFixit, Hesperian) given the commercial direction in critique.md?
- [ ] Which ? entries do we verify first?

[bitchat-wp]: https://github.com/permissionlesstech/bitchat/blob/main/WHITEPAPER.md
[bitchat-frag]: https://deepwiki.com/jackjackbits/bitchat/5.3-fragmentation-and-reassembly
[ifrc]: https://www.ifrc.org/document/international-first-aid-resuscitation-and-education-guidelines
[nhs-api]: https://digital.nhs.uk/developer/api-catalogue/nhs-website-content/v1
[kiwix-wikimed]: https://get.kiwix.org/en/solutions/catalog/
[kiwix-preppers]: https://hub.kiwix.org/weblog/2024/02/for-all-preppers-out-there/
[kiwix-zimit]: https://ftp.fau.de/kiwix/zim/zimit/
[hesperian]: https://hesperian.org/wp-content/uploads/pdf/en_wtnd_2025/en_wtnd_2025_fm.pdf
[who-pfa]: https://iris.who.int/handle/10665/44615
[nice]: https://nice.org.uk/about/what-we-do/nice-syndication-api
[osm-aed]: https://wiki.openstreetmap.org/Tag:emergency=defibrillator
[circuit]: https://www.bhf.org.uk/how-you-can-help/how-to-save-a-life/defibrillators/national-defibrillator-network-the-circuit/defibrillator-location-data
[cmo-scripts]: https://www.gov.uk/government/publications/public-health-advice-from-uk-cmos-during-a-national-power-outage/water-and-sanitation-scripts-for-broadcast-media
[prepare]: https://prepare.campaign.gov.uk/be-informed-about-hazards/power-cuts
[givefood]: https://www.givefood.org.uk/api/
[fallingfruit]: https://fallingfruit.org/maps
[ukpn]: https://data.london.gov.uk/dataset/live-power-cuts
[nged]: https://connecteddata.nationalgrid.co.uk/dataset/live-power-cuts
[fuelfinder]: https://www.gov.uk/guidance/access-the-latest-fuel-prices-and-forecourt-data-via-api-or-email
[rac]: https://www.racfoundation.org/media-centre/fuel-finder-data-errors
[alerts-feed]: https://www.gov.uk/alerts/feed.atom
[protomaps]: https://docs.protomaps.com/basemaps/downloads
[ea-flood]: https://environment.data.gov.uk/flood-monitoring/doc/reference
[tfl]: https://api-portal.tfl.gov.uk/
[ifixit]: https://github.com/openzim/ifixit
[metoffice-rss]: https://weather.metoffice.gov.uk/guides/rss
[metoffice-style]: https://www.metoffice.gov.uk/binaries/content/assets/metofficegovuk/pdf/about-us/what-we-do/nswws/nswws-style-guide-update-v1.3-final.pdf
[ukhsa]: https://ukhsa-dashboard.data.gov.uk/access-our-data/
[cameo]: https://epa.gov/cameo/cameo-chemicals-software
[gdacs]: https://www.gdacs.org/
[reliefweb]: https://apidoc.reliefweb.int/
[hxl]: https://hxlstandard.org/
[ministral]: https://docs.mistral.ai/models/ministral-3-3b-25-12
[wn-japan]: https://global.weathernews.com/wp-content/uploads/2015/10/20110528_weathernews.pdf
[texas]: https://www.dshs.texas.gov/sites/default/files/news/updates/SMOC_FebWinterStorm_MortalitySurvReport_12-30-21.pdf
[cpsc]: https://www.cpsc.gov/s3fs-public/Generators%20and%20OEDT%20CO%20Poisoning%20Fatalities%20Report%202019.pdf
[maria]: https://dash.harvard.edu/bitstream/1/37309252/1/nejmsa1803972.pdf
[cis-blackout]: https://en.ara.cat/politics/cis-verdict-the-blackout-60-of-spaniards-believe-official-information-was-insufficient_1_5366777.html
[nrr]: https://gov.uk/government/publications/national-risk-register-2025
