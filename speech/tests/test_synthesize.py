"""Streaming must emit early and must never replay partially spoken audio."""
import asyncio
import importlib.util
import io
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('voice_client', Path(__file__).resolve().parents[1] / 'synthesize.py')
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class StreamingClientTests(unittest.IsolatedAsyncioTestCase):
    async def run_client(self, speech, streaming=True):
        output = io.BytesIO()
        with patch.object(client.edge_tts, 'Communicate', side_effect=speech), \
             patch.object(client.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO('中性测试。'.encode()))), \
             patch.object(client.sys, 'stdout', SimpleNamespace(buffer=output)), \
             patch.object(sys, 'argv', ['synthesize.py'] + (['--stream'] if streaming else [])):
            await client.synthesize()
        return output.getvalue()

    async def test_stream_flushes_before_the_provider_finishes(self):
        output = io.BytesIO()
        flushed = []

        async def stream():
            yield {'type': 'audio', 'data': b'ID3first'}
            flushed.append(output.getvalue())
            yield {'type': 'audio', 'data': b'second'}
        with patch.object(client.edge_tts, 'Communicate', return_value=SimpleNamespace(stream=stream)), \
             patch.object(client.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(b'test'))), \
             patch.object(client.sys, 'stdout', SimpleNamespace(buffer=output)), \
             patch.object(sys, 'argv', ['synthesize.py', '--stream']):
            await client.synthesize()
        self.assertEqual(flushed, [b'ID3first'])
        self.assertEqual(output.getvalue(), b'ID3firstsecond')

    async def test_connection_failure_before_audio_is_retried(self):
        attempts = []

        def speech(*args, **kwargs):
            attempts.append(True)
            async def stream():
                if len(attempts) == 1:
                    raise OSError('connection reset')
                yield {'type': 'audio', 'data': b'ID3success'}
            return SimpleNamespace(stream=stream)
        self.assertEqual(await self.run_client(speech), b'ID3success')
        self.assertEqual(len(attempts), 2)

    async def test_failure_after_audio_never_restarts_the_spoken_beginning(self):
        async def stream():
            yield {'type': 'audio', 'data': b'ID3first'}
            raise OSError('connection reset')
        speech = lambda *args, **kwargs: SimpleNamespace(stream=stream)
        with patch.object(client.edge_tts, 'Communicate', side_effect=speech) as communicate:
            with self.assertRaises(OSError):
                await self.run_client(communicate)
            self.assertEqual(communicate.call_count, 1)


if __name__ == '__main__':
    unittest.main()
