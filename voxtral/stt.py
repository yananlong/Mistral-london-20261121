# /// script
# requires-python = ">=3.10"
# dependencies = ["websockets>=13", "soundfile", "soxr", "numpy"]
# ///
"""Stream an audio file to the local Voxtral Realtime STT server (vLLM /v1/realtime).

Usage: uv run voxtral/stt.py audio.(wav|ogg|flac) [ws://localhost:8001/v1/realtime]
Prints transcription deltas live, then the final text.
"""
import asyncio, base64, json, sys

import numpy as np, soundfile as sf, soxr, websockets

MODEL = "voxtral-stt"  # matches --served-model-name
CHUNK_S = 0.08  # 80 ms = one model token


async def transcribe(path: str, url: str) -> str:
    audio, sr = sf.read(path, dtype="float32", always_2d=True)
    audio = soxr.resample(audio.mean(axis=1), sr, 16000)
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    step = int(16000 * CHUNK_S) * 2

    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"type": "session.update", "model": MODEL}))
        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))  # start generation

        async def send_audio():
            for i in range(0, len(pcm), step):
                chunk = base64.b64encode(pcm[i:i + step]).decode()
                await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": chunk}))
                await asyncio.sleep(0)  # pass CHUNK_S here to simulate a live mic
            await ws.send(json.dumps({"type": "input_audio_buffer.commit", "final": True}))

        sender = asyncio.create_task(send_audio())
        async for msg in ws:
            ev = json.loads(msg)
            if ev["type"] == "transcription.delta":
                print(ev["delta"], end="", flush=True)
            elif ev["type"] == "transcription.done":
                await sender
                print()
                return ev["text"]
            elif ev["type"] == "error":
                raise RuntimeError(ev)
    raise RuntimeError("connection closed before transcription.done")


if __name__ == "__main__":
    url = sys.argv[2] if len(sys.argv) > 2 else "ws://localhost:8001/v1/realtime"
    text = asyncio.run(transcribe(sys.argv[1], url))
    print("FINAL:", text.strip())
