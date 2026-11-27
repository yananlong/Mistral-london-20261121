# Talk, locate and ask Mistral when the phone network is down

In a disaster, cell towers and internet access can fail. Phones still have Bluetooth, satellite positioning and a camera. This Mistral AI hackathon project uses them to connect people with no signal to a central hub, by passing messages from phone to phone. It gives people three capabilities:

- **Talk.** Message people nearby over a Bluetooth mesh. We build on [BitChat](https://github.com/permissionlesstech/bitchat), which relays messages from phone to phone for up to 7 hops.
- **Locate.** See where you are on a map that you downloaded in advance. A teammate is building an on-device computer vision model that helps you orient yourself on that map. You can share your position with people on the mesh.
- **Ask.** Send a question over the mesh to the hub, which answers with a Mistral model. Questions cover water, food, first aid and power. A later hub with an internet uplink could also pass on live official information, such as alerts, flood warnings and power cuts, and send "I'm safe" messages to family outside the area.

## How it works

Each iPhone runs our React Native app. A native module in the app wraps the mesh code from our fork of BitChat, and the app adds the offline map and the vision model. The hub, an offline NVIDIA DGX Spark, joins the same mesh as one more BitChat peer and answers with Ministral 3 14B Instruct 2512. Phones that are out of its Bluetooth range reach it through other phones. This open-weight Mistral model runs on local hardware with no internet. No question goes to a cloud model API. The hub is an ordinary BitChat peer, so a person with the stock BitChat app can ask it questions too.

[BLUEPRINT_1.md](BLUEPRINT_1.md) has the architecture, message format, build order, fallbacks and open questions. Its [decisions](BLUEPRINT_1.md#decisions) list what the team has settled and who owns each part. [DATASETS.md](DATASETS.md) ranks which information matters most in an urban emergency and lists the data sources for each kind.

## Design source of truth

[Design principles](design/PRINCIPLES.md), [visual tokens](design/system.html) and [interactive component examples](design/components.html) define the current interface. They supersede older visual and UX guidance elsewhere, including the legacy `prototype/`. Examples use fictional data and do not establish implemented transport, SMS or SOS integrations.

## Hackathon scope

For the hackathon, the hub is the team's offline DGX Spark, which runs Ministral 3 14B Instruct 2512 in Ollama. Phones reach it only over the BitChat mesh. The MVP is all three capabilities working on an iPhone and an Android phone (Pixel 9a). Both phones are in airplane mode with Bluetooth on, so the phones have no internet. The claim is that the model can run on local hardware with no internet, and that no question goes to a cloud model API. On stage, both phones show airplane mode, and the Ollama log on the hub shows each run.

Live information and messages to family come after the MVP. If they appear in the demo with recorded data, the pitch says so.

The demo uses a fictional disaster scenario. Every answer from the hub is labelled as AI-generated and not verified emergency advice.

## Demo

Phone A is an iPhone and phone B is a Pixel 9a, both in airplane mode. The hub is offline. Phone A messages phone B, finds its position on the offline map and shares it with phone B. A judge then uses phone A to ask the hub a survival question, and the answer arrives over the mesh. The Ollama log on the hub shows the run. The beat-by-beat version is in [the blueprint's demo script](BLUEPRINT_1.md#demo-script).

## Project status

This repository contains planning documents, a Voxtral TTS script and the BitChat submodule. The React Native app shell (`phone/app`, Talk/Locate/Ask on a simulated mesh) and the offline hub responder (`hub/`) exist; the BitChat native module, the on-device vision model wiring and the Xcode/Android app shells are still to land. `phone/TESTFLIGHT.md` lists what is needed to ship the app to TestFlight.

| File | Contents |
| --- | --- |
| [BLUEPRINT_1.md](BLUEPRINT_1.md) | Team decisions, MVP architecture, the path from the MVP to the target hub, message format, demo script, build order and open questions. |
| [DATASETS.md](DATASETS.md) | Which information matters most in an emergency, and the datasets and live feeds that could supply it. |
| [PLAN.md](PLAN.md) | The open team plan: concept, prior art, platform constraints, the chosen stack and transport, and the design workstream. |
| [IDEA.md](IDEA.md) | The original brainstorm with six survival needs. |
| [critique.md](critique.md) | The evidence that the demo should collect, and a commercial critique. |
| [SETUP_VOXTRAL.md](SETUP_VOXTRAL.md) | Mistral API key and cloud Voxtral TTS setup. The MVP uses no cloud model API. |
| [video/README.md](video/README.md) | Multi-agent Remotion pipeline for the 35-40 s feature video: director -> parallel generator agents -> curator -> editor/QA -> human review gate. |

## Contributors

- Ying Wang (wyxiaoyang)
