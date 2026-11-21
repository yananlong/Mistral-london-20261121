# Hackathon evidence and commercial critique

Reviewed **21 November 2026** against [main at `9392c5d`][reviewed], including the offline MVP merged in [PR #1][pr1] and the Voxtral/submodule follow-up in PR #2. The [repository says the app, hub and vision model are unbuilt and untested][readme-status]. This is a proposal for a bounded demo and an exploratory evaluation, not evidence of performance, emergency readiness, customer demand or event eligibility. External sources were checked on the review date.

## Decision and requirements

The promising demonstration is a fresh, low-risk question travelling from an iPhone or Android phone to a powered Mac mini and back, with the actual transport, model and connectivity shown. Test the two phones communicating and the hub round trip before investing in a custom app, a relay, or vision. The proposed [Talk, Locate and Ask flow][readme-flow] is a useful direction, but all three integrated capabilities, cross-platform support, the modified hub and the two-hop demo remain unproved. Present any reduction as a scope change, not the complete MVP.

The user has specified **an iPhone and an Android phone, a Mac mini with M6 chip and 32 GB RAM, Mistral Large 4 (ML4), a four-hour build budget and an 18:00 UTC submission on 21 November**. Treat those as user-provided constraints; this review has not independently checked the hardware or event rules. The [blueprint][blueprint-open] still asks which phones and Mac are available and proposes smaller Mistral models. It does not settle how to satisfy the requested ML4 model. Confirm the organizers' actual model, connectivity and submission requirements; a user request is not proof of an event rule.

### ML4 and offline inference are an unresolved decision

[Mistral's model card][ml4] identifies ML4 as a 1.05 trillion total-parameter mixture-of-experts model with 52 billion active parameters; the [weights have been released][ml4-weights]. Active parameters per token are not the total weights that need to be available to an inference system. As a scale illustration, storing all 1.05 trillion parameters at exactly four bits each would take about **525 GB** before metadata and other components; actual quantization, storage and runtime requirements differ. That is a storage calculation, not a claim that the whole model must sit in RAM at once or that disk offloading is mathematically impossible. It gives no basis to expect an interactive local ML4 run on the stated 32 GB machine within four hours. No such configuration or latency has been tested here.

The [Ollama ML4 listing][ollama-ml4] currently shows `mistral-large-4:cloud`; running that tag is a hosted service, not evidence that ML4 runs on the Mac. For a local feasibility experiment, Ollama lists `ministral-3:3b-instruct-2512-q4_K_M` as a **3.0 GB model download** ([tags][ollama-ministral]); download size is not peak RAM or a latency guarantee. It is a different model and does **not** satisfy the stated ML4 request.

| Path | What it preserves | What must be disclosed or decided |
| --- | --- | --- |
| ML4 via a hosted endpoint | The requested model, if the actual endpoint and model ID are confirmed. | The hub or another gateway needs internet. Phones can be disconnected from the internet while the system as a whole is not. Obtain the decision to change the all-offline proposal, and verify whether event rules allow it. |
| A smaller local Mistral model | A candidate for a fully disconnected system, after testing. | It is not ML4. Obtain the decision to change the model requirement, and verify whether event rules allow it. |
| Local ML4 on the supplied Mac | Both stated goals, **if** a working configuration is actually demonstrated. | No viable configuration, model load, memory use or acceptable latency has been shown. Do not promise it on the basis of MoE or a `:cloud` command. |

If neither deviation is acceptable and local ML4 cannot be demonstrated, report the conflict and submit only what actually works; do not imply both requirements were met. No preference between ML4 and all-offline operation has been established. Hosted Voxtral in [the setup notes][voxtral-setup] likewise needs connectivity for new audio; pre-generated audio is different from live offline synthesis. Mistral's [“offline” audio processing terminology][audio-modes] does not by itself establish disconnected inference.

## What the transport and phone claims need

The [blueprint][blueprint-transport] describes an iOS fork and offers a four-hour BitChat timebox before switching to Apple Multipeer. That timebox consumes the entire build budget; the fork does not add the proposed screens to the Android phone. [BitChat for Android][bitchat-android] claims protocol compatibility with iOS/macOS and BLE multi-hop, while also describing Wi-Fi Aware and internet-based Nostr paths. Those are project claims, not proof that the exact installed versions interoperate, route a private message to the Mac, or relay under venue conditions. Record device models, OS and app/build versions; test the actual iPhone, Android and Mac, permissions, foreground/background behaviour and both directions. Check whether builds and signatures are already available; otherwise include setup in the four-hour budget. Do not assume the plan's [free signing and device limits][plan-constraints] work for the actual accounts and capabilities.

The plan's claim that [Nearby requires the same OS][plan-constraints] is too broad: [Google documents Nearby Connections between Android and iOS][nearby], although this project has not tested it or established a compatible Mac hub. Apple Multipeer is an Apple-platform fallback, not a drop-in BitChat or Android client. Apple's [documentation][multipeer] lists infrastructure Wi-Fi, peer-to-peer Wi-Fi and Ethernet on macOS, **not Bluetooth** as its macOS transport; Apple has [deprecated the framework][multipeer-migration]. A Mac with Wi-Fi off and Ethernet unplugged therefore has no documented Multipeer transport in that configuration. A local Wi-Fi connection with no internet can still be offline, but it changes the blueprint's radio configuration. Neither fallback proves BitChat compatibility or multi-hop routing.

Use these claims only after the corresponding observation:

| Claim | Minimum observation |
| --- | --- |
| **Phone-to-phone offline message** | Both phones have cellular and internet access disabled; a fresh message arrives in each direction on the named app and transport. A local Wi-Fi network is allowed only if disclosed. |
| **Phone-to-hub round trip** | A fresh, identifiable request reaches the Mac and its corresponding generated answer returns to each tested phone. Record whether the path is direct and which part, if any, is manual. |
| **Relay through phone B** | Show A cannot reach the hub directly, then use route/hop evidence or a controlled B-off/B-on test with fresh IDs, the same placement and no other relay. Radio range is variable; proximity alone is not route evidence. If isolation is inconclusive, call it a direct or unverified-path demo. |
| **No internet anywhere** | Show cellular off and actual Wi-Fi/Bluetooth settings on both phones; show all Mac uplinks, including Ethernet, tethering or other adapters, disconnected or blocked. Verify the chosen local path and fresh inference during isolation; a failed external connection is corroborating evidence, not proof by itself. Airplane mode alone is insufficient because radios can be re-enabled. The hub needs power. |
| **Cloud ML4 through an offline phone** | Show the phone-to-gateway local path and the gateway's real hosted ML4 request and return. Say explicitly that the gateway has internet and the system is not all-offline. |

A receipt means the hub received that request, not that the answer is correct or a human responder received it. The [proposed 30-second timeout][blueprint-states] only establishes that an acknowledgement did not arrive in time: it cannot distinguish an unreachable hub, a lost reply, slow processing or a late message. If implementing the states, use request IDs, correlate acknowledgement and answer, handle duplicate retries and late replies, and label the timeout **“No acknowledgement yet”**. Plain-text stock BitChat can carry a visible ID, but compatibility and parsing must be tested. Never present queued, sent, received and answered as the same event.

## Four-hour build and decision gates

The example below runs **14:00–18:00 UTC** and assumes team members can work in parallel. Include any outstanding downloads or setup in the budget and cut scope if they overrun. It is a wall-clock budget, not four hours per person. If starting later, preserve the submission buffer, shorten or drop scope and move the gates earlier; do not let work run past 18:00.

| UTC | Work and exit condition | If the gate fails |
| --- | --- | --- |
| 14:00–14:20 | Assign one owner for each of transport, inference and submission; check rules, phone builds/signing, power and model artifacts. Agree which requirement can change if ML4 cannot run locally. | Record unknown rules and the unresolved tradeoff; prepare an honest component demo. Do not assume a waiver. |
| 14:20–14:50 | In parallel, test stock iPhone↔Android messages without internet and run a fresh model prompt with the selected inference path. Log exact model and timing. | Stop treating cross-platform BitChat or local ML4 as established. Choose a permitted, explicitly labelled fallback only after the requirement decision. |
| 14:50–15:35 | Attempt the smallest hub bridge: one phone sends a private request, the Mac processes it and returns a correlated answer. Test the second phone if the first works. | Stop the integration attempt at 15:35. Demonstrate working components separately; if agreed, a local Wi-Fi page or manual QR handoff may show a different path, with its required radios, hardware and manual steps stated. |
| 15:35–16:10 | Stabilize the demonstrated round trip; test a timeout and retry. Reproduce the selected connectivity configuration with fresh input. | Drop a custom Ask screen and unproved relay claims. Show the failure or separate components, not a simulated success. |
| 16:10–16:40 | Only after the core works, test a preloaded offline map and a location share on the actual phones. A separate owner can examine one bounded vision case. | Defer map integration or vision and label each as planned/partial. Do not make the full three-capability claim. |
| 16:40–17:15 | Run the small comparison below, log every attempt and one deliberate interruption. | Keep failures in the result table; narrow the claim to what was observed. |
| 17:15–17:40 | Rehearse the three-minute demo and capture configuration, evidence and failures. Freeze feature work. | Use the best honest component demo and recorded evidence. |
| 17:40–18:00 | Finish and submit the required materials; reserve time for upload or submission failure. | Submit the actual result by the deadline, with limitations. |

Preload the chosen model, phone apps, map data and dependencies while internet is available; a successful download does not count as an offline run. The [map and vision plan][blueprint-locate] needs a named map region, an offline-permitting tile source and a test case where the camera improves a decision over a map, position and compass alone. The OpenStreetMap Foundation's [standard tile policy][osm-tiles] prohibits bulk prefetch/offline download from `tile.openstreetmap.org`; use a source that permits it or self-hosted data with attribution. Position and heading may be unavailable, stale or inaccurate; show their age/accuracy and a no-fix state. For any vision test, compare its bearing with a compass-only baseline and an independently checked direction in the same scene; record no-fix cases. Vision matching remains untested. Reading a sign alone does not establish better orientation.

## Bounded demo and evidence

Use a fictional event meeting-point card with a few prewritten facts, not a real emergency or live location. Show connectivity and model settings, send a fresh judge-chosen question containing the supplied facts, display the correlated answer, and interrupt the chosen link or hub to show the actual timeout/retry. If possible, show each phone completing a round trip; if only one succeeds, say which. A map, vision feature or multi-hop relay is a separate beat only if its gate passed. This is a feasibility demonstration, not proof of rescue capability.

Compare the model-assisted task with an offline human relay: using the same link and fictional card, a person at the Mac composes a checklist and sends it back to the originating phone. Give the model the same card text, let both paths request clarification and measure the same endpoint. Preselect about five cases, including a straightforward card lookup, an ambiguous instruction, missing information, a paraphrase and a link interruption. Vary order when possible. An ordinary card may be faster or more accurate; the comparison is meaningful only if it can win. If the model branch does not complete, report that rather than comparing a simulated answer to a real baseline.

For **every attempt**, record the scenario and trial order; device/OS/app versions; model ID, quantization, inference host and path; radio/uplink settings; transport and claimed hop evidence; send, hub receipt, answer and final receipt times; initial and eventual completion counts and denominator; retries, timeouts and dropped/late/duplicate messages; omissions or altered critical facts; and a blinded-to-condition human check where practical. Include setup time or report it separately consistently. Keep raw results and distinguish a recorded demonstration from a proposed test. Team-run trials are exploratory; five cases cannot establish safety, reliability, statistical advantage or willingness to pay. A realistic template is:

| Configuration / case | Attempts | Initial / eventual completions | Elapsed time including retries | Critical errors / missing facts | Failure and recovery |
| --- | --- | --- | --- | --- | --- |
| Model-assisted | Not yet run | — | — | — | — |
| Card + manual relay | Not yet run | — | — | — | — |

## Safety, privacy and operational limits

The [blueprint's example][blueprint-water] gives water-treatment steps followed by a disclaimer. A disclaimer does not repair incomplete advice: [CDC guidance][cdc-water] distinguishes microbial contamination from fuel, toxic chemicals and radioactive material, for which boiling is not a remedy. For the hackathon, avoid open-ended medical, water, food/foraging, shelter or evacuation advice and use the fictional low-stakes card. Do not claim safety or current disaster knowledge. Any later real-world use needs qualified review, source provenance, versioning, coverage and updates, refusal/escalation behaviour, and evaluation of harmful omissions; retrieval alone is not validation.

Location and message content can reveal sensitive information. Default location sharing off, request explicit consent for each share and destination, and use fictional coordinates in demos. Private-message encryption is not a complete privacy guarantee: the hub necessarily sees the question, its operator and local logs may retain it, and public channels have different exposure. Avoid logging content or coordinates by default, define retention/deletion and access, authenticate the intended hub before trusting replies, and test the actual builds. Acknowledgements and AI labels do not establish confidentiality, accuracy or authorization. The proposed [terminal display][plan-design] should use synthetic data. Connectivity loss, limited range, phone battery and hub power are practical dependencies; no battery, background-reliability or field-resilience measurements exist.

## Prior work and commercial route

The [plan's prior-art table][plan-prior] correctly recognizes related work, but its closest-precedent framing is incomplete. The archived [infinigpt-bitchat][infinigpt] describes a BitChat bot with optional local Ollama and private messaging; its current protocol compatibility and operation with all internet disconnected have not been verified. The [bitchat-gateway][gateway] describes a Bluetooth peer using an internet-connected Nostr AI service; its related [AI packet proposal][gateway-pr] was closed without merging. [Meshtastic-AI-Bridge][meshtastic-ai] describes AI over a radio mesh with additional hardware. These are author descriptions, not independently reproduced field results. Together they weaken a broad claim that a shared local AI or AI-over-mesh architecture is novel. A tested workflow, particular hardware configuration and user benefit may still differentiate the project; no exclusivity or adoption is established.

Older patent publications also describe related relay mechanisms: [EP3605962B1][nagravision] includes device-to-server relaying and buffering, [US10091702B2][qualcomm] addresses forwarding for delay-tolerant messages, and [US20170310553A1][butler] describes multi-modal communications. The EP claims include hotspot-mode requirements; claim 1 of the Qualcomm patent includes an estimated time to network contact. The last is a published application. Current ownership, status and territorial scope are unverified. These examples are not an infringement, patentability or freedom-to-operate opinion; any IP case needs professional, claim-specific analysis.

A prepared volunteer group, event operator or local responder organization is a plausible **discovery** segment, not an established buyer. Ask who operates and powers the hub, who uses the phones, who owns incident data, who can approve procurement, and which budget pays for equipment, setup, training, connectivity, maintenance and support. Compare against stock messaging plus preloaded cards/maps, personal hotspots when available, and established processes. The UK Cabinet Office describes [ResilienceDirect][cabinet-office] as a free service for eligible organizations that requires internet; investigate where an offline workflow would fill a real gap rather than assuming direct substitution. Phone access, language support and lower coordination effort are hypotheses to test, alongside failures and added workload.

A small sponsored deployment or service-enabled pilot may be more plausible to investigate than a consumer subscription or patent-licensing strategy, but no customer, demand, purchasing interest or sustainable margin has been demonstrated. A next pilot should have an operating owner, consent and data terms, baseline, success and stop criteria, a power and support plan, integration access, a timeline and a real purchase/conversion decision. Defensibility would need evidence of recurring relationships, maintained integrations or permissioned data that improves outcomes, not merely the presence of a Mistral endpoint.

[reviewed]: https://github.com/yananlong/Mistral-london-20261121/commit/9392c5d3c787706168b0b5ab1f132a1dab614f3b
[pr1]: https://github.com/yananlong/Mistral-london-20261121/pull/1
[readme-status]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/README.md#L25-L27
[readme-flow]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/README.md#L3-L11
[blueprint-open]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/BLUEPRINT_1.md#L139-L149
[blueprint-transport]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/BLUEPRINT_1.md#L23-L29
[blueprint-states]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/BLUEPRINT_1.md#L75-L82
[blueprint-locate]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/BLUEPRINT_1.md#L84-L93
[blueprint-water]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/BLUEPRINT_1.md#L53-L72
[plan-constraints]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/PLAN.md#L34-L39
[plan-design]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/PLAN.md#L65-L75
[plan-prior]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/PLAN.md#L19-L32
[voxtral-setup]: https://github.com/yananlong/Mistral-london-20261121/blob/9392c5d3c787706168b0b5ab1f132a1dab614f3b/SETUP_VOXTRAL.md#L1-L8
[ml4]: https://docs.mistral.ai/models/mistral-large-4-0
[ml4-weights]: https://mistral.ai/news/mistral-large-4-oss/
[ollama-ml4]: https://ollama.com/library/mistral-large-4
[ollama-ministral]: https://ollama.com/library/ministral-3/tags
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
