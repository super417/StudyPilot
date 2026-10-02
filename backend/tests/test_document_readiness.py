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
from app.services.document_service import (
    filter_ready_documents,
    retrieve_document_chunks,
)


class DocumentReadinessTests(unittest.TestCase):
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
        self.session.query(UserDocument).delete()
        self.session.query(User).delete()
        self.session.commit()
        self.user = User(
            id=uuid.uuid4(),
            username=f"rd-{uuid.uuid4().hex[:12]}",
            password_hash="x" * 20,
        )
        self.other = User(
            id=uuid.uuid4(),
            username=f"other-{uuid.uuid4().hex[:12]}",
            password_hash="x" * 20,
        )
        self.session.add_all([self.user, self.other])
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()

    def _add(self, user_id, doc_id: str, chunks: list[str]) -> None:
        for index, chunk in enumerate(chunks):
            self.session.add(
                UserDocument(
                    user_id=user_id,
                    doc_id=doc_id,
                    filename=f"{doc_id}.txt",
                    file_type="txt",
                    chunk_index=index,
                    content=chunk,
                )
            )
        self.session.commit()

    def test_ready_vs_skipped_split(self) -> None:
        self._add(self.user.id, "docA", ["a0"])
        self._add(self.other.id, "docB", ["b0"])  # belongs to another user

        ready, skipped = filter_ready_documents(
            self.session, self.user.id, ["docA", "docB", "docC"]
        )
        self.assertEqual(ready, ["docA"])
        self.assertEqual(skipped, ["docB", "docC"])

    def test_order_preserved_and_duplicates_collapsed(self) -> None:
        self._add(self.user.id, "d1", ["x"])
        self._add(self.user.id, "d2", ["y"])

        ready, skipped = filter_ready_documents(
            self.session, self.user.id, ["d2", "d1", "d2", "gap", "gap"]
        )
        self.assertEqual(ready, ["d2", "d1"])
        self.assertEqual(skipped, ["gap"])

    def test_empty_input_returns_empty_pair(self) -> None:
        self.assertEqual(filter_ready_documents(self.session, self.user.id, None), ([], []))
        self.assertEqual(filter_ready_documents(self.session, self.user.id, []), ([], []))

    def test_retrieve_orders_by_chunk_index_and_isolates_users(self) -> None:
        # Insert out of order to prove ordering is by chunk_index, not insertion.
        self.session.add_all(
            [
                UserDocument(
                    user_id=self.user.id,
                    doc_id="docA",
                    filename="docA.txt",
                    file_type="txt",
                    chunk_index=2,
                    content="third",
                ),
                UserDocument(
                    user_id=self.user.id,
                    doc_id="docA",
                    filename="docA.txt",
                    file_type="txt",
                    chunk_index=0,
                    content="first",
                ),
                UserDocument(
                    user_id=self.user.id,
                    doc_id="docA",
                    filename="docA.txt",
                    file_type="txt",
                    chunk_index=1,
                    content="second",
                ),
            ]
        )
        # Another user owns a different document; it must never leak into the
        # target user's retrieved context.
        self._add(self.other.id, "docOther", ["OTHER-SECRET"])
        self.session.commit()

        text = retrieve_document_chunks(self.session, self.user.id, ["docA"])
        self.assertEqual(text, "first\nsecond\nthird")
        self.assertNotIn("OTHER-SECRET", text)
        # Requesting the other user's doc id yields nothing for this user.
        self.assertEqual(
            retrieve_document_chunks(self.session, self.user.id, ["docOther"]), ""
        )

    def test_retrieve_empty_when_no_doc_ids(self) -> None:
        self.assertEqual(retrieve_document_chunks(self.session, self.user.id, []), "")
        self.assertEqual(
            retrieve_document_chunks(self.session, self.user.id, None), ""
        )

    def test_retrieve_truncates_to_max_chars(self) -> None:
        self._add(self.user.id, "docA", ["abcdefghij"])
        text = retrieve_document_chunks(
            self.session, self.user.id, ["docA"], max_chars=4
        )
        self.assertEqual(text, "abcd")


if __name__ == "__main__":
    unittest.main()
