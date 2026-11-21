# Team plan (open draft)

An open plan for the team. Edit freely. [The blueprint's decisions](BLUEPRINT_1.md#decisions) list what the team has agreed, and the rest of this plan stays open until the team agrees. [README.md](README.md) has the concept, and [BLUEPRINT_1.md](BLUEPRINT_1.md) has the MVP architecture and build order.

The MVP gives people three capabilities while their phones have no internet. They can talk over the BitChat mesh, locate themselves on an offline map with an on-device vision model, and ask Ministral 3 14B Instruct on the hub over the mesh. The hub is the team's DGX Spark, running offline.

---

## 1. Sharpening the concept

Mesh messaging apps and off-grid AI projects already exist. Our difference is one open-weight Mistral model on the hub, shared by everyone in mesh range, while the phones have no internet. The model can run on local hardware with no internet, and no question goes to a cloud model API. The phones spend no battery on inference, and the hub can run a larger model and hold a library of survival guides. The same phones message each other and find their position on an offline map.

- **No internet on the phones.** Both phones (an iPhone and a Pixel 9a) are in airplane mode, and they reach the offline hub only over the BitChat mesh. The demo shows airplane mode at the start, and the Ollama log on the hub shows each run.
- **Works with stock BitChat.** The hub answers plain-text private messages, so a person with the stock BitChat app can ask it questions. Our app adds the map, the vision model and a better Ask screen.
- **Trust is the product.** The person chooses whether to share their location, and every answer is labelled as AI-generated and not verified emergency advice.
- **Templates, not chat.** The Ask screen offers suggested questions, for example "How do I make water safe to drink?" or "How do I stop heavy bleeding?". Short questions and answers suit a slow link and stressed people.
- **Built for bad conditions.** Big tap targets, high contrast in sunlight, scalable text, low battery use.

## 2. Prior art: does this already exist?

Parts of it do. The closest precedent, [bitchat-gateway](https://github.com/spcpza/bitchat-gateway), uses the same pattern of a BitChat peer that answers questions, but it sends them to an AI service on the internet. [critique.md](critique.md) covers it and other precedents in more detail.

| Project | Link | Where the AI runs | Hardware | What we learn |
|---|---|---|---|---|
| BitChat | Bluetooth mesh + Nostr | No AI | Phones | The mesh we build on. It has no bot API, so the hub needs a modified BitChat build. Community ports haven't been audited. |
| bitchat-gateway | BitChat mesh | Internet AI, reached through a connected peer | Phones and a connected computer | The same peer pattern as our hub, but it sends questions to a cloud AI service. |
| Radio LLM | Meshtastic LoRa radio | A server at the other end of the radio link | LoRa radios | AI over a mesh works, but you need dedicated radios. |
| net0 | ESP32 relay nodes | Gemini dispatch dashboard | Custom nodes | Saves reports locally first, so they aren't lost if the AI can't be reached. |
| Meshnet | Bluetooth mesh | A web server summarises mesh traffic | Phones | The AI only reads the traffic; it doesn't reply to people. |
| Flood Ready | QR codes between devices | On-device, in the browser | Phones | QR relay is a real, fully offline fallback. |
| Bridgefy / Briar | Bluetooth / Wi-Fi mesh | No AI | Phones | Audits found security flaws in Bridgefy, so trust has to be designed in. |
| **Us** | BitChat mesh | Ministral 3 14B Instruct on the hub, an offline DGX Spark that is a BitChat peer | iPhones, Android phones and a DGX Spark | No internet on the phones, no cloud model API, and stock BitChat users can ask the hub too. |

## 3. Hard constraints

- **A web app can't send messages phone to phone over Bluetooth.** Web Bluetooth only connects to accessories, runs only in Chromium and doesn't work on iOS. A real offline link needs a native app, a local Wi-Fi network or QR codes.
- **Native offline links don't work across platforms.** Apple's Multipeer and Google's Nearby can't talk to each other, so a fallback on either one needs demo phones on the same OS. QR codes work across both. The app runs on iPhone and Android, so neither Multipeer nor Nearby works as a fallback across the demo phones; we assume BitChat works.
- **The hub stays in one place and needs power.** Phones reach it only within Bluetooth range, either directly or through other phones on the mesh.
- **No one needs to pay.** A free Apple ID can install the app onto our own iPhones from Xcode (it re-signs every 7 days, about 3 devices). Only TestFlight needs the $99 account, and we don't need it. Android needs no account: install the APK with `adb install`.

## 4. Stack

The team chose the stack on 2026-11-21, and [the blueprint's decisions](BLUEPRINT_1.md#decisions) record it. The UI sits on one small `Transport` interface (send, receive, peers) that the native module exposes, so how messages move can change without redoing the design.

| Part | Choice | Notes |
|---|---|---|
| Front end | A new React Native app | iPhone and Android. It holds the Talk, Locate and Ask screens. |
| Mesh | A native module that wraps the Swift mesh code from the team's BitChat fork | The native build needs a Mac with Xcode. Multipeer is the fallback. |
| Hub | One node: the DGX Spark running Ministral 3 14B Instruct 2512 in Ollama, as a BitChat peer | Offline. Open-weight models only. No question goes to a cloud model API. For the demo, a Mac with Xcode builds the BitChat peer and talks to the Spark over a local link. |
| Vision | A small model on the iPhone, ideally a multimodal Mistral model | Proposed: Ministral 3 3B Instruct 2512 with vision, on-device via llama.cpp. Pending Martin's review. [The blueprint's decisions](BLUEPRINT_1.md#decisions) have the proposal. |

## 5. How does the message move?

This section covers messages between phones and questions from phones to the hub. The team chose the BitChat mesh for both, and Multipeer is the fallback.

| Option | Truly offline? | Effort | Demo risk | Notes |
|---|---|---|---|---|
| Simulated link | No | Very low | None | Enough to design every screen and state. |
| QR codes | Yes | Low | Low | Works on any phone and across iOS and Android. Each handoff is a visible gesture. The hub needs a webcam to read codes. |
| Local Wi-Fi and server | Yes (network with no internet) | Medium | Medium | The hub serves answers over a Wi-Fi router that gives the phones no internet. Phones must be in range of the router. It doesn't carry messages between phones. |
| Multipeer or Nearby | Yes | Medium | Medium | Native only, and both phones need the same OS. Multipeer also runs on macOS, but it has no multi-hop relay. |
| BitChat | Yes (multi-hop mesh) | High | High | Chosen. One mesh carries Talk and Ask, and stock BitChat users can join. The hub needs a modified BitChat build. If BitChat fails within a fixed timebox, switch to Multipeer. The implementation team sets the timebox while building. |

## 6. Design workstream

The phone has three flows:

- **Talk.** Open the app and see who is nearby. Message one person or the public channel.
- **Locate.** Open the map and see your position. Use the camera to orient yourself, and share your location if you choose.
- **Ask.** Pick a suggested question or type one, and choose whether to attach your location. Send it, watch the status and read the answer.

The hub has no user interface. For the demo, the Ollama log on the hub shows each model run.

Design these states: no one nearby, hub not reachable, answer still coming, no position fix yet, map not downloaded for this area, location permission denied, and camera permission denied. [The blueprint's state table](BLUEPRINT_1.md#message-format) lists the Ask states.

Other deliverables:
- Ask status component: one shared component that every question uses, and the part of the demo that the audience watches.
- Map styles for the position marker and for shared location pins.
- Tokens: colour, type, spacing and radius, with a calm palette rather than an alarming one.
- Copy: plain language, the AI answer label, the disclaimer.
- Tool: Figma or straight in code (to decide).

The demo script is in [the blueprint](BLUEPRINT_1.md#demo-script).

## 7. Build order

[BLUEPRINT_1.md](BLUEPRINT_1.md#build-order) has the build order, and each step ends in a check. Design can start on a simulated link with a mock answer before the hub works.

## 8. Open questions for the team

- [ ] How many of us have a Mac with Xcode? Each person who builds the native module or the hub's BitChat peer needs one.
- [ ] Who owns design? [The blueprint's decisions](BLUEPRINT_1.md#decisions) name the owners chosen so far.
- [ ] Who brings the Mac and the Spark to the venue?
- [ ] What's the name and tagline?

[BLUEPRINT_1.md](BLUEPRINT_1.md#open-questions) has the technical open questions.

## Sources

- [BitChat](https://github.com/permissionlesstech/bitchat)
- [bitchat-gateway](https://github.com/spcpza/bitchat-gateway)
- [Radio LLM](https://www.producthunt.com/products/off-grid-llm-over-radio)
- [net0](https://devpost.com/software/net0)
- [Meshnet](https://devpost.com/software/meshnet)
- [Flood Ready](https://dev.to/flamehaven01/i-survived-a-300-year-flood-then-i-built-flood-ready-on-device-ai-for-when-the-internet-fails-4f44)
- [MDN: Web Bluetooth API](https://developer.mozilla.org/Web/API/Web_Bluetooth_API)
- [caniuse: Web Bluetooth](https://caniuse.com/web-bluetooth)
