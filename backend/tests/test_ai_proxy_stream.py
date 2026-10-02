import asyncio
import json
import unittest
from contextlib import asynccontextmanager

from app.services.ai_proxy import (
    FIRST_CHUNK_TIMEOUT_SECONDS,
    SSE_DONE_EVENT,
    SSE_ERROR_EVENT,
    SSE_TOKEN_EVENT,
    format_sse,
    stream_ai_sse,
)

# A "key-shaped" string that must never appear in any error frame.
SECRET_LOOKING = "sk-secret-should-never-leak-9999"


class _FakeStream:
    """A controlled async chunk stream that records when it is closed.

    ``chunks`` are yielded in order. ``first_delay`` lets a test simulate an
    upstream that stalls before producing the first chunk (for timeout tests).
    """

    def __init__(self, chunks, *, first_delay=0.0, raise_on=None):
        self._chunks = list(chunks)
        self._first_delay = first_delay
        self._raise_on = raise_on
        self._index = 0
        self.closed_count = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index == 0 and self._first_delay:
            await asyncio.sleep(self._first_delay)
        if self._raise_on is not None and self._index == self._raise_on:
            raise RuntimeError("upstream boom")
        if self._index >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk


def _fake_factory(stream: _FakeStream):
    """Build an async context manager that flags closure on exit."""

    @asynccontextmanager
    async def _factory():
        try:
            yield stream
        finally:
            stream.closed_count += 1

    return _factory


def _parse_frames(text: str):
    """Split an SSE payload into (event, data-dict) tuples."""
    frames = []
    for block in filter(None, (b.strip() for b in text.split("\n\n"))):
        event = None
        data = None
        for line in block.split("\n"):
            if line.startswith("event: "):
                event = line[len("event: ") :]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: ") :])
        frames.append((event, data))
    return frames


async def _collect(gen):
    return [frame async for frame in gen]


class FormatSseTests(unittest.TestCase):
    def test_format_sse_shape_and_unicode(self) -> None:
        frame = format_sse(SSE_TOKEN_EVENT, {"delta": "你好"})
        self.assertEqual(frame, 'event: token\ndata: {"delta": "你好"}\n\n')

    def test_format_sse_rejects_unknown_event(self) -> None:
        with self.assertRaises(ValueError):
            format_sse("bogus", {})


class StreamAiSseTests(unittest.IsolatedAsyncioTestCase):
    async def test_normal_stream_emits_tokens_then_done(self) -> None:
        stream = _FakeStream(["你", "好"])
        frames = _parse_frames(
            "".join(await _collect(stream_ai_sse(_fake_factory(stream))))
        )

        self.assertEqual(
            frames,
            [
                (SSE_TOKEN_EVENT, {"delta": "你"}),
                (SSE_TOKEN_EVENT, {"delta": "好"}),
                (SSE_DONE_EVENT, {"finish": "stop"}),
            ],
        )
        self.assertEqual(stream.closed_count, 1)

    async def test_first_chunk_timeout_emits_only_error(self) -> None:
        # first_delay exceeds the small timeout so wait_for trips.
        stream = _FakeStream(["late"], first_delay=1.0)
        frames = _parse_frames(
            "".join(
                await _collect(
                    stream_ai_sse(_fake_factory(stream), timeout=0.05)
                )
            )
        )

        self.assertEqual(len(frames), 1)
        event, data = frames[0]
        self.assertEqual(event, SSE_ERROR_EVENT)
        self.assertEqual(data["code"], "AI_TIMEOUT")
        self.assertIn("超时", data["message"])
        # Upstream stream must have been closed on the timeout path.
        self.assertEqual(stream.closed_count, 1)

    async def test_default_timeout_is_thirty_seconds(self) -> None:
        self.assertEqual(FIRST_CHUNK_TIMEOUT_SECONDS, 30)

    async def test_disconnect_before_first_chunk_yields_nothing(self) -> None:
        stream = _FakeStream(["never"])
        frames = await _collect(
            stream_ai_sse(_fake_factory(stream), is_disconnected=lambda: True)
        )

        self.assertEqual(frames, [])
        self.assertEqual(stream.closed_count, 1)

    async def test_disconnect_after_first_chunk_stops_and_no_done(self) -> None:
        stream = _FakeStream(["a", "b", "c"])
        # Disconnect becomes true only after the first token has been yielded.
        calls = {"n": 0}

        async def probe():
            calls["n"] += 1
            return calls["n"] > 1

        frames = _parse_frames(
            "".join(
                await _collect(
                    stream_ai_sse(_fake_factory(stream), is_disconnected=probe)
                )
            )
        )

        self.assertEqual(frames, [(SSE_TOKEN_EVENT, {"delta": "a"})])
        # No done frame after a disconnect.
        self.assertNotIn(SSE_DONE_EVENT, {event for event, _ in frames})
        self.assertEqual(stream.closed_count, 1)

    async def test_upstream_error_becomes_safe_error_frame(self) -> None:
        # Upstream raises while producing the second chunk; secret embedded to
        # prove nothing internal leaks into the client frame.
        stream = _FakeStream([SECRET_LOOKING, "second"], raise_on=1)
        frames = _parse_frames(
            "".join(await _collect(stream_ai_sse(_fake_factory(stream))))
        )

        self.assertEqual(frames[0], (SSE_TOKEN_EVENT, {"delta": SECRET_LOOKING}))
        event, data = frames[-1]
        self.assertEqual(event, SSE_ERROR_EVENT)
        self.assertEqual(data["code"], "AI_STREAM_ERROR")
        self.assertEqual(stream.closed_count, 1)

    async def test_error_frames_never_contain_secret_material(self) -> None:
        stream = _FakeStream([SECRET_LOOKING], first_delay=1.0)
        serialized = "".join(
            await _collect(stream_ai_sse(_fake_factory(stream), timeout=0.05))
        )
        self.assertNotIn(SECRET_LOOKING, serialized)

    async def test_stream_always_closed_on_normal_path(self) -> None:
        stream = _FakeStream(["x"])
        await _collect(stream_ai_sse(_fake_factory(stream)))
        self.assertEqual(stream.closed_count, 1)


if __name__ == "__main__":
    unittest.main()
