"""Property tests for mistakes badge and document chunking (tasks 21.3 / 17.2).

Feature: study-pilot, Property 9 — pending badge equals pending count
Feature: study-pilot, Property 15 — chunk size / overlap / reassembly
Feature: study-pilot, Property 16 — empty parse writes nothing
"""

from __future__ import annotations

import base64
import os
import unittest
import uuid

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import Mistake, User, UserDocument
from app.services import mistake_service
from app.services.document_service import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    DocumentParseError,
    chunk_text,
    store_document,
)

PROPERTY_SETTINGS = settings(
    max_examples=120,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


def _engine_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    return engine, factory()


_statuses = st.sampled_from(["pending", "scheduled", "done"])


class MistakeBadgePropertyTests(unittest.TestCase):
    """Feature: study-pilot, Property 9"""

    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY")
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
        get_settings.cache_clear()
        get_cipher.cache_clear()

    @classmethod
    def tearDownClass(cls) -> None:
        get_cipher.cache_clear()
        get_settings.cache_clear()
        for name, value in cls._environment.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    @PROPERTY_SETTINGS
    @given(st.lists(_statuses, min_size=0, max_size=40))
    def test_property_9_pending_badge_equals_pending_count(self, statuses: list[str]) -> None:
        # Feature: study-pilot, Property 9: 待复习角标等于 pending 错题数
        engine, session = _engine_session()
        try:
            user = User(username=f"u-{uuid.uuid4().hex[:10]}", password_hash="x")
            session.add(user)
            session.commit()
            for i, status in enumerate(statuses):
                session.add(
                    Mistake(
                        user_id=user.id,
                        question=f"q-{i}",
                        review_status=status,
                    )
                )
            session.commit()
            _mistakes, pending = mistake_service.list_mistakes(session, user.id)
            expected = sum(1 for s in statuses if s == "pending")
            self.assertEqual(pending, expected)
        finally:
            session.close()
            Base.metadata.drop_all(engine)
            engine.dispose()


class DocumentChunkPropertyTests(unittest.TestCase):
    """Feature: study-pilot, Property 15 / 16"""

    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY")
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
        get_settings.cache_clear()
        get_cipher.cache_clear()

    @classmethod
    def tearDownClass(cls) -> None:
        get_cipher.cache_clear()
        get_settings.cache_clear()
        for name, value in cls._environment.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    @PROPERTY_SETTINGS
    @given(st.text(min_size=1, max_size=4000))
    def test_property_15_chunk_bounds_overlap_and_reassembly(self, text: str) -> None:
        # Feature: study-pilot, Property 15: 文本切块正确性与覆盖完整原文
        if not text.strip():
            self.assertEqual(chunk_text(text), [])
            return
        chunks = chunk_text(text)
        self.assertTrue(chunks)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), CHUNK_SIZE)
            self.assertTrue(chunk)
        for earlier, later in zip(chunks, chunks[1:]):
            self.assertEqual(earlier[-CHUNK_OVERLAP:], later[:CHUNK_OVERLAP])
        restored = chunks[0]
        for chunk in chunks[1:]:
            restored += chunk[CHUNK_OVERLAP:]
        self.assertEqual(restored, text)

    @PROPERTY_SETTINGS
    @given(st.sampled_from(["", "   ", "\n\t  ", "\r\n"]))
    def test_property_16_empty_text_writes_nothing(self, blank: str) -> None:
        # Feature: study-pilot, Property 16: 解析失败/空文本的写入原子性
        engine, session = _engine_session()
        try:
            user = User(username=f"d-{uuid.uuid4().hex[:10]}", password_hash="x")
            session.add(user)
            session.commit()
            with self.assertRaises(DocumentParseError):
                store_document(session, user.id, "blank.txt", blank.encode("utf-8"))
            rows = list(
                session.scalars(
                    select(UserDocument).where(UserDocument.user_id == user.id)
                )
            )
            self.assertEqual(rows, [])
        finally:
            session.close()
            Base.metadata.drop_all(engine)
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
