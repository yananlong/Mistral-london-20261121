# Hackathon evidence and commercial critique

Reviewed **21 November 2026** against [main at `15542b8`][reviewed], including the connected-hub target and data catalogue in [PR #4][pr4]. The [repository says the app, hub and vision model are unbuilt and untested][readme-status]. This is a proposal for a bounded demo and an exploratory evaluation, not evidence of performance, emergency readiness, customer demand or event eligibility. External sources were checked on the review date.

## Decision and requirements

The intended prototype uses an **internet-connected Mac mini hub** to call hosted Mistral Large 4 (ML4). An iPhone and an Android phone reach the hub over a local link or mesh without internet access of their own. Demonstrate a fresh, low-risk question travelling phone → hub → ML4 API → hub → phone. Test both actual phones and the hub round trip before investing in a custom app, relay, or vision. The proposed Talk, Locate and Ask capabilities, cross-platform support, modified hub and two-hop route remain unproved; present any reduction as a scope change, not the complete MVP.

The user specified the two phone platforms, a Mac mini with M6 chip and 32 GB RAM, ML4, a four-hour build budget and an 18:00 UTC submission on 21 November. The user has also clarified that the prototype hub may use the internet. These are user-provided constraints, not verified event rules or independently checked hardware; confirm the organizers' requirements separately.

At the reviewed revision, the [README][readme-flow] and [blueprint][blueprint-target] describe a connected **target** hub but still specify an offline Mac and a local model for the MVP and demo ([README][readme-flow], [blueprint][blueprint-mvp]). [PLAN.md][plan-mvp] is older and still says no internet anywhere. Those files need reconciliation with the correction; this critique does not change them. In particular, do not claim cloud ML4 keeps answering when the uplink fails; any fallback must be identified and tested, and a smaller model is not ML4. A phone can be offline while the hub and inference service are online.

### Hosted ML4 and its dependencies

Use the hub's uplink to call the intended hosted ML4 endpoint. Before integration, verify credentials, credits, service access, the actual model ID and a fresh response; record failures, latency and any provider rate or quota limits encountered. The [Mistral model card][ml4] and [Ollama's ML4 listing][ollama-ml4] describe hosted access; Ollama's `mistral-large-4:cloud` is also a cloud call, not local inference. No live ML4 call has been tested for this review. Do not expose API keys in logs or screenshots.

The Mac does not need to store the ML4 weights for hosted inference. For scale only, Mistral lists [1.05 trillion total parameters and 52 billion active][ml4]; an illustrative four-bit copy of all parameters would be about 525 GB before overhead. That is a storage calculation, not a RAM requirement or proof that offloading is impossible. A smaller local model would be a different model and is not the requested ML4; it is an optional, separately tested fallback, not an assumed way to keep hosted ML4 available during an outage. Hosted Voxtral in [the setup notes][voxtral-setup] likewise uses internet for new audio; Mistral's [“offline” audio terminology][audio-modes] does not establish disconnected inference.

## What the transport and phone claims need

The [blueprint][blueprint-transport] describes an iOS fork and offers a four-hour BitChat timebox before switching to Apple Multipeer. That timebox consumes the entire build budget; the fork does not add the proposed screens to the Android phone. [BitChat for Android][bitchat-android] claims protocol compatibility with iOS/macOS and BLE multi-hop, while also describing Wi-Fi Aware and internet-based Nostr paths. Those are project claims, not proof that the exact installed versions interoperate, route a private message to the Mac, or relay under venue conditions. Record device models, OS and app/build versions; test the actual iPhone, Android and Mac, permissions, foreground/background behaviour and both directions. Check whether builds and signatures are already available; otherwise include setup in the four-hour budget. Do not assume the plan's [free signing and device limits][plan-constraints] work for the actual accounts and capabilities.

The plan's claim that [Nearby requires the same OS][plan-constraints] is too broad: [Google documents Nearby Connections between Android and iOS][nearby], although this project has not tested it or established a compatible Mac hub. Apple Multipeer is an Apple-platform fallback, not a drop-in BitChat or Android client. Apple's [documentation][multipeer] lists infrastructure Wi-Fi, peer-to-peer Wi-Fi and Ethernet on macOS, **not Bluetooth** as its macOS transport; Apple has [deprecated the framework][multipeer-migration]. A Mac with Wi-Fi off and Ethernet unplugged therefore has no documented Multipeer transport in that configuration. A phone may use local Wi-Fi without internet if routing and firewall rules actually prevent its access to the hub's uplink; that changes the blueprint's radio configuration. Neither fallback proves BitChat compatibility or multi-hop routing.

Use these claims only after the corresponding observation:

