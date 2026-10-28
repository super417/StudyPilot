"""Natural voice cache, authentication, limits and opt-in boundary."""
import base64
import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import subprocess
import io
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.routers.dependencies import AuthenticationRequiredError, get_current_user
from app.routers.speech import get_speech_synthesizer, router, synthesize_selected_reply
from app.routers import speech

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
        self.assertEqual(run.call_args.kwargs['timeout'], 50)

    async def test_failed_synthesis_releases_the_concurrency_slot(self):
        slots = asyncio.Semaphore(1)
        with patch('pathlib.Path.is_file', return_value=True), \
             patch('app.routers.speech._speech_slots', slots), \
             patch('app.routers.speech.subprocess.run', side_effect=subprocess.TimeoutExpired('client', 25)):
            with self.assertRaises(subprocess.TimeoutExpired):
                await synthesize_selected_reply('朗读')
        await asyncio.wait_for(slots.acquire(), timeout=0.1)
        slots.release()


class StreamingSpeechTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        speech._tickets.clear()
        speech._audio_cache.clear()
        speech._cache_bytes = 0
        speech._warming.clear()
        self.user = SimpleNamespace(id='first-user')
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.inputs = []

        async def stream(text):
            self.inputs.append(text)
            yield AUDIO
            yield b'remainder'
        self.stream = stream
        self.app.dependency_overrides[speech.get_speech_streamer] = lambda: self.stream
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        speech._tickets.clear()
        speech._audio_cache.clear()
        speech._cache_bytes = 0
        speech._warming.clear()

    def ticket(self, text='只读正文'):
        result = self.client.post('/api/speech/playback', json={'text': text})
        self.assertEqual(result.status_code, 200)
        return result.json()['audioPath']

    async def test_ticket_creation_sends_no_text_until_audio_is_requested(self):
        path = self.ticket()
        self.assertEqual(self.inputs, [])
        self.assertNotIn('正文', path)
        result = self.client.get(path)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.content, AUDIO + b'remainder')
        self.assertEqual(result.headers['content-type'], 'audio/mpeg')
        self.assertEqual(self.inputs, ['只读正文'])

    async def test_replay_and_cross_panel_ticket_use_only_this_users_cached_audio(self):
        self.client.get(self.ticket())
        self.client.get(self.ticket())
        self.assertEqual(len(self.inputs), 1)
        self.user = SimpleNamespace(id='second-user')
        self.client.get(self.ticket())
        self.assertEqual(len(self.inputs), 2)

    async def test_prewarm_generates_body_without_playing_and_click_uses_ready_audio(self):
        result = self.client.post('/api/speech/prewarm', json={'text': '新回复正文'})
        self.assertEqual(result.json(), {'ready': True})
        self.assertEqual(self.inputs, ['新回复正文'])
        result = self.client.get(self.ticket('新回复正文'))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.content, AUDIO + b'remainder')
        self.assertEqual(self.inputs, ['新回复正文'])

    async def test_prewarm_failure_does_not_block_later_manual_speech(self):
        original_stream = self.stream
        async def fail(text):
            raise OSError('private network trace')
            yield b''
        self.stream = fail
        result = self.client.post('/api/speech/prewarm', json={'text': '新回复正文'})
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('private', result.text)
        self.assertFalse(speech._warming)
        self.assertFalse(speech._audio_cache)
        self.stream = original_stream
        self.assertEqual(self.client.get(self.ticket('新回复正文')).status_code, 200)

    async def test_other_users_expired_and_missing_tickets_never_synthesize(self):
        path = self.ticket()
        self.user = SimpleNamespace(id='second-user')
        self.assertEqual(self.client.get(path).status_code, 404)
        self.user = SimpleNamespace(id='first-user')
        token = path.rsplit('/', 1)[1]
        owner, text, _ = speech._tickets[token]
        speech._tickets[token] = (owner, text, 0)
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.get('/api/speech/playback/missing').status_code, 404)
        self.assertEqual(self.inputs, [])

    async def test_audio_and_ticket_endpoints_require_authentication(self):
        path = self.ticket()
        def refuse():
            raise AuthenticationRequiredError()
        self.app.dependency_overrides[get_current_user] = refuse
        with self.assertRaises(AuthenticationRequiredError):
            self.client.get(path)
        with self.assertRaises(AuthenticationRequiredError):
            self.client.post('/api/speech/playback', json={'text': '正文'})
        with self.assertRaises(AuthenticationRequiredError):
            self.client.post('/api/speech/prewarm', json={'text': '正文'})
        self.assertEqual(self.inputs, [])

    async def test_failure_before_audio_is_safe_and_does_not_poison_the_cache(self):
        async def fail(text):
            raise RuntimeError('private upstream trace')
            yield b''
        self.stream = fail
        result = self.client.get(self.ticket())
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('private', result.text)
        self.assertFalse(speech._audio_cache)

    async def test_first_audio_can_be_consumed_before_synthesis_finishes(self):
        path = self.ticket()
        proceed = asyncio.Event()
        closed = []

        async def delayed(text):
            try:
                yield AUDIO
                await proceed.wait()
                yield b'remainder'
            finally:
                closed.append(True)
        response = await speech.playback_audio(path.rsplit('/', 1)[1], self.user, delayed)
        iterator = response.body_iterator
        self.assertEqual(await asyncio.wait_for(anext(iterator), timeout=.1), AUDIO)
        self.assertFalse(proceed.is_set())
        self.assertFalse(speech._audio_cache)
        proceed.set()
        self.assertEqual(await anext(iterator), b'remainder')
        with self.assertRaises(StopAsyncIteration):
            await anext(iterator)
        self.assertTrue(closed)
        self.assertEqual(len(speech._audio_cache), 1)

    async def test_cancelling_stream_closes_transport_and_does_not_cache_partial_audio(self):
        path = self.ticket()
        closed = []

        async def delayed(text):
            try:
                yield AUDIO
                yield b'remainder'
            finally:
                closed.append(True)
        response = await speech.playback_audio(path.rsplit('/', 1)[1], self.user, delayed)
        await anext(response.body_iterator)
        await response.body_iterator.aclose()
        self.assertTrue(closed)
        self.assertFalse(speech._audio_cache)

    async def test_cache_is_bounded_and_expires(self):
        with patch.object(speech, 'CACHE_LIMIT', 80):
            speech._remember(('first-user', b'1'), AUDIO)
            speech._remember(('first-user', b'2'), AUDIO)
            speech._remember(('first-user', b'3'), AUDIO)
        self.assertLessEqual(speech._cache_bytes, 80)
        self.assertIsNone(speech._cached(('first-user', b'1')))
        with patch.object(speech.time, 'monotonic', return_value=10**12):
            self.assertIsNone(speech._cached(('first-user', b'3')))
        self.assertEqual(speech._cache_bytes, 0)

    async def test_worker_is_killed_and_slot_released_when_playback_stops(self):
        process = Mock()
        process.stdin = io.BytesIO()
        process.stdout = io.BytesIO(AUDIO + bytes(8000))
        process.poll.return_value = None
        process.wait.return_value = 0
        slots = asyncio.Semaphore(1)
        with patch('pathlib.Path.is_file', return_value=True), \
             patch.object(speech, '_speech_slots', slots), \
             patch.object(speech.subprocess, 'Popen', return_value=process) as popen:
            iterator = speech.stream_selected_reply('选中的正文')
            self.assertTrue(await anext(iterator))
            await iterator.aclose()
        process.kill.assert_called_once()
        self.assertTrue(process.stdout.closed)
        self.assertEqual(popen.call_args.args[0][-1], '--stream')
        self.assertNotIn('选中的正文', str(popen.call_args.args))
        await asyncio.wait_for(slots.acquire(), timeout=.1)
        slots.release()
