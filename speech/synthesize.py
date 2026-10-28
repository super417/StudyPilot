"""Read one selected reply from stdin; emit Xiaoxiao MP3 without saving text."""
import asyncio
import socket
import sys

import aiohttp
import edge_tts
from edge_tts.exceptions import EdgeTTSException, NoAudioReceived


async def synthesize():
    text = sys.stdin.buffer.read(4096).decode('utf-8').strip()
    if not text or len(text) > 300:
        raise ValueError('invalid speech text length')
    streaming = '--stream' in sys.argv[1:]
    emitted = False
    for attempt in range(3):
        try:
            audio = bytearray()
            async with aiohttp.TCPConnector(family=socket.AF_INET) as connector:
                speech = edge_tts.Communicate(
                    text, 'zh-CN-XiaoxiaoNeural', connector=connector,
                    connect_timeout=5, receive_timeout=10,
                )
                async for chunk in speech.stream():
                    if chunk['type'] == 'audio':
                        audio.extend(chunk['data'])
                        if len(audio) > 8 * 1024 * 1024:
                            raise RuntimeError('audio exceeds size limit')
                        if streaming:
                            sys.stdout.buffer.write(chunk['data'])
                            sys.stdout.buffer.flush()
                            emitted = True
            if not audio:
                raise NoAudioReceived('empty speech audio')
            if not streaming:
                sys.stdout.buffer.write(audio)
            return
        except (aiohttp.ClientError, OSError, EdgeTTSException):
            if emitted or attempt == 2:
                raise
            await asyncio.sleep(0.25)


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(synthesize(), timeout=45))
