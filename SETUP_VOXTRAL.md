# Voxtral 3 TTS: Setup and API Key

Voxtral 3 is Mistral's speech family (released 2026-10-20). We use the TTS model
(announced as **Voxtral Mini TTS 3**) for spoken guidance in the offline survival app.

> **Offline caveat:** the hosted API needs internet. Generate and cache audio for
> critical phrases *before* going offline, or self-deploy the model on-device/local
> server. Check Mistral's docs for whether the Voxtral 3 TTS weights are open.

## 1. Get an API key

1. Go to the Mistral Studio console: <https://console.mistral.ai>
2. Sign up / log in (email, Google, etc.).
3. Create or join an **Organization/Workspace**. Hackathon credits, if given, are
   usually applied to the org: check the hackathon organizers' instructions.
4. **Enable billing** (Workspace -> Billing). Pay-as-you-go is required for API access.
   TTS pricing is about $13 per 1M input characters.
5. Open **API Keys** in the left sidebar -> **Create new key**.
6. Name it (e.g. `hackathon-london`), optionally set an expiry, and **copy it
   immediately**. It is shown only once.

## 2. Store the key

Never commit the key.

```bash
# .env  (add to .gitignore!)
MISTRAL_API_KEY=your_key_here
```

```bash
echo ".env" >> .gitignore
export MISTRAL_API_KEY=your_key_here   # or: set -a; source .env; set +a
```

## 3. Install the SDK

```bash
python -m venv .venv && source .venv/bin/activate
pip install -U mistralai python-dotenv
```

## 4. Smoke test: generate speech

```python
import base64, os
from dotenv import load_dotenv
from mistralai import Mistral

load_dotenv()
client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])

resp = client.audio.speech.complete(
    model="voxtral-mini-tts-3-0",   # verify the exact ID in the docs / console model list
    input="Move to higher ground. Boil water before drinking.",
    # voice=...                     # see docs for available preset voices
)

# Audio comes back base64-encoded
with open("out.mp3", "wb") as f:
    f.write(base64.b64decode(resp.audio_data))
print("saved out.mp3")
```

Or with curl:

```bash
curl https://api.mistral.ai/v1/audio/speech \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"voxtral-mini-tts-3-0","input":"Hello from Voxtral"}'
```

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| `401 Unauthorized` | Key wrong/expired, or `MISTRAL_API_KEY` not exported |
| `402/403` on first call | Billing not enabled, or text blocked by content moderation |
| `model not found` | Model ID differs. Docs have shown `voxtral-mini-tts-2603` and `voxtral-mini-tts-3-0`; check the console's model list |
| Audio file won't play | You wrote the base64 string instead of decoding it |

## 6. Offline strategy for the hackathon

- Pre-generate audio for a fixed phrase library (water, first aid, evacuation, ...)
  in each target language and bundle it with the app.
- Fall back to on-device TTS (Android/iOS system TTS) for dynamic text.
- If self-hosting, run the model on a laptop/edge box over a local hotspot.

## Sources

- [Voxtral 3 announcement](https://mistral.ai/news/voxtral-3/)
- [Mistral docs: Speech Generation](https://docs.mistral.ai/studio/audio/text_to_speech/speech)
- [Mistral docs: Quickstart, generate speech](https://docs.mistral.ai/studio/audio/text-to-speech/quickstart-generate-speech)
- [Voxtral TTS (March 2026 predecessor)](https://mistral.ai/news/voxtral-tts/)

*Details came from web search snippets, not the live console. Confirm model IDs, voices and prices in the docs.*