| Claim | Minimum observation |
| --- | --- |
| **Phones have no internet** | On both phones show cellular disabled and actual Bluetooth/Wi-Fi settings, routes and any tethering or proxy configuration. If using local Wi-Fi, block phone egress through the hub or router and verify it. Failed external requests corroborate isolation but do not prove it alone. Airplane mode alone is insufficient because radios can be re-enabled. |
| **Phone-to-phone local message** | A fresh message arrives in each direction on the named app and transport while the phones have no internet. Record device, OS and app versions. |
| **Hosted ML4 round trip** | With the Mac's uplink active, a fresh identifiable phone request reaches the Mac, triggers the actual ML4 endpoint, and its correlated response returns to the phone. Record sanitized request/model metadata, host, timings and result; do not display credentials or private content. Repeat on each tested phone. |
| **Relay through phone B** | Show A cannot reach the hub directly, then use route/hop evidence or a controlled B-off/B-on test with fresh IDs, the same placement and no other relay. Radio range is variable; proximity alone is not route evidence. If isolation is inconclusive, describe the path as unverified. |
| **Uplink failure and recovery** | After the hub acknowledges a request, interrupt its internet/API path while keeping the local phone link working; show the actual status and recovery after connectivity returns. Do not promise an ML4 answer during the outage. |

A receipt means the hub received the request, not that the API processed it, a human received it or the answer is correct. The [proposed 30-second timeout][blueprint-states] only establishes that an acknowledgement did not arrive in time. Use request IDs, correlate acknowledgements and answers, and label that timeout **“No acknowledgement yet”**. After acknowledgement, use a separate answer deadline and show **“Acknowledged; answer delayed or unavailable”** if it expires. If the hub actually observes an uplink or API failure and the status can be delivered, report that separately; otherwise do not guess the cause. Deduplicate retries by sender and request ID, bound retries and handle late replies; accept an answer only for the matching request. Do not silently repeat an API call when its outcome is unknown. Test provider errors, rate limits and retry behaviour before claiming recovery. Plain-text stock BitChat can carry a visible ID, but compatibility and parsing remain untested.

## Four-hour build and decision gates

The example below runs **14:00–18:00 UTC** and assumes team members can work in parallel. Include any outstanding downloads or setup in the budget and cut scope if they overrun. It is a wall-clock budget, not four hours per person. If starting later, preserve the submission buffer, shorten or drop scope and move the gates earlier; do not let work run past 18:00.

| UTC | Work and exit condition | If the gate fails |
| --- | --- | --- |
| 14:00–14:20 | Assign transport, API and submission owners; check event rules, phone builds/signing, hub uplink, ML4 credentials and credits. | Record what is unavailable and prepare an honest component demo; do not assume a waiver. |
| 14:20–14:50 | In parallel, test iPhone↔Android local messages with no phone internet and a fresh hosted ML4 call from the connected Mac. Log model ID, endpoint and timing. | Stop treating cross-platform BitChat or ML4 access as established. Show the working component and the failure. |
| 14:50–15:35 | Attempt the smallest bridge: one phone sends a private request, the hub calls ML4 and returns the correlated answer. Test the second phone if the first works. | Stop integration at 15:35. Demonstrate components separately; if needed use an explicitly labelled local Wi-Fi or manual QR handoff and state the radios, hardware and manual steps. |
| 15:35–16:10 | Test a missing acknowledgement and a hub uplink/API interruption after acknowledgement while preserving the phone link. Test retry and recovery. | Drop the custom Ask screen and unproved relay claims. Show the failure or separate components, not a simulated success. |
| 16:10–16:40 | Only after the core works, test a preloaded offline map and a location share on the actual phones. A separate owner can examine one bounded vision case. | Defer map integration or vision and label each as planned/partial. Do not make the full three-capability claim. |
| 16:40–17:15 | Run the small comparison below, log every attempt and one deliberate interruption. | Keep failures in the result table; narrow the claim to what was observed. |
| 17:15–17:40 | Rehearse the three-minute demo and capture configuration, evidence and failures. Freeze feature work. | Use the best honest component demo and recorded evidence. |
| 17:40–18:00 | Finish and submit the required materials; reserve time for upload or submission failure. | Submit the actual result by the deadline, with limitations. |

Prepare phone apps, map data and dependencies within the budget; a successful installation does not establish a working local phone-to-hub path. The [map and vision plan][blueprint-locate] needs a named map region, an offline-permitting tile source and a test case where the camera improves a decision over a map, position and compass alone. The OpenStreetMap Foundation's [standard tile policy][osm-tiles] prohibits bulk prefetch/offline download from `tile.openstreetmap.org`; use a source that permits it or self-hosted data with attribution. Position and heading may be unavailable, stale or inaccurate; show their age/accuracy and a no-fix state. For any vision test, compare its bearing with a compass-only baseline and an independently checked direction in the same scene; record no-fix cases. Vision matching remains untested. Reading a sign alone does not establish better orientation.

