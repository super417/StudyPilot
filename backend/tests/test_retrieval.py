"""BM25 retrieval: Chinese bigrams, English tokens, and empty misses."""

import base64
import os
import unittest
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import User, UserDocument
from app.services.document_service import build_context
from app.services.retrieval import rank, tokenize


def _chunk(doc_id: str, index: int, content: str) -> dict:
    return {
        "doc_id": doc_id,
        "filename": f"{doc_id}.txt",
        "chunk_index": index,
        "content": content,
    }


class RetrievalRankTests(unittest.TestCase):
    def test_min_coverage_rejects_generic_overlap(self) -> None:
        chunks = [_chunk("algorithm", 0, "二分查找的常见错误有 5 类")]
        self.assertEqual(
            rank("请列出资产负债表中5个常见项目。", chunks, min_coverage=0.25),
            [],
        )
        self.assertEqual(
            len(rank("二分查找有哪些常见错误？", chunks, min_coverage=0.25)),
            1,
        )

    def test_chinese_bigram_ranks_the_overlapping_chunk_first(self) -> None:
        self.assertEqual(tokenize("中值定理"), ["中值", "值定", "定理"])
        chunks = [
            _chunk("notes", 0, "今天学习线性代数"),
            _chunk("notes", 1, "中值定理的应用"),
        ]
        ranked = rank("中值定理", chunks)
        self.assertGreaterEqual(len(ranked), 1)
        self.assertEqual(ranked[0][0]["chunk_index"], 1)
        self.assertGreater(ranked[0][1], 0)

    def test_english_tokens_are_case_insensitive(self) -> None:
        chunks = [
            _chunk("en", 0, "unrelated topic"),
            _chunk("en", 1, "retrieval methods"),
        ]
        ranked = rank("Retrieval", chunks)
        self.assertEqual([item[0]["chunk_index"] for item in ranked], [1])

    def test_no_overlap_returns_empty(self) -> None:
        chunks = [_chunk("notes", 0, "中值定理的应用")]
        self.assertEqual(rank("???", chunks), [])
        self.assertEqual(rank("zzzz", chunks), [])
        self.assertEqual(rank("", chunks), [])

    def test_same_input_is_stable_and_ties_break_by_doc_and_index(self) -> None:
        chunks = [
            _chunk("b", 0, "线性代数入门"),
            _chunk("a", 2, "线性代数入门"),
            _chunk("a", 1, "线性代数入门"),
        ]
        first = rank("线性代数", chunks)
        second = rank("线性代数", chunks)
        self.assertEqual(first, second)
        self.assertEqual(
            [(item[0]["doc_id"], item[0]["chunk_index"]) for item in first],
            [("a", 1), ("a", 2), ("b", 0)],
        )
        self.assertEqual(len({item[1] for item in first}), 1)


class BuildContextQueryTests(unittest.TestCase):
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
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(cls.engine)
        cls.session_factory = sessionmaker(
            bind=cls.engine, class_=Session, expire_on_commit=False
        )

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(cls.engine)
        cls.engine.dispose()
        get_cipher.cache_clear()
        get_settings.cache_clear()
        for name, value in cls._environment.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def setUp(self) -> None:
        self.session = self.session_factory()
        self.user = User(
            id=uuid.uuid4(),
            username=f"ret-{uuid.uuid4().hex[:12]}",
            password_hash="x" * 20,
        )
        self.session.add(self.user)
        self.session.add(
            UserDocument(
                user_id=self.user.id,
                doc_id="docA",
                filename="docA.txt",
                file_type="txt",
                chunk_index=0,
                content="中值定理的应用写在这一段",
            )
        )
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()

    def test_empty_query_does_not_concatenate_every_chunk(self) -> None:
        text, hits = build_context(self.session, self.user.id, ["docA"], "")
        self.assertEqual(text, "")
        self.assertEqual(hits, [])
        self.assertNotIn("中值定理", text)
