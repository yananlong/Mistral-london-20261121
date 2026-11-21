# Talk, locate and ask Mistral when the phone network is down

In a disaster, cell towers and internet access can fail. Phones still have Bluetooth, satellite positioning and a camera. This Mistral AI hackathon project uses them to connect people with no signal to a central hub that still has internet access, by passing messages from phone to phone. It gives people three capabilities:

- **Talk.** Message people nearby over a Bluetooth mesh. We build on [BitChat](https://github.com/permissionlesstech/bitchat), which relays messages from phone to phone for up to 7 hops.
- **Locate.** See where you are on a map that you downloaded in advance. A teammate is building an on-device computer vision model that helps you orient yourself on that map. You can share your position with people on the mesh.
- **Ask.** Send a question over the mesh to the hub, which answers with a Mistral model. Questions cover water, food, first aid and power. Because the hub has internet access, it can also pass on live official information, such as alerts, flood warnings and power cuts, and send "I'm safe" messages to family outside the area.

## How it works

In the proposed design, each phone runs our fork of the BitChat app, with the offline map and the vision model added. The hub joins the same mesh as one more BitChat peer. Phones that are out of its Bluetooth range reach it through other phones. When the hub receives a private message, it runs the question through a Mistral model that runs on the hub itself, so it keeps answering if its own internet connection drops. It uses its internet connection for live information and for messages to people outside the mesh. The hub is an ordinary BitChat peer, so a person with the stock BitChat app can ask it questions too.

[BLUEPRINT_1.md](BLUEPRINT_1.md) has the architecture, message format, build order, fallbacks and open questions. [DATASETS.md](DATASETS.md) ranks which information matters most in an urban emergency and lists the data sources for each kind.

## Hackathon scope

For the hackathon, a Mac mini stands in for the hub. The MVP is all three capabilities working on real phones. Every phone is in airplane mode with Bluetooth on, and a local Mistral model on the Mac mini answers the questions. The Mac mini runs with its network off during the core demo, so the audience can see that the answers come from the hub over the mesh and not from an internet connection.

Live information and messages to family come after the MVP. If they appear in the demo with recorded data, the pitch says so.

The demo uses a fictional disaster scenario. Every answer from the hub is labelled as AI-generated and not verified emergency advice.

## Demo

Phones A and B are in airplane mode, and the Mac mini has Wi-Fi off and Ethernet unplugged. Phone A messages phone B, finds its position on the offline map and shares it with phone B. A judge then uses phone A to ask the hub a survival question, and the answer arrives over the mesh. The beat-by-beat version is in [the blueprint's demo script](BLUEPRINT_1.md#demo-script).

## Project status

This repository contains planning documents, a Voxtral TTS script and the BitChat submodule. The app, the hub and the vision model are not built or tested yet.

| File | Contents |
| --- | --- |
| [BLUEPRINT_1.md](BLUEPRINT_1.md) | MVP architecture, the path from the MVP to the target hub, message format, demo script, build order and open questions. |
| [DATASETS.md](DATASETS.md) | Which information matters most in an emergency, and the datasets and live feeds that could supply it. |
| [PLAN.md](PLAN.md) | The open team plan: concept, prior art, platform constraints, stack and transport options, and the design workstream. |
| [IDEA.md](IDEA.md) | The original brainstorm with six survival needs. |
| [critique.md](critique.md) | The evidence that the demo should collect, and a commercial critique. |
| [SETUP_VOXTRAL.md](SETUP_VOXTRAL.md) | Mistral API key and cloud Voxtral TTS setup. The MVP uses no cloud services. |