## Bounded demo and evidence

Use a fictional event meeting-point card with a few prewritten facts, not a real emergency or live location. Show the phones without internet and the Mac's active uplink, then send a fresh judge-chosen question containing the supplied facts. Show sanitized evidence of the hub's ML4 API request and the correlated answer returning to the phone. Test one interruption before acknowledgement and another after acknowledgement by blocking the hub's API/uplink while retaining the local phone link; record each distinct timeout, retry and recovery. Show the observed interruption behaviour in the demo. If possible, show each phone completing a round trip; if only one succeeds, say which. A map, vision feature or multi-hop relay is a separate beat only if its gate passed. This is a feasibility demonstration, not proof of rescue capability.

Compare the model-assisted task with a human relay: using the same link and fictional card, a person at the Mac composes a checklist and sends it back to the originating phone. Give the model the same card text, let both paths request clarification and measure the same endpoint. Preselect about five cases, including a straightforward card lookup, an ambiguous instruction, missing information, a paraphrase and a link interruption. Vary order when possible. An ordinary card may be faster or more accurate; the comparison is meaningful only if it can win. If the model branch does not complete, report that rather than comparing a simulated answer to a real baseline.

For **every attempt**, record the scenario and trial order; device/OS/app versions; provider, model ID, inference host and API path; radio/uplink settings; transport and claimed hop evidence; send, hub receipt, answer and final receipt times; initial and eventual completion counts and denominator; retries, timeouts and dropped/late/duplicate messages; omissions or altered critical facts; and a blinded-to-condition human check where practical. Include setup time or report it separately consistently. Keep raw results and distinguish a recorded demonstration from a proposed test. Team-run trials are exploratory; five cases cannot establish safety, reliability, statistical advantage or willingness to pay. A realistic template is:

| Configuration / case | Attempts | Initial / eventual completions | Elapsed time including retries | Critical errors / missing facts | Failure and recovery |
| --- | --- | --- | --- | --- | --- |
| Model-assisted | Not yet run | — | — | — | — |
| Card + manual relay | Not yet run | — | — | — | — |

## Safety, privacy and operational limits

