# Team plan (open draft)

An open plan for the team. Edit freely. Nothing here is decided until the team agrees. See [README.md](README.md) for the concept.

**Status pipeline:** queued → received by volunteer → processed → returned

---

## 1. Sharpening the concept

Mesh messaging apps and off-grid AI projects already exist. What makes ours different is that a **consenting human volunteer** is the person's route to the AI. It runs on ordinary phones, and the person reviews every draft before using it.

- **Trust is the product.** The person chooses to share their location, the volunteer accepts explicitly, and the reply is always labelled as a draft and not emergency advice.
- **Templates, not chat.** For example "Message to family", "I need water or medical help", "Nearest shelter". Short requests suit a slow link and stressed people.
- **Every handoff is visible.** The four-step status tracker carries the demo for both roles.
- **Built for bad conditions.** Big tap targets, high contrast in sunlight, scalable text, low battery use.

## 2. Prior art: does this already exist?

Parts of it do. The whole flow doesn't.

| Project | Link | Where the AI runs | Hardware | What we learn |
|---|---|---|---|---|
| Bitchat | Bluetooth mesh + Nostr | No AI | Phones | The mesh we'd like to use, but it has no public API, only community ports that haven't been audited. |
| Radio LLM | Meshtastic LoRa radio | A server at the other end of the radio link | LoRa radios | AI over a mesh works, but you need dedicated radios. |
| net0 | ESP32 relay nodes | Gemini dispatch dashboard | Custom nodes | Saves reports locally first, so they aren't lost if the AI can't be reached. |
| Meshnet | Bluetooth mesh | A web server summarises mesh traffic | Phones | The AI only reads the traffic; it doesn't reply to people. |
| Flood Ready | QR codes between devices | On-device, in the browser | Phones | QR relay is a real, fully offline fallback. |
| Bridgefy / Briar | Bluetooth / Wi-Fi mesh | No AI | Phones | Audits found security flaws in Bridgefy, so trust has to be designed in. |
| **Us** | Nearby offline link | Mistral, through a volunteer | Two ordinary phones | A person in the loop on both ends. |

## 3. Hard constraints

- **A web app can't send messages phone to phone over Bluetooth.** Web Bluetooth only connects to accessories, runs only in Chromium and doesn't work on iOS. A real offline link needs a native app, a local Wi-Fi network or QR codes.
- **Native offline links don't work across platforms.** Apple's Multipeer and Google's Nearby can't talk to each other, so both demo phones need the same OS. QR codes work across both.
- **No one needs to pay.** A free Apple ID can install the app onto our own iPhones from Xcode (it re-signs every 7 days, about 3 devices). Android APKs install freely. Only TestFlight needs the $99 account, and we don't need it.

## 4. Open decision: which stack?

Whatever we pick, the UI should sit on one small `Transport` interface (send, receive, peers), so how messages move can change without redoing the design.

| Option | Pros | Cons |
|---|---|---|
| **Expo (React Native)** | Least setup. Design in Expo Go with live changes on real phones. Real offline link later via `expo-nearby-connections`. React skills carry over. | The offline link needs one development build, made on one laptop. |
| **Swift (iOS only)** | Native feel. Multipeer is built in. Same language as Bitchat. | Everyone needs Xcode and a Mac. iOS only. |
| **React web app** | Fastest to start. Fine for a design prototype. | No Bluetooth. A real handoff needs QR codes or a local Wi-Fi network. |

## 5. Open decision: how does the message move?

| Option | Truly offline? | Effort | Demo risk | Notes |
|---|---|---|---|---|
| Simulated link | No | Very low | None | Enough to design every screen and state. |
| QR codes | Yes | Low | Low | Works on any phone and across iOS and Android. Each handoff is a visible gesture. |
| Local Wi-Fi + server | Yes (network with no internet) | Medium | Medium | Needs network setup at the venue. |
| Multipeer / Nearby | Yes | Medium | Medium | Native only, and both phones need the same OS. |
| Bitchat | Yes (multi-hop mesh) | High | High | Closest to the vision. Try it for a fixed timebox before committing. |

## 6. Design workstream

**Person (offline):** open the app → see coordinates → choose whether to share them → pick a template and add details → send → watch the status → review the draft → copy or share it.

**Volunteer (online):** see an incoming request → accept or decline → preview exactly what goes to Mistral → send → return the reply.

**States to design:** no one nearby, connecting, declined, timed out, Mistral error, location permission denied, mock mode.

Other deliverables:
- Status tracker spec: one shared component and the visual heart of the demo.
- Tokens: colour, type, spacing and radius, with a calm palette rather than an alarming one.
- Copy: plain language, draft labels, the disclaimer.
- Demo script: a two-minute story, beat by beat, with phone A in airplane mode.
- Tool: Figma or straight in code (to decide).

## 7. Rough phasing

1. **Design on a simulated link.** Build every screen and state, with a mock Mistral response so we don't need a key or a connection.
2. **Real Mistral call.** The volunteer's phone calls the Mistral Agent with a short system prompt for drafts. The API key stays out of git.
3. **Real offline link.** Swap in the transport the team chose. Run the full round trip on two phones, with phone A in airplane mode.
4. **Stretch:** Bitchat (only after a timeboxed spike), then offline maps.

## 8. Open questions for the team

- [ ] Which stack: Expo, Swift or web? How many of us have a Mac with Xcode?
- [ ] Which phones do we have for the demo? Two iPhones, two Androids, or one of each? (One of each means QR codes.)
- [ ] Do we spend an hour on a Bitchat spike, and who takes it?
- [ ] Do we use a Mistral Agent (Agents API) or plain chat completions with a fixed prompt?
- [ ] What's the name and tagline?

## Sources

- [Bitchat](https://github.com/permissionlesstech/bitchat)
- [Radio LLM](https://www.producthunt.com/products/off-grid-llm-over-radio)
- [net0](https://devpost.com/software/net0)
- [Meshnet](https://devpost.com/software/meshnet)
- [Flood Ready](https://dev.to/flamehaven01/i-survived-a-300-year-flood-then-i-built-flood-ready-on-device-ai-for-when-the-internet-fails-4f44)
- [MDN: Web Bluetooth API](https://developer.mozilla.org/Web/API/Web_Bluetooth_API)
- [caniuse: Web Bluetooth](https://caniuse.com/web-bluetooth)
- [expo-nearby-connections](https://www.pkgstats.com/pkg:expo-nearby-connections)
