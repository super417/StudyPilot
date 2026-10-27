"""Authenticated natural voice for replies the user chooses to read aloud."""
import asyncio
import base64
from collections.abc import Awaitable, Callable
from pathlib import Path
import os
import subprocess
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StringConstraints

from app.models.entities import User
from app.routers.dependencies import get_current_user

router = APIRouter(prefix='/api/speech', tags=['speech'])
SPEECH_ROOT = Path(__file__).resolve().parents[3] / 'speech'
GREETING_PATH = SPEECH_ROOT / 'output/greeting-xiaoxiao.mp3'
MAX_AUDIO_BYTES = 8 * 1024 * 1024
Synthesizer = Callable[[str], Awaitable[bytes]]
_speech_slots = asyncio.Semaphore(2)


class SpeechPayload(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


async def synthesize_selected_reply(text: str) -> bytes:
    python = SPEECH_ROOT / '.venv-edge' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not python.is_file():
        raise RuntimeError('project voice client is missing')
    try:
        await asyncio.wait_for(_speech_slots.acquire(), timeout=0.5)
    except TimeoutError:
        raise HTTPException(429, detail={'code': 'SPEECH_BUSY', 'message': '语音正在准备，请稍后重试'}) from None
    try:
        # Separate lightweight environment; stdin contains only this selected text.
        result = await asyncio.to_thread(
            subprocess.run,
            [str(python), str(SPEECH_ROOT / 'synthesize.py')],
            input=text.encode('utf-8'), capture_output=True, check=True, timeout=25,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        return result.stdout
    finally:
        _speech_slots.release()


def get_speech_synthesizer() -> Synthesizer | None:
    return synthesize_selected_reply


def audio_response(data: bytes):
    is_mp3 = data[:3] == b'ID3' or (len(data) >= 2 and data[0] == 0xff and data[1] & 0xe0 == 0xe0)
    if not is_mp3 or len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(503, detail={'code': 'SPEECH_UNAVAILABLE', 'message': '语音暂不可用，请稍后重试'})
    return {'status': 'ok', 'voice': 'Xiaoxiao', 'mimeType': 'audio/mpeg', 'audioBase64': base64.b64encode(data).decode('ascii')}


@router.get('/greeting')
async def greeting(_: User = Depends(get_current_user)):
    if not GREETING_PATH.is_file():
        raise HTTPException(503, detail={'code': 'SPEECH_UNAVAILABLE', 'message': '语音暂不可用，请稍后重试'})
    return audio_response(GREETING_PATH.read_bytes())


@router.post('/synthesize')
async def synthesize(
    payload: SpeechPayload,
    _: User = Depends(get_current_user),
    synth: Synthesizer | None = Depends(get_speech_synthesizer),
):
    if synth is None:
        raise HTTPException(503, detail={'code': 'SPEECH_NOT_ENABLED', 'message': '回复朗读暂未启用'})
    try:
        return audio_response(await synth(payload.text))
    except (OSError, RuntimeError, subprocess.SubprocessError):
        raise HTTPException(503, detail={'code': 'SPEECH_UNAVAILABLE', 'message': '语音暂不可用，请稍后重试'}) from None
