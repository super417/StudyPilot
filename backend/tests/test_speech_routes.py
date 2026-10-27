"""Natural voice cache, authentication, limits and opt-in boundary."""
import base64
import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import subprocess
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.routers.dependencies import AuthenticationRequiredError, get_current_user
from app.routers.speech import get_speech_synthesizer, router, synthesize_selected_reply

AUDIO = b'ID3' + bytes(32)


class SpeechRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_current_user] = lambda: object()
        self.inputs = []
        self.audio = AUDIO
        self.error = None
        output = Path(__file__).resolve().parents[2] / 'speech/output'
        output.mkdir(parents=True, exist_ok=True)
        self.temp = TemporaryDirectory(dir=output)
        self.greeting = Path(self.temp.name) / 'greeting.mp3'
        self.greeting.write_bytes(AUDIO)
        self.patch = patch('app.routers.speech.GREETING_PATH', self.greeting)
        self.patch.start()

        async def synth(text):
            self.inputs.append(text)
            if self.error:
                raise self.error
            return self.audio
        self.app.dependency_overrides[get_speech_synthesizer] = lambda: synth
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.patch.stop()
        self.temp.cleanup()

    def test_speech_requires_authentication(self):
        def refuse():
            raise AuthenticationRequiredError()
        self.app.dependency_overrides[get_current_user] = refuse
        with self.assertRaises(AuthenticationRequiredError):
            self.client.get('/api/speech/greeting')
        self.assertEqual(self.inputs, [])

    def test_cached_greeting_never_sends_text_to_a_provider(self):
        result = self.client.get('/api/speech/greeting')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['voice'], 'Xiaoxiao')
        self.assertEqual(result.json()['mimeType'], 'audio/mpeg')
        self.assertEqual(base64.b64decode(result.json()['audioBase64']), AUDIO)
        self.assertEqual(self.inputs, [])

    def test_reply_is_disabled_without_an_authorized_transport(self):
        self.app.dependency_overrides[get_speech_synthesizer] = lambda: None
        result = self.client.post('/api/speech/synthesize', json={'text': '尚未授权的回复'})
        self.assertEqual(result.status_code, 503)
        self.assertEqual(result.json()['detail']['code'], 'SPEECH_NOT_ENABLED')
        self.assertEqual(self.inputs, [])

    def test_injected_reply_transport_receives_only_trimmed_text(self):
        result = self.client.post('/api/speech/synthesize', json={'text': '  学习加油  '})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.inputs, ['学习加油'])

    def test_empty_or_excessive_text_is_rejected_before_synthesis(self):
        for text in ['', '   ', '学' * 301]:
            result = self.client.post('/api/speech/synthesize', json={'text': text})
            self.assertEqual(result.status_code, 422)
        self.assertEqual(self.inputs, [])

    def test_failure_does_not_expose_internal_details(self):
        self.error = RuntimeError('private provider trace')
        result = self.client.post('/api/speech/synthesize', json={'text': '朗读'})
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('private', result.text)

    def test_subprocess_timeout_is_a_safe_recoverable_error(self):
        self.error = subprocess.TimeoutExpired('private local command', 25)
        result = self.client.post('/api/speech/synthesize', json={'text': '朗读'})
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('private', result.text)

    def test_missing_greeting_is_explicitly_unavailable(self):
        self.greeting.unlink()
        self.assertEqual(self.client.get('/api/speech/greeting').status_code, 503)
        self.assertEqual(self.inputs, [])

    def test_invalid_or_oversized_audio_is_rejected(self):
        for audio in [b'not audio', b'ID3' + bytes(8 * 1024 * 1024)]:
            self.audio = audio
            result = self.client.post('/api/speech/synthesize', json={'text': '朗读'})
            self.assertEqual(result.status_code, 503)


class SelectedReplyTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_selected_text_is_passed_on_stdin_without_a_shell(self):
        result = subprocess.CompletedProcess([], 0, stdout=AUDIO)
        with patch('pathlib.Path.is_file', return_value=True), \
             patch('app.routers.speech._speech_slots', asyncio.Semaphore(1)), \
             patch('app.routers.speech.subprocess.run', return_value=result) as run:
            audio = await synthesize_selected_reply('仅朗读这一条回复')
        self.assertEqual(audio, AUDIO)
        self.assertEqual(run.call_args.kwargs['input'], '仅朗读这一条回复'.encode('utf-8'))
        self.assertNotIn('shell', run.call_args.kwargs)
        self.assertTrue(run.call_args.kwargs['check'])
        self.assertEqual(run.call_args.kwargs['timeout'], 25)

    async def test_failed_synthesis_releases_the_concurrency_slot(self):
        slots = asyncio.Semaphore(1)
        with patch('pathlib.Path.is_file', return_value=True), \
             patch('app.routers.speech._speech_slots', slots), \
             patch('app.routers.speech.subprocess.run', side_effect=subprocess.TimeoutExpired('client', 25)):
            with self.assertRaises(subprocess.TimeoutExpired):
                await synthesize_selected_reply('朗读')
        await asyncio.wait_for(slots.acquire(), timeout=0.1)
        slots.release()
