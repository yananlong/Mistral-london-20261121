# Voxtral 3 TTS: Setup and API Key

Voxtral 3 is Mistral's speech family (released 2026-10-20). We use the TTS model
(announced as **Voxtral Mini TTS 3**) for spoken guidance in the offline survival app.

> **Offline caveat:** the hosted API needs internet. Generate and cache audio for
> critical phrases *before* going offline. No open weights were found for Voxtral
> TTS 3. Only the older `mistralai/Voxtral-4B-TTS-2603` is open (CC BY-NC 4.0,
> non-commercial; vLLM-Omni wants ~16GB GPU, more than our 12GB RTX 3060s).

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

Already set up in this repo: `voxtral/.venv` (mistralai 3.8.0) and `voxtral/tts.py`.

```bash
cd voxtral
.venv/bin/python tts.py "Move to higher ground." out/hello.mp3   # default voice: Jane - Neutral
.venv/bin/python tts.py --voices                                   # list voices
```

To recreate it:

```bash
uv venv voxtral/.venv && uv pip install --python voxtral/.venv/bin/python -U mistralai python-dotenv
```

## 4. Smoke test: generate speech

A voice is **required** (`voice_id` or `ref_audio`), otherwise the API returns 400.
In `mistralai` 3.x the import is `from mistralai.client import Mistral`.

```python
import base64, os
from dotenv import load_dotenv
from mistralai.client import Mistral

load_dotenv()
client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])

voices = client.audio.voices.list(limit=100).items   # max limit is 100
voice = next(v for v in voices if v.name == "Jane - Neutral")

resp = client.audio.speech.complete(
    model="voxtral-mini-tts-latest",   # also: voxtral-mini-tts-3-0, voxtral-mini-tts-realtime-latest
    input="Move to higher ground. Boil water before drinking.",
    voice_id=voice.id,
    response_format="mp3",
)
open("out.mp3", "wb").write(base64.b64decode(resp.audio_data))  # audio is base64
```

Note: `voices.list` prints a deprecation warning (offset pagination); Mistral says
to move to `GET /v2/audio/voices`.

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| `401 Unauthorized` | Key wrong/expired, or `MISTRAL_API_KEY` not exported |
| `402/403` on first call | Billing not enabled, or text blocked by content moderation |
| `400 Either ref_audio or voice must be provided` | Pass `voice_id` (see `tts.py --voices`) |
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

*Verified by a live API call on 2026-11-21 (model alias, voices, SDK import); prices are unverified. Confirm model IDs, voices and prices in the docs.*
