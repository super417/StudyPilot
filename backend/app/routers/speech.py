"""Authenticated natural voice for replies the user chooses to read aloud."""
import asyncio
import base64
from collections import OrderedDict
from collections.abc import Awaitable, Callable
import hashlib
from pathlib import Path
import os
import subprocess
import secrets
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, StringConstraints
from starlette.background import BackgroundTask

from app.models.entities import User
from app.routers.dependencies import get_current_user

router = APIRouter(prefix='/api/speech', tags=['speech'])
SPEECH_ROOT = Path(__file__).resolve().parents[3] / 'speech'
GREETING_PATH = SPEECH_ROOT / 'output/greeting-xiaoxiao.mp3'
MAX_AUDIO_BYTES = 8 * 1024 * 1024
Synthesizer = Callable[[str], Awaitable[bytes]]
_speech_slots = asyncio.Semaphore(2)
# Short-lived, authenticated playback URLs keep reply text out of URL/access logs.
_tickets: OrderedDict[str, tuple[str, str, float]] = OrderedDict()
_audio_cache: OrderedDict[tuple[str, bytes], tuple[bytes, float]] = OrderedDict()
_cache_bytes = 0
CACHE_LIMIT = 16 * 1024 * 1024
_warming: dict[tuple[str, bytes], asyncio.Future] = {}


async def stream_selected_reply(text: str):
    python = SPEECH_ROOT / '.venv-edge' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not python.is_file():
        raise RuntimeError('project voice client is missing')
    try:
        await asyncio.wait_for(_speech_slots.acquire(), timeout=0.5)
    except TimeoutError:
        raise HTTPException(429, detail={'code': 'SPEECH_BUSY', 'message': '语音正在准备，请稍后重试'}) from None
    process = None
    try:
        process = subprocess.Popen(
            [str(python), str(SPEECH_ROOT / 'synthesize.py'), '--stream'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        process.stdin.write(text.encode('utf-8'))
        process.stdin.close()
        size = 0
        while data := await asyncio.to_thread(process.stdout.read1, 4096):
            size += len(data)
            if size > MAX_AUDIO_BYTES:
                raise RuntimeError('audio exceeds size limit')
            yield data
        if await asyncio.to_thread(process.wait, timeout=5) != 0 or not size:
            raise RuntimeError('voice stream failed')
    finally:
        try:
            if process is not None:
                if process.poll() is None:
                    process.kill()
                await asyncio.to_thread(process.wait)
        finally:
            if process is not None:
                process.stdout.close()
                if not process.stdin.closed:
                    process.stdin.close()
            _speech_slots.release()


def get_speech_streamer():
    return stream_selected_reply


def _cached(key):
    global _cache_bytes
    now = time.monotonic()
    for old_key, (audio, expires) in list(_audio_cache.items()):
        if expires <= now:
            _cache_bytes -= len(audio)
            del _audio_cache[old_key]
    if key not in _audio_cache:
        return None
    _audio_cache.move_to_end(key)
    return _audio_cache[key][0]


def _remember(key, audio):
    global _cache_bytes
    if key in _audio_cache:
        _cache_bytes -= len(_audio_cache.pop(key)[0])
    _audio_cache[key] = (audio, time.monotonic() + 900)
    _cache_bytes += len(audio)
    while _cache_bytes > CACHE_LIMIT or len(_audio_cache) > 128:
        _cache_bytes -= len(_audio_cache.popitem(last=False)[1][0])


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
            input=text.encode('utf-8'), capture_output=True, check=True, timeout=50,
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


@router.post('/playback')
async def create_playback(payload: SpeechPayload, user: User = Depends(get_current_user)):
    now = time.monotonic()
    for token, (_, _, expires) in list(_tickets.items()):
        if expires <= now:
            del _tickets[token]
    while len(_tickets) >= 128:
        _tickets.popitem(last=False)
    token = secrets.token_urlsafe(24)
    _tickets[token] = (str(user.id), payload.text, now + 120)
    return {'voice': 'Xiaoxiao', 'audioPath': f'/api/speech/playback/{token}'}


@router.post('/prewarm')
async def prewarm_audio(
    payload: SpeechPayload, user: User = Depends(get_current_user), streamer=Depends(get_speech_streamer),
):
    key = (str(user.id), hashlib.sha256(payload.text.encode('utf-8')).digest())
    if _cached(key) is not None:
        return {'ready': True}
    if key in _warming:
        await asyncio.shield(_warming[key])
        return {'ready': _cached(key) is not None}
    ready = asyncio.get_running_loop().create_future()
    _warming[key] = ready
    stream = streamer(payload.text)
    try:
        audio = bytearray()
        async for part in stream:
            if not audio:
                audio_response(part)
            audio.extend(part)
            if len(audio) > MAX_AUDIO_BYTES:
                raise RuntimeError('audio exceeds size limit')
        audio_response(bytes(audio))
        _remember(key, bytes(audio))
        return {'ready': True}
    except (OSError, RuntimeError, subprocess.SubprocessError):
        raise HTTPException(503, detail={'code': 'SPEECH_UNAVAILABLE', 'message': '语音预备失败，点击朗读时可重试'}) from None
    finally:
        await stream.aclose()
        _warming.pop(key, None)
        if not ready.done():
            ready.set_result(None)


@router.get('/playback/{token}')
async def playback_audio(
    token: str, user: User = Depends(get_current_user), streamer=Depends(get_speech_streamer),
):
    ticket = _tickets.get(token)
    if ticket is None or ticket[0] != str(user.id) or ticket[2] <= time.monotonic():
        raise HTTPException(404, detail={'code': 'SPEECH_EXPIRED', 'message': '朗读已过期，请重新点击喇叭'})
    owner, text, _ = ticket
    key = (owner, hashlib.sha256(text.encode('utf-8')).digest())
    headers = {'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'Accept-Ranges': 'none'}
    if key in _warming:
        await asyncio.shield(_warming[key])
    if (cached := _cached(key)) is not None:
        return Response(cached, media_type='audio/mpeg', headers=headers)
    stream = streamer(text)
    try:
        first = await anext(stream)
        audio_response(first)  # Reject invalid/empty audio before sending HTTP 200.
    except HTTPException:
        await stream.aclose()
        raise
    except (OSError, RuntimeError, subprocess.SubprocessError, StopAsyncIteration):
        await stream.aclose()
        raise HTTPException(503, detail={'code': 'SPEECH_UNAVAILABLE', 'message': '语音连接失败，请点击喇叭重试'}) from None

    async def body():
        audio = bytearray(first)
        try:
            yield first
            async for part in stream:
                audio.extend(part)
                if len(audio) > MAX_AUDIO_BYTES:
                    raise RuntimeError('audio exceeds size limit')
                yield part
            _remember(key, bytes(audio))
        finally:
            await stream.aclose()
    return StreamingResponse(body(), media_type='audio/mpeg', headers=headers, background=BackgroundTask(stream.aclose))


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
