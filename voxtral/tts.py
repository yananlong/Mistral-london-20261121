"""Usage: .venv/bin/python tts.py "text" [out.mp3] [voice name or id]
Default voice: "Jane - Neutral" (en_us). List voices: .venv/bin/python tts.py --voices"""
import base64, os, sys
from pathlib import Path
from dotenv import load_dotenv
from mistralai.client import Mistral

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])
voices = client.audio.voices.list(limit=100).items

if sys.argv[1:2] == ["--voices"]:
    for v in voices:
        print(v.id, v.name, v.languages)
    sys.exit()

text = sys.argv[1] if len(sys.argv) > 1 else "Move to higher ground. Boil water before drinking."
out = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).parent / "out" / "test.mp3")
want = sys.argv[3] if len(sys.argv) > 3 else "Jane - Neutral"
voice = next(v for v in voices if want in (v.id, v.name))
out.parent.mkdir(parents=True, exist_ok=True)

resp = client.audio.speech.complete(model="voxtral-mini-tts-latest", input=text,
                                    voice_id=voice.id, response_format="mp3")
out.write_bytes(base64.b64decode(resp.audio_data))
print(f"saved {out} ({out.stat().st_size} bytes) voice={voice.name}")
