# Team plan (open draft)

An open plan for the team. Edit freely. Nothing here is decided until the team agrees. [README.md](README.md) has the concept, and [BLUEPRINT_1.md](BLUEPRINT_1.md) has the MVP architecture and build order.

The MVP gives people three capabilities with no internet. They can talk over the BitChat mesh, locate themselves on an offline map with an on-device vision model, and ask a Mistral model that runs on an offline Mac mini hub.

---

## 1. Sharpening the concept

Mesh messaging apps and off-grid AI projects already exist. Our difference is one Mistral model on an offline Mac mini, shared by everyone in mesh range, with no internet anywhere in the system. The phones spend no battery on inference, and the hub has the memory for a larger model and a library of survival guides. The same phones message each other and find their position on an offline map.

- **No internet anywhere.** The phones are in airplane mode, and the Mac mini has no network connection. The demo shows this at the start.
- **Works with stock BitChat.** The hub answers plain-text private messages, so a person with the stock BitChat app can ask it questions. Our app adds the map, the vision model and a better Ask screen.
- **Trust is the product.** The person chooses whether to share their location, and every answer is labelled as AI-generated and not verified emergency advice.
- **Templates, not chat.** The Ask screen offers suggested questions, for example "How do I make water safe to drink?" or "How do I stop heavy bleeding?". Short questions and answers suit a slow link and stressed people.
- **Built for bad conditions.** Big tap targets, high contrast in sunlight, scalable text, low battery use.

## 2. Prior art: does this already exist?

