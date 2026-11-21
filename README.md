# Offline communication and access to Mistral

When infrastructure fails, a community can become the connection. This Mistral AI hackathon project explores how a person without internet access can communicate, share their location and reach a Mistral Agent through a nearby connected volunteer.

## The experience

1. A person opens the app on their phone without internet access. They can view their available coordinates and choose whether to share them.
2. They send a request over a nearby offline connection to a volunteer. We aim to integrate with Bitchat's Bluetooth mesh.
3. The volunteer explicitly accepts the request. Their connected device sends it to a Mistral Agent.
4. The agent prepares a concise response, such as a message to family containing the person's supplied location and needs.
5. The volunteer's device returns the response over the offline connection. The person reviews the draft before using it.

The app should show the request's progress: **queued → received by volunteer → processed → returned**. The offline user remains disconnected from the internet throughout.

## Hackathon scope

Our first goal is a working round trip between two real devices, with a Mistral Agent processing the request. We will validate Bitchat integration early. If it proves too large for the hackathon, we will demonstrate a direct nearby connection and treat Bitchat compatibility as future work.

Location coordinates are the starting point; locally stored maps are a stretch goal. The remote agent requires a working communication path to a volunteer with connectivity and access to Mistral. We will use a fictional disaster scenario for the demo and present generated content as a draft, not verified emergency advice.

## Demo

With phone A in airplane mode and Bluetooth enabled, the user shares their coordinates and asks for help drafting a message to family. A nearby volunteer accepts the request on a connected device. A Mistral Agent creates the draft, which returns to phone A over the local connection. The interface makes each handoff visible.

## Project status

This is a hackathon concept. The features, Bitchat integration and technical approach are yet to be built and validated.
