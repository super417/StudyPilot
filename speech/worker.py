"""Project-local Serena synthesis worker. Bind only to loopback."""
from __future__ import annotations

import io
import os
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock

ROOT = Path(__file__).resolve().parent
# Keep every runtime/download cache within this project.
for name, subdir in {
    "HF_HOME": ".cache/huggingface",
    "TORCH_HOME": ".cache/torch",
    "NUMBA_CACHE_DIR": ".cache/numba",
    "MPLCONFIGDIR": ".cache/matplotlib",
    "TEMP": ".cache/tmp",
    "TMP": ".cache/tmp",
}.items():
    target = ROOT / subdir
    target.mkdir(parents=True, exist_ok=True)
    os.environ[name] = str(target)

import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from qwen_tts import Qwen3TTSModel

MODEL_DIR = ROOT / "models" / "serena"
GREETING_PATH = ROOT / "output" / "greeting-serena.wav"
GREETING = "hi，有什么想和我聊聊的吗？"
model: Qwen3TTSModel | None = None
inference_lock = Lock()


def render_speech(text: str) -> bytes:
    if model is None:
        raise RuntimeError("model is not ready")
    with torch.inference_mode():
        waves, sample_rate = model.generate_custom_voice(
            text=text, language="Chinese", speaker="Serena",
            # SDPA works on Windows without compiling FlashAttention.
            max_new_tokens=2048,
        )
    result = io.BytesIO()
    sf.write(result, waves[0], sample_rate, format="WAV", subtype="PCM_16")
    return result.getvalue()


@asynccontextmanager
async def lifespan(_: FastAPI):
    global model
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU unavailable; check the project speech environment")
    if not MODEL_DIR.exists():
        raise RuntimeError("Serena model missing; run speech/setup.ps1 first")
    model = Qwen3TTSModel.from_pretrained(
        str(MODEL_DIR), device_map="cuda:0", dtype=torch.bfloat16,
        attn_implementation="sdpa", local_files_only=True,
    )
    GREETING_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not GREETING_PATH.exists():
        GREETING_PATH.write_bytes(render_speech(GREETING))
    yield
    model = None
    torch.cuda.empty_cache()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


class SpeechInput(BaseModel):
    text: str = Field(min_length=1, max_length=300)


@app.get("/health")
def health():
    return {"status": "ok", "voice": "Serena", "ready": model is not None}


@app.get("/greeting")
def greeting():
    return Response(GREETING_PATH.read_bytes(), media_type="audio/wav")


@app.post("/synthesize")
def synthesize(payload: SpeechInput):
    text = payload.text.strip()
    if not text:
        raise HTTPException(422, "text is empty")
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(429, "speech worker is busy")
    try:
        return Response(render_speech(text), media_type="audio/wav")
    finally:
        inference_lock.release()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8766)