The [blueprint's example][blueprint-water] gives water-treatment steps followed by a disclaimer. A disclaimer does not repair incomplete advice: [CDC guidance][cdc-water] distinguishes microbial contamination from fuel, toxic chemicals and radioactive material, for which boiling is not a remedy. For the hackathon, avoid open-ended medical, water, food/foraging, shelter or evacuation advice and use the fictional low-stakes card. Do not claim safety or current disaster knowledge. Any later real-world use needs qualified review, source provenance, versioning, coverage and updates, refusal/escalation behaviour, and evaluation of harmful omissions; retrieval alone is not validation.

Location and message content can reveal sensitive information. Default location sharing off, request explicit consent for each share and destination, and use fictional coordinates in demos. Private-message encryption is not a complete privacy guarantee: the hub sees the question and forwards the relevant content to the hosted model provider; its operator, local logs and provider may retain data under their respective policies. Tell the user before sending, minimize data and location, avoid logging content by default, check the provider's retention terms, and define local retention, deletion and access. Authenticate the intended hub before trusting replies and test the actual builds; public channels have different exposure. Acknowledgements and AI labels do not establish confidentiality, accuracy or authorization. The proposed [terminal display][plan-design] should use synthetic data. Phone-link loss, hub power, uplink loss, API availability, cost and rate limits are practical dependencies; no battery, background-reliability or field-resilience measurements exist.

## Prior work and commercial route

The [plan's prior-art table][plan-prior] correctly recognizes related work, but its closest-precedent framing is incomplete. The archived [infinigpt-bitchat][infinigpt] describes a BitChat bot with optional local Ollama and private messaging; its current protocol compatibility and operation have not been verified. The [bitchat-gateway][gateway] describes a Bluetooth peer using an internet-connected Nostr AI service; its related [AI packet proposal][gateway-pr] was closed without merging. [Meshtastic-AI-Bridge][meshtastic-ai] describes AI over a radio mesh with additional hardware. These are author descriptions, not independently reproduced field results. The connected gateway is particularly close to the intended hub-to-cloud path. Together they weaken a broad claim that AI-over-mesh or a connected AI gateway is novel. A tested workflow, particular hardware configuration and user benefit may still differentiate the project; no exclusivity or adoption is established.

Older patent publications also describe related relay mechanisms: [EP3605962B1][nagravision] includes device-to-server relaying and buffering, [US10091702B2][qualcomm] addresses forwarding for delay-tolerant messages, and [US20170310553A1][butler] describes multi-modal communications. The EP claims include hotspot-mode requirements; claim 1 of the Qualcomm patent includes an estimated time to network contact. The last is a published application. Current ownership, status and territorial scope are unverified. These examples are not an infringement, patentability or freedom-to-operate opinion; any IP case needs professional, claim-specific analysis.

A prepared volunteer group, event operator or local responder organization is a plausible **discovery** segment, not an established buyer. Ask who operates and powers the hub, who uses the phones, who owns incident data, who can approve procurement, and which budget pays for equipment, setup, training, connectivity, maintenance and support. Compare against stock messaging plus preloaded cards/maps, personal hotspots when available, and established processes. The UK Cabinet Office describes [ResilienceDirect][cabinet-office] as a free service for eligible organizations that requires internet; investigate whether a locally connected phone-to-hub workflow fills a real gap when phones lack internet; the hub still needs a working uplink. Phone access, language support and lower coordination effort are hypotheses to test, alongside failures and added workload.

The newer [blueprint][blueprint-target] and [data catalogue][datasets] propose live bulletins and safe-and-well messages, but list no tested integrations. For any later live feed, show its source, source time, fetch time, applicable licence and staleness; a timestamp alone does not establish accuracy. For outbound messages distinguish local hub receipt, provider acceptance, delivery report and recipient acknowledgement. Do not imply a human received or read a message from an API acceptance. Keep these features out of the core demo unless they work and are explicitly identified as live or simulated.

A small sponsored deployment or service-enabled pilot may be more plausible to investigate than a consumer subscription or patent-licensing strategy, but no customer, demand, purchasing interest or sustainable margin has been demonstrated. A next pilot should have an operating owner, consent and data terms, baseline, success and stop criteria, a power and support plan, integration access, a timeline and a real purchase/conversion decision. Defensibility would need evidence of recurring relationships, maintained integrations or permissioned data that improves outcomes, not merely the presence of a Mistral endpoint.

[reviewed]: https://github.com/yananlong/Mistral-london-20261121/commit/15542b89c49888d61b351b51433b4a82396e0dfb
[pr4]: https://github.com/yananlong/Mistral-london-20261121/pull/4
[readme-status]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/README.md#L27-L29
[readme-flow]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/README.md#L3-L17
[blueprint-mvp]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/BLUEPRINT_1.md#L33-L49
[blueprint-target]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/BLUEPRINT_1.md#L97-L108
[datasets]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/DATASETS.md#L198-L205
[plan-mvp]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/PLAN.md#L1-L15
[blueprint-transport]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/BLUEPRINT_1.md#L25-L31
[blueprint-states]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/BLUEPRINT_1.md#L77-L84
[blueprint-locate]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/BLUEPRINT_1.md#L86-L95
[blueprint-water]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/BLUEPRINT_1.md#L55-L74
[plan-constraints]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/PLAN.md#L34-L39
[plan-design]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/PLAN.md#L65-L75
[plan-prior]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/PLAN.md#L19-L32
[voxtral-setup]: https://github.com/yananlong/Mistral-london-20261121/blob/15542b89c49888d61b351b51433b4a82396e0dfb/SETUP_VOXTRAL.md#L1-L8
[ml4]: https://docs.mistral.ai/models/mistral-large-4-0
[ollama-ml4]: https://ollama.com/library/mistral-large-4
[audio-modes]: https://docs.mistral.ai/studio/audio/concepts/offline-and-realtime
[bitchat-android]: https://github.com/permissionlesstech/bitchat-android
[nearby]: https://developers.google.com/nearby
[multipeer]: https://developer.apple.com/documentation/multipeerconnectivity
[multipeer-migration]: https://developer.apple.com/documentation/technotes/tn3213-moving-from-multipeer-connectivity-to-network-framework
[osm-tiles]: https://operations.osmfoundation.org/policies/tiles/
[cdc-water]: https://www.cdc.gov/water-emergency/about/index.html
[infinigpt]: https://github.com/h1ddenpr0cess20/infinigpt-bitchat
[gateway]: https://github.com/spcpza/bitchat-gateway
[gateway-pr]: https://github.com/permissionlesstech/bitchat/pull/1053
[meshtastic-ai]: https://github.com/dzaczek/Meshtastic-AI-Bridge
[nagravision]: https://patents.google.com/patent/EP3605962B1/en
[qualcomm]: https://patents.google.com/patent/US10091702B2/en
[butler]: https://patents.google.com/patent/US20170310553A1/en
[cabinet-office]: https://www.gov.uk/guidance/resilient-communications
