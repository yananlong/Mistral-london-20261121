# Talk, locate and ask Mistral when the phone network is down

In a disaster, cell towers and internet access can fail. Phones still have Bluetooth, satellite positioning and a camera. This Mistral AI hackathon project uses them to connect people with no signal to a central hub that still has internet access, by passing messages from phone to phone. It gives people three capabilities:

- **Talk.** Message people nearby over a Bluetooth mesh. We build on [BitChat](https://github.com/permissionlesstech/bitchat), which relays messages from phone to phone for up to 7 hops.
- **Locate.** See where you are on a map that you downloaded in advance. A teammate is building an on-device computer vision model that helps you orient yourself on that map. You can share your position with people on the mesh.
- **Ask.** Send a question over the mesh to the hub, which answers with a Mistral model. Questions cover water, food, first aid and power. Because the hub has internet access, it can also pass on live official information, such as alerts, flood warnings and power cuts, and send "I'm safe" messages to family outside the area.

## How it works

Each iPhone runs our React Native app. A native module in the app wraps the mesh code from our fork of BitChat, and the app adds the offline map and the vision model. The Mac bridge, a Mac that runs a modified BitChat for macOS build, joins the same mesh as one more BitChat peer. Phones that are out of its Bluetooth range reach it through other phones. When the Mac bridge receives a private message, it forwards the question to the hub, an NVIDIA DGX Spark that answers with Ministral 3 14B Instruct. This open-weight Mistral model can run on local hardware with no internet. No question goes to a cloud model API. The target hub uses its internet connection for live information and for messages to people outside the mesh, never for cloud models. The Mac bridge is an ordinary BitChat peer, so a person with the stock BitChat app can ask the hub questions too.

[BLUEPRINT_1.md](BLUEPRINT_1.md) has the architecture, message format, build order, fallbacks and open questions. Its [decisions](BLUEPRINT_1.md#decisions) list what the team has settled and who owns each part. [DATASETS.md](DATASETS.md) ranks which information matters most in an urban emergency and lists the data sources for each kind.

## Hackathon scope

For the hackathon, the hub is the team's DGX Spark, a remote GPU server that runs Ministral 3 14B Instruct in Ollama. The Mac bridge sits at the venue and reaches the hub over the internet. The MVP is all three capabilities working on 2 iPhones. Both iPhones are in airplane mode with Bluetooth on, so the phones have no internet. The claim is that the model can run on local hardware with no internet, and that no question goes to a cloud model API. On stage, both iPhones show airplane mode, and the Ollama log on the hub shows each run.

Live information and messages to family come after the MVP. If they appear in the demo with recorded data, the pitch says so.

The demo uses a fictional disaster scenario. Every answer from the hub is labelled as AI-generated and not verified emergency advice.

## Demo

Phones A and B are iPhones in airplane mode. The Mac bridge at the venue reaches the remote hub over the internet. Phone A messages phone B, finds its position on the offline map and shares it with phone B. A judge then uses phone A to ask the hub a survival question, and the answer arrives over the mesh. The Ollama log on the hub shows the run. The beat-by-beat version is in [the blueprint's demo script](BLUEPRINT_1.md#demo-script).

## Project status

This repository contains planning documents, a Voxtral TTS script and the BitChat submodule. The app, the Mac bridge, the hub and the vision model are not built or tested yet.

| File | Contents |
| --- | --- |
| [BLUEPRINT_1.md](BLUEPRINT_1.md) | Team decisions, MVP architecture, the path from the MVP to the target hub, message format, demo script, build order and open questions. |
| [DATASETS.md](DATASETS.md) | Which information matters most in an emergency, and the datasets and live feeds that could supply it. |
| [PLAN.md](PLAN.md) | The open team plan: concept, prior art, platform constraints, the chosen stack and transport, and the design workstream. |
| [IDEA.md](IDEA.md) | The original brainstorm with six survival needs. |
| [critique.md](critique.md) | The evidence that the demo should collect, and a commercial critique. |
| [SETUP_VOXTRAL.md](SETUP_VOXTRAL.md) | Mistral API key and cloud Voxtral TTS setup. The MVP uses no cloud model API. |
