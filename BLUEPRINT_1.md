This is a strong hackathon concept because it combines an immediate, tangible human-computer interaction (the visible two-device mesh relay) with a practical survival utility layer. However, there is a critical architectural distinction you need to settle early—especially around **Voxtral 3** and **"ALL offline"**—so you do not hit a dead end mid-hackathon.

### 1. Resolving the "All Offline" vs. API Reality

As of its release in October 2026, **Voxtral 3** (including Voxtral Mini TTS 3 and Voxtral Small Transcribe 3) is cloud-hosted via the Mistral API (with self-hosting gated behind enterprise sales). Meanwhile, Mistral's smaller open-weight models (such as **Ministral 3B / 8B** or **Pixtral** for vision) *can* run locally on-device.

To make your project rock-solid for judges, split your architecture into **two clear tiers**:

* **Tier 1: Fully Offline On-Device Survival Kit (Zero Connectivity Required)**
* **Local Small Model + RAG:** Bundle a quantized local model (e.g., Ministral 3B/8B) with a compressed offline vector database covering your 6 survival pillars (first aid protocols, water purification ratios, knot tying, hypothermia triage, and regional foraging/plant toxicity guides).
* **Offline Computer Vision:** Use lightweight on-device vision (or local Pixtral if hardware allows, or a fast local classifier paired with your local LLM) for the **foraging toolkit** (identifying edible vs. toxic plants) and **medical triage** (assessing wound severity or medication labels).
* **Offline Voice / TTS:** Use native OS text-to-speech (`AVSpeechSynthesizer` on iOS / Android `TextToSpeech`) as your guaranteed offline fallback so hands-free emergency instructions work in complete dead zones.


* **Tier 2: Volunteer Mesh Bridge (High-Intelligence Cloud Relay)**
* When a user hits a problem too complex for the local 3B model—or needs to send an outbound SOS/family update—the app routes the payload over Bluetooth to a connected volunteer.
* **This is where Mistral Agents and Voxtral 3 shine:** The volunteer's connected device hits the Mistral API to run a multi-step **Mistral Agent** (e.g., formatting the SOS, checking local disaster advisories, translating into the local rescue language) and uses **Voxtral 3** to transcribe panicky voice notes from the offline user or generate calm, clear spoken audio instructions (`[emotion=calm] [pace=slow]`) that travel back across the mesh.



---

### 2. Technical Blueprint for the Hackathon

#### The Transport Layer (Bitchat vs. Fallback)

* **Bitchat Reality Check:** Bitchat is open-source on both iOS (`permissionlesstech/bitchat`) and Android (`permissionlesstech/bitchat-android`) and uses Bluetooth Low Energy (BLE) mesh with Noise Protocol encryption. Because BLE mesh packets have small MTU (Maximum Transmission Unit) payloads, keep your mesh messages **strictly text/JSON** (coordinates, compressed prompt, and the text response—do not try to send raw audio files or high-res images over BLE mesh).
* **Fastest Hackathon Path:** Define a tiny, clean JSON schema for your relay packet (`request_id`, `lat`, `lon`, `category`, `prompt`, `status`). If integrating Bitchat's codebase takes more than 3–4 hours on Day 1, immediately pivot to **Apple Multipeer Connectivity** (iOS-to-iOS) or **Google Nearby Connections** (Android/cross-platform) as planned, while keeping the exact same JSON state machine (`queued → received by volunteer → processed → returned`).

#### Structuring the 6 Survival Pillars

Instead of an open-ended blank chat box (which induces panic in an emergency), design the home screen as a **6-tile tactical dashboard**:

1. **Communication (Mesh Relay):** One-tap "Draft Family Check-in" or "SOS Relay" that auto-attaches GPS coordinates and battery percentage.
2. **Medical & First Aid:** Step-by-step interactive triage (bleeding, burns, shock) read aloud via TTS so the user's hands stay free.
3. **Water:** Interactive calculators (bleach/iodine drops per litre, boiling times by altitude) + offline map pins for local water sources.
4. **Food & Foraging:** Camera scanner for local flora/fungi with strict safety warnings ("Never ingest unless 100% verified") + calorie/rationing planner.
5. **Energy:** Device power-survival checklist (screen dimming, radio toggles, battery-saving diagnostics) + improvised charging/solar angle tips.
6. **Navigation:** Offline GPS compass, waypoint breadcrumbs (to retrace steps without map tiles), and coordinate sharing.

---

### 3. Winning Demo Script (3 Minutes)

Judges love seeing physical state transitions across two devices rather than slides:

1. **Setup:** Show Phone A visibly in **Airplane Mode with Wi-Fi off and Bluetooth on**.
2. **Offline Survival Action:** Open the **Foraging / Medical** toolkit on Phone A and show it working completely offline (e.g., identifying a plant or reading a hands-free first-aid step).
3. **The Mesh Handoff:** Switch to **Communication**, attach Phone A's live GPS coordinates, and speak/type a request to alert family and ask for nearby shelter guidance.
4. **Live State Progression:** Put Phone A and Phone B (the Volunteer) side-by-side. Watch the UI progress in real time: `Queued` → `Received by Volunteer` (show the approval prompt on Phone B) → `Processed by Mistral Agent & Voxtral 3` → `Returned`.
5. **Final Payoff:** Phone A receives the concise, translated family message draft *and* plays back a calm Voxtral-generated audio summary (or offline TTS fallback) with clear next steps.

Would you like to narrow down the exact tech stack (e.g., iOS/Swift, Android/Kotlin, or React Native/Flutter) so we can map out the BLE mesh payload schema and Mistral Agent system prompt?