Parts of it do. The closest precedent, [bitchat-gateway](https://github.com/spcpza/bitchat-gateway), uses the same pattern of a BitChat peer that answers questions, but it sends them to an AI service on the internet. [critique.md](critique.md) covers it and other precedents in more detail.

| Project | Link | Where the AI runs | Hardware | What we learn |
|---|---|---|---|---|
| BitChat | Bluetooth mesh + Nostr | No AI | Phones | The mesh we build on. It has no bot API, so the hub needs a modified BitChat build. Community ports haven't been audited. |
| bitchat-gateway | BitChat mesh | Internet AI, reached through a connected peer | Phones and a connected computer | The same peer pattern as our hub, but it needs internet. |
| Radio LLM | Meshtastic LoRa radio | A server at the other end of the radio link | LoRa radios | AI over a mesh works, but you need dedicated radios. |
| net0 | ESP32 relay nodes | Gemini dispatch dashboard | Custom nodes | Saves reports locally first, so they aren't lost if the AI can't be reached. |
| Meshnet | Bluetooth mesh | A web server summarises mesh traffic | Phones | The AI only reads the traffic; it doesn't reply to people. |
| Flood Ready | QR codes between devices | On-device, in the browser | Phones | QR relay is a real, fully offline fallback. |
| Bridgefy / Briar | Bluetooth / Wi-Fi mesh | No AI | Phones | Audits found security flaws in Bridgefy, so trust has to be designed in. |
| **Us** | BitChat mesh | A Mistral model on an offline Mac mini | Ordinary phones and a Mac mini | No internet anywhere, and stock BitChat users can ask the hub too. |

## 3. Hard constraints

- **A web app can't send messages phone to phone over Bluetooth.** Web Bluetooth only connects to accessories, runs only in Chromium and doesn't work on iOS. A real offline link needs a native app, a local Wi-Fi network or QR codes.
- **Native offline links don't work across platforms.** Apple's Multipeer and Google's Nearby can't talk to each other, so a fallback on either one needs demo phones on the same OS. QR codes work across both. BitChat also has an [Android app](https://github.com/permissionlesstech/bitchat-android). Test messaging between iOS and Android before you rely on it.
- **The hub stays in one place and needs power.** Phones reach it only within Bluetooth range, either directly or through other phones on the mesh. The Mac mini's memory sets the largest model that it can run.
- **No one needs to pay.** A free Apple ID can install the app onto our own iPhones from Xcode (it re-signs every 7 days, about 3 devices). Android APKs install freely. Only TestFlight needs the $99 account, and we don't need it.

## 4. Open decision: which stack?

Whatever we pick, the UI should sit on one small `Transport` interface (send, receive, peers), so how messages move can change without redoing the design.

The blueprint proposes a Swift fork of BitChat. BitChat's mesh, its iOS app and the macOS app that the hub runs are all written in Swift.

| Option | Pros | Cons |
|---|---|---|
| **Swift fork of BitChat (iOS)** | The mesh already works. The hub's macOS build shares the code. Multipeer is built in as a fallback. | Everyone who builds it needs Xcode and a Mac. iOS only. |
| **Expo (React Native)** | Least setup. Design in Expo Go with live changes on real phones. Real offline link later via `expo-nearby-connections`. React skills carry over. | Reaching BitChat users or the hub means wrapping BitChat's Swift code in a native module. The offline link needs one development build, made on one laptop. |
| **React web app** | Fastest to start. Fine for a design prototype. | No Bluetooth. A real handoff needs QR codes or a local Wi-Fi network. |

## 5. Open decision: how does the message move?

This decision covers messages between phones and questions from phones to the hub. The blueprint proposes BitChat for both, with Multipeer as the fallback.

| Option | Truly offline? | Effort | Demo risk | Notes |
|---|---|---|---|---|
| Simulated link | No | Very low | None | Enough to design every screen and state. |
| QR codes | Yes | Low | Low | Works on any phone and across iOS and Android. Each handoff is a visible gesture. The Mac mini needs a webcam to read codes. |
| Local Wi-Fi and server | Yes (network with no internet) | Medium | Medium | The Mac mini serves the model over a Wi-Fi router that has no internet uplink. Phones must be in range of the router. It doesn't carry messages between phones. |
| Multipeer or Nearby | Yes | Medium | Medium | Native only, and both phones need the same OS. Multipeer also runs on macOS, but it has no multi-hop relay. |
| BitChat | Yes (multi-hop mesh) | High | High | Proposed. One mesh carries Talk and Ask, and stock BitChat users can join. The hub needs a modified macOS build. Try it for a fixed timebox before committing. |

## 6. Design workstream

The phone has three flows:

- **Talk.** Open the app and see who is nearby. Message one person or the public channel.
- **Locate.** Open the map and see your position. Use the camera to orient yourself, and share your location if you choose.
- **Ask.** Pick a suggested question or type one, and choose whether to attach your location. Send it, watch the status and read the answer.

The hub has no screen. For the demo, a terminal log on the Mac mini shows each question and each model run.

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

- [ ] How many of us have a Mac with Xcode? Each person who builds the Swift fork needs one.
- [ ] Who owns each workstream: the hub, the phone app, the vision model and design?
- [ ] Who brings the Mac mini to the venue?
- [ ] What's the name and tagline?

[BLUEPRINT_1.md](BLUEPRINT_1.md#open-questions) has the technical open questions.

## Sources

- [BitChat](https://github.com/permissionlesstech/bitchat)
- [BitChat for Android](https://github.com/permissionlesstech/bitchat-android)
- [bitchat-gateway](https://github.com/spcpza/bitchat-gateway)
- [Radio LLM](https://www.producthunt.com/products/off-grid-llm-over-radio)
- [net0](https://devpost.com/software/net0)
- [Meshnet](https://devpost.com/software/meshnet)
- [Flood Ready](https://dev.to/flamehaven01/i-survived-a-300-year-flood-then-i-built-flood-ready-on-device-ai-for-when-the-internet-fails-4f44)
- [MDN: Web Bluetooth API](https://developer.mozilla.org/Web/API/Web_Bluetooth_API)
- [caniuse: Web Bluetooth](https://caniuse.com/web-bluetooth)
- [expo-nearby-connections](https://www.pkgstats.com/pkg:expo-nearby-connections)
