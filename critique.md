# Hackathon evidence and commercial critique

Updated **21 November 2026** against [`13ec31a` on the `docs/hub-decisions` branch][reviewed], which records the team decisions in [PR #6][pr6]. Those decisions supersede the offline MVP merged in [PR #1][pr1]. The [repository says the app, the Mac bridge, the hub and the vision model are unbuilt and untested][readme-status]. This is a proposal for a bounded demo and an exploratory evaluation, not evidence of performance, emergency readiness, customer demand or event eligibility. External sources were checked on that date.

## Decision and requirements

The promising demonstration is a fresh, low-risk question travelling from an iPhone through the Mac bridge to the hub and back, with the actual transport, model and connectivity shown. Test the two phones communicating and the hub round trip before investing in a custom app, a relay, or vision. The proposed [Talk, Locate and Ask flow][readme-flow] is a useful direction, but all three integrated capabilities, the native module in the React Native app, the modified Mac bridge and the two-hop demo remain unproved. Present any reduction as a scope change, not the complete MVP.

The [team decisions][blueprint-decisions] specify **2 iPhones, a Mac bridge at the venue, a remote NVIDIA DGX Spark as the hub that serves Ministral 3 14B Instruct through Ollama, and open-weight models only**. The user has also specified **a four-hour build budget and an 18:00 UTC submission on 21 November**. Treat those as team and user constraints; this review has not independently checked the hardware or event rules. The decisions supersede the user's earlier request for an iPhone and an Android phone, a Mac mini with an M6 chip and 32 GB RAM, and Mistral Large 4 (ML4). They [leave open][blueprint-open] the time targets, the timeout, the answer length, the BitChat timebox, the vision accuracy measure, the test questions, the rubric and hub identity verification. Yanan owns the evals, and the evals own the thresholds. Confirm the organizers' actual model, connectivity and submission requirements; a team decision is not proof of an event rule.

### An open-weight model on a connected hub needs its own evidence

The decisions settle the earlier tradeoff between ML4 and all-offline operation. They choose Ministral 3 14B Instruct, an open-weight model, on the team's DGX Spark, which the Mac bridge reaches over the internet in the demo. The phones have no internet, but the system as a whole is not offline. The [blueprint][blueprint-decisions] makes two claims: the model can run on local hardware with no internet, and no question goes to a cloud model API. It also says not to call the demo hub offline. This review has not tested either claim, and no model load, memory use or latency on the DGX Spark has been recorded.

The [Ollama ML4 listing][ollama-ml4] shows `mistral-large-4:cloud`. Running a `:cloud` tag sends the request to a hosted service, so an Ollama log on the hub does not by itself show local inference. Ollama lists Ministral 3 14B Instruct in several local quantizations ([tags][ollama-ministral]). Record the exact tag and quantization that the hub runs, and show that it is not a `:cloud` tag.

| Path | What it preserves | What must be disclosed or decided |
| --- | --- | --- |
| The decided demo, with the Mac bridge reaching the remote DGX Spark over the internet | Open-weight inference with no cloud model API, and phones with no internet. | The Mac bridge needs internet, so the system as a whole is not offline. Say so, and do not call the demo hub offline. Show that no request leaves the hub for a cloud model API. |
| A real deployment, with the hub next to the Mac bridge and no internet | A fully disconnected system, **if** a working configuration is actually demonstrated. | It is not the decided demo. No disconnected run, power plan or latency has been shown. Do not claim it on the basis of open weights alone. |
| A cloud model API, including the Mistral API or an Ollama `:cloud` tag | Nothing that the decisions allow. | It breaks the open-weight claim, and the [blueprint][blueprint-decisions] rules it out. If a fallback uses it, drop the claim and say so. |

If the hub cannot answer and no permitted fallback works, report the failure and submit only what actually works. Do not switch to a cloud model API under the open-weight claim. Hosted Voxtral in [the setup notes][voxtral-setup] likewise needs connectivity for new audio; pre-generated audio is different from live offline synthesis. Mistral's ["offline" audio processing terminology][audio-modes] does not by itself establish disconnected inference.

## What the transport and phone claims need

The [blueprint][blueprint-transport] forks the BitChat iOS app for its Swift mesh code and wraps that code in a native module inside a new React Native app. It keeps Apple Multipeer as the fallback and leaves the BitChat timebox to the evals. Set the timebox well inside the four-hour build budget, or the fallback has no time left to run. None of that proves that the exact installed builds of the app, stock BitChat and the Mac bridge interoperate, route a private message to the Mac bridge, or relay under venue conditions. Record device models, OS and app/build versions; test the actual iPhones and the Mac bridge, permissions, foreground/background behaviour and both directions. Check whether builds and signatures are already available; otherwise include setup in the four-hour budget. Do not assume the plan's [free signing and device limits][plan-constraints] work for the actual accounts and capabilities.

Apple Multipeer is an Apple-platform fallback, not a drop-in BitChat client. Apple's [documentation][multipeer] lists infrastructure Wi-Fi, peer-to-peer Wi-Fi and Ethernet on macOS, **not Bluetooth** as its macOS transport; Apple has [deprecated the framework][multipeer-migration]. If the Mac bridge falls back to Multipeer, the phones must reach it over Wi-Fi. That changes the blueprint's radio configuration of airplane mode with Bluetooth on, so show that the phones still have no internet. The fallback proves neither BitChat compatibility nor multi-hop routing, and the blueprint notes that Multipeer has no multi-hop relay.

Use these claims only after the corresponding observation:

| Claim | Minimum observation |
| --- | --- |
| **Phone-to-phone offline message** | Both phones have cellular and internet access disabled; a fresh message arrives in each direction on the named app and transport. A local Wi-Fi network is allowed only if disclosed. |
| **Phone-to-hub round trip** | A fresh, identifiable request reaches the Mac bridge, the hub generates the answer, and that answer returns to each tested phone. Record whether the path is direct, which part, if any, is manual, and the matching run in the Ollama log on the hub. |
| **Relay through phone B** | Show A cannot reach the Mac bridge directly, then use route/hop evidence or a controlled B-off/B-on test with fresh IDs, the same placement and no other relay. Radio range is variable; proximity alone is not route evidence. If isolation is inconclusive, call it a direct or unverified-path demo. |
| **Offline phones, connected hub** | Show cellular off and actual Wi-Fi/Bluetooth settings on both iPhones. Airplane mode alone is insufficient because radios can be re-enabled. Show the local path from each phone to the Mac bridge, and the Mac bridge's real request to the hub and its return. Say explicitly that the Mac bridge has internet and the system is not all-offline. |
| **No cloud model API** | Show the exact local model tag on the hub and the matching Ollama log entry for each fresh request. Record or block the hub's outbound connections during each run, and show none to a cloud model API. A log entry alone is corroborating evidence, not proof by itself. |
| **No internet anywhere** | The decided demo does not show this, so do not claim it there. A later claim needs the hub next to the Mac bridge, with all uplinks on both, including Ethernet, tethering or other adapters, disconnected or blocked. Verify the chosen local path and fresh inference during isolation; a failed external connection is corroborating evidence, not proof by itself. The hub needs power. |

A receipt means the Mac bridge received that request, not that the hub received it, that the answer is correct or that a human responder received it. The **Received by hub** state marks the first reply from the Mac bridge, which it sends before it forwards the question to the hub. The [blueprint's deferred timeout][blueprint-states] only establishes that an acknowledgement did not arrive in time. It cannot distinguish an unreachable Mac bridge, a lost reply, slow processing or a late message. If implementing the states, use request IDs, correlate acknowledgement and answer, handle duplicate retries and late replies, and label the first timeout **"No acknowledgement yet"**. After an acknowledgement, start a separate answer deadline based on measured response times; if it expires, show **"Acknowledged; answer delayed or unavailable"** without claiming to know whether the link to the hub, processing or delivery failed. Accept a late answer only for the matching request. Plain-text stock BitChat can carry a visible ID, but compatibility and parsing must be tested. Never present queued, sent, received and answered as the same event.

## Four-hour build and decision gates

The example below runs **14:00–18:00 UTC** and assumes team members can work in parallel. Include any outstanding downloads or setup in the budget and cut scope if they overrun. It is a wall-clock budget, not four hours per person. If starting later, preserve the submission buffer, shorten or drop scope and move the gates earlier; do not let work run past 18:00.

| UTC | Work and exit condition | If the gate fails |
| --- | --- | --- |
| 14:00 to 14:20 | Assign one owner for each of transport and submission, since Martin owns the hub. Check rules, phone builds/signing, power, the Mac bridge's link to the hub and the model on the hub. Agree what the demo shows if the Mac bridge cannot reach the hub. | Record unknown rules; prepare an honest component demo. Do not assume a waiver. |
| 14:20 to 14:50 | In parallel, test stock BitChat messages between the two iPhones without internet, and run a fresh prompt from the Mac bridge to Ollama on the hub. Log the exact model tag and timing. | Stop treating BitChat between the iPhones or the link to the hub as established. Choose a permitted, explicitly labelled fallback. A cloud model API is not a permitted fallback. |
| 14:50 to 15:35 | Attempt the smallest Mac bridge: one phone sends a private request, the Mac bridge forwards it to Ollama on the hub and returns a correlated answer. Test the second phone if the first works. | Stop the integration attempt at 15:35. Demonstrate working components separately; if agreed, a local Wi-Fi page or manual QR handoff may show a different path, with its required radios, hardware and manual steps stated. |
| 15:35–16:10 | Stabilize the round trip. Test both a missing acknowledgement and an interruption after acknowledgement but before the answer, then test retry and recovery. Reproduce the connectivity configuration with fresh input. | Drop a custom Ask screen and unproved relay claims. Show the failure or separate components, not a simulated success. |
| 16:10–16:40 | Only after the core works, test a preloaded offline map and a location share on the actual phones. A separate owner can examine one bounded vision case. | Defer map integration or vision and label each as planned/partial. Do not make the full three-capability claim. |
| 16:40–17:15 | Run the small comparison below, log every attempt and one deliberate interruption. | Keep failures in the result table; narrow the claim to what was observed. |
| 17:15–17:40 | Rehearse the three-minute demo and capture configuration, evidence and failures. Freeze feature work. | Use the best honest component demo and recorded evidence. |
| 17:40–18:00 | Finish and submit the required materials; reserve time for upload or submission failure. | Submit the actual result by the deadline, with limitations. |

Preload the hub's model, the vision model, phone apps, map data and dependencies while internet is available; a successful download does not count as an offline run. The [map and vision plan][blueprint-locate] names London as the map region. It still needs an offline-permitting tile source and a test case where the camera improves a decision over a map, position and compass alone. The OpenStreetMap Foundation's [standard tile policy][osm-tiles] prohibits bulk prefetch/offline download from `tile.openstreetmap.org`; use a source that permits it or self-hosted data with attribution. Position and heading may be unavailable, stale or inaccurate; show their age/accuracy and a no-fix state. For any vision test, compare its bearing with a compass-only baseline and an independently checked direction in the same scene; record no-fix cases. Vision matching remains untested. Reading a sign alone does not establish better orientation.

## Bounded demo and evidence

Use a fictional event meeting-point card with a few prewritten facts, not a real emergency or live location. Show connectivity and model settings, send a fresh judge-chosen question containing the supplied facts, and display the correlated answer. Test one interruption before acknowledgement and another after acknowledgement but before the answer, for example by stopping inference after the receipt; record each distinct timeout, retry and recovery. Show the observed interruption behaviour in the demo. If possible, show each phone completing a round trip; if only one succeeds, say which. A map, vision feature or multi-hop relay is a separate beat only if its gate passed. This is a feasibility demonstration, not proof of rescue capability.

Compare the model-assisted task with an offline human relay: using the same link and fictional card, a person at the Mac bridge composes a checklist and sends it back to the originating phone. Give the model the same card text, let both paths request clarification and measure the same endpoint. Preselect about five cases, including a straightforward card lookup, an ambiguous instruction, missing information, a paraphrase and a link interruption. Vary order when possible. An ordinary card may be faster or more accurate; the comparison is meaningful only if it can win. If the model branch does not complete, report that rather than comparing a simulated answer to a real baseline.

For **every attempt**, record the scenario and trial order; device/OS/app versions; model ID, quantization, inference host and path; radio/uplink settings; transport and claimed hop evidence; send, hub receipt, answer and final receipt times; initial and eventual completion counts and denominator; retries, timeouts and dropped/late/duplicate messages; omissions or altered critical facts; and a blinded-to-condition human check where practical. Include setup time or report it separately consistently. Keep raw results and distinguish a recorded demonstration from a proposed test. Team-run trials are exploratory; five cases cannot establish safety, reliability, statistical advantage or willingness to pay. A realistic template is:

| Configuration / case | Attempts | Initial / eventual completions | Elapsed time including retries | Critical errors / missing facts | Failure and recovery |
| --- | --- | --- | --- | --- | --- |
| Model-assisted | Not yet run | — | — | — | — |
| Card + manual relay | Not yet run | — | — | — | — |

## Safety, privacy and operational limits

The [blueprint's example][blueprint-water] gives water-treatment steps followed by a disclaimer. A disclaimer does not repair incomplete advice: [CDC guidance][cdc-water] distinguishes microbial contamination from fuel, toxic chemicals and radioactive material, for which boiling is not a remedy. For the hackathon, avoid open-ended medical, water, food/foraging, shelter or evacuation advice and use the fictional low-stakes card. Do not claim safety or current disaster knowledge. Any later real-world use needs qualified review, source provenance, versioning, coverage and updates, refusal/escalation behaviour, and evaluation of harmful omissions; retrieval alone is not validation.

Location and message content can reveal sensitive information. Default location sharing off, request explicit consent for each share and destination, and use fictional coordinates in demos. Private-message encryption is not a complete privacy guarantee. The Mac bridge and the hub necessarily see the question, and in the demo it crosses the internet between them. Their operators and local logs may retain it, and public channels have different exposure. Avoid logging content or coordinates by default, define retention/deletion and access, authenticate the Mac bridge and the hub before trusting replies, and test the actual builds. Acknowledgements and AI labels do not establish confidentiality, accuracy or authorization. The [Ollama log on the hub][plan-design], which the demo shows on stage, should show synthetic data only. Connectivity loss, limited range, phone battery, the Mac bridge's link to the hub and hub power are practical dependencies; no battery, background-reliability or field-resilience measurements exist.

## Prior work and commercial route

The [plan's prior-art table][plan-prior] correctly recognizes related work, but its closest-precedent framing is incomplete. The archived [infinigpt-bitchat][infinigpt] describes a BitChat bot with optional local Ollama and private messaging; its current protocol compatibility and operation with all internet disconnected have not been verified. The [bitchat-gateway][gateway] describes a Bluetooth peer using an internet-connected Nostr AI service; its related [AI packet proposal][gateway-pr] was closed without merging. [Meshtastic-AI-Bridge][meshtastic-ai] describes AI over a radio mesh with additional hardware. These are author descriptions, not independently reproduced field results. Together they weaken a broad claim that a shared local AI or AI-over-mesh architecture is novel. A tested workflow, particular hardware configuration and user benefit may still differentiate the project; no exclusivity or adoption is established.

Older patent publications also describe related relay mechanisms: [EP3605962B1][nagravision] includes device-to-server relaying and buffering, [US10091702B2][qualcomm] addresses forwarding for delay-tolerant messages, and [US20170310553A1][butler] describes multi-modal communications. The EP claims include hotspot-mode requirements; claim 1 of the Qualcomm patent includes an estimated time to network contact. The last is a published application. Current ownership, status and territorial scope are unverified. These examples are not an infringement, patentability or freedom-to-operate opinion; any IP case needs professional, claim-specific analysis.

A prepared volunteer group, event operator or local responder organization is a plausible **discovery** segment, not an established buyer. Ask who operates and powers the hub, who uses the phones, who owns incident data, who can approve procurement, and which budget pays for equipment, setup, training, connectivity, maintenance and support. Compare against stock messaging plus preloaded cards/maps, personal hotspots when available, and established processes. The UK Cabinet Office describes [ResilienceDirect][cabinet-office] as a free service for eligible organizations that requires internet; investigate where an offline workflow would fill a real gap rather than assuming direct substitution. Phone access, language support and lower coordination effort are hypotheses to test, alongside failures and added workload.

A small sponsored deployment or service-enabled pilot may be more plausible to investigate than a consumer subscription or patent-licensing strategy, but no customer, demand, purchasing interest or sustainable margin has been demonstrated. A next pilot should have an operating owner, consent and data terms, baseline, success and stop criteria, a power and support plan, integration access, a timeline and a real purchase/conversion decision. Defensibility would need evidence of recurring relationships, maintained integrations or permissioned data that improves outcomes, not merely the presence of a Mistral endpoint.

[reviewed]: https://github.com/yananlong/Mistral-london-20261121/commit/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e
[pr1]: https://github.com/yananlong/Mistral-london-20261121/pull/1
[pr6]: https://github.com/yananlong/Mistral-london-20261121/pull/6
[readme-status]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/README.md#L27-L29
[readme-flow]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/README.md#L3-L11
[blueprint-decisions]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/BLUEPRINT_1.md#L163-L175
[blueprint-open]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/BLUEPRINT_1.md#L186-L197
[blueprint-transport]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/BLUEPRINT_1.md#L26-L33
[blueprint-states]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/BLUEPRINT_1.md#L81-L90
[blueprint-locate]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/BLUEPRINT_1.md#L92-L101
[blueprint-water]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/BLUEPRINT_1.md#L59-L79
[plan-constraints]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/PLAN.md#L34-L39
[plan-design]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/PLAN.md#L65-L75
[plan-prior]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/PLAN.md#L19-L32
[voxtral-setup]: https://github.com/yananlong/Mistral-london-20261121/blob/13ec31a98e6fa6939dfabbf4dbc0e4e6a63af05e/SETUP_VOXTRAL.md#L1-L9
[ollama-ml4]: https://ollama.com/library/mistral-large-4
[ollama-ministral]: https://ollama.com/library/ministral-3/tags
[audio-modes]: https://docs.mistral.ai/studio/audio/concepts/offline-and-realtime
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
