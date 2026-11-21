# Talk, locate and ask Mistral without internet

In a disaster, cell towers and internet access can fail. Phones still have Bluetooth, satellite positioning and a camera. This Mistral AI hackathon project uses them to give people three capabilities with no internet anywhere in the system:

- **Talk.** Message people nearby over a Bluetooth mesh. We build on [BitChat](https://github.com/permissionlesstech/bitchat), which relays messages from phone to phone for up to 7 hops.
- **Locate.** See where you are on a map that you downloaded in advance. A teammate is building an on-device computer vision model that helps you orient yourself on that map. You can share your position with people on the mesh.
- **Ask.** Send a question over the mesh to a Mac mini that has no internet connection. The Mac mini runs an open-weight Mistral model and sends the answer back over the mesh. Questions cover water, food, first aid and power.

## How it works

In the proposed design, each phone runs our fork of the BitChat app, with the offline map and the vision model added. The Mac mini joins the same mesh as one more BitChat peer, called the hub. When the hub receives a private message, it runs the question through a local Mistral model and replies to the sender. The hub is an ordinary BitChat peer, so a person with the stock BitChat app can ask it questions too.

[BLUEPRINT_1.md](BLUEPRINT_1.md) has the architecture, message format, build order, fallbacks and open questions.

## Hackathon scope

The MVP is all three capabilities working on real phones. Every phone is in airplane mode with Bluetooth on, and the Mac mini has no internet connection.

The demo uses a fictional disaster scenario. Every answer from the hub is labelled as AI-generated and not verified emergency advice.

## Demo

Phones A and B are in airplane mode, and the Mac mini has Wi-Fi off and Ethernet unplugged. Phone A messages phone B, finds its position on the offline map and shares it with phone B. A judge then uses phone A to ask the hub a survival question, and the answer arrives over the mesh. The beat-by-beat version is in [the blueprint's demo script](BLUEPRINT_1.md#demo-script).

## Project status

This repository contains planning documents, a Voxtral TTS script and the BitChat submodule. The app, the hub and the vision model are not built or tested yet.

| File | Contents |
| --- | --- |
| [BLUEPRINT_1.md](BLUEPRINT_1.md) | MVP architecture, message format, demo script, build order and open questions. |
| [PLAN.md](PLAN.md) | The open team plan: concept, prior art, platform constraints, stack and transport options, and the design workstream. |
| [IDEA.md](IDEA.md) | The original brainstorm with six survival needs. |
| [critique.md](critique.md) | The evidence that the demo should collect, and a commercial critique. |
| [SETUP_VOXTRAL.md](SETUP_VOXTRAL.md) | Mistral API key and cloud Voxtral TTS setup. The MVP uses no cloud services. |
