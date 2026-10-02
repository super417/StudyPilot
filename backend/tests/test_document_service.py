import base64
import os
import unittest
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import User, UserDocument
from app.services import document_service
from app.services.document_service import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    DocumentParseError,
    UnsupportedFileTypeError,
    chunk_text,
    detect_file_type,
    parse_document,
    store_document,
)


class DetectFileTypeTests(unittest.TestCase):
    def test_supported_extensions_normalize_to_lowercase(self) -> None:
        self.assertEqual(detect_file_type("notes.PDF"), "pdf")
        self.assertEqual(detect_file_type("paper.docx"), "docx")
        self.assertEqual(detect_file_type("plan.TXT"), "txt")
        self.assertEqual(detect_file_type("readme.md"), "md")

    def test_unsupported_or_missing_extension_raises(self) -> None:
        for name in ("archive.zip", "legacy.doc", "slides.ppt", "noextension"):
            with self.subTest(name=name):
                with self.assertRaises(UnsupportedFileTypeError) as error:
                    detect_file_type(name)
                self.assertEqual(error.exception.code, "UNSUPPORTED_TYPE")


class ChunkTextTests(unittest.TestCase):
    def _reassemble(self, chunks: list[str]) -> str:
        if not chunks:
            return ""
        restored = chunks[0]
        for chunk in chunks[1:]:
            restored += chunk[CHUNK_OVERLAP:]
        return restored

    def test_empty_or_whitespace_text_returns_empty_list(self) -> None:
        self.assertEqual(chunk_text(""), [])
        self.assertEqual(chunk_text("   \n\t  "), [])

    def test_short_text_returns_single_chunk(self) -> None:
        text = "a" * 500
        chunks = chunk_text(text)
        self.assertEqual(chunks, [text])

    def test_text_equal_to_size_returns_single_chunk(self) -> None:
        text = "a" * CHUNK_SIZE
        self.assertEqual(chunk_text(text), [text])

    def test_long_text_produces_multiple_overlapping_chunks(self) -> None:
        text = "".join(str(i % 10) for i in range(2500))
        chunks = chunk_text(text)

        self.assertGreater(len(chunks), 1)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), CHUNK_SIZE)
            self.assertTrue(chunk)
        # Adjacent chunks overlap by exactly CHUNK_OVERLAP characters.
        for earlier, later in zip(chunks, chunks[1:]):
            self.assertEqual(earlier[-CHUNK_OVERLAP:], later[:CHUNK_OVERLAP])
        # De-overlapped concatenation restores the original text.
        self.assertEqual(self._reassemble(chunks), text)

    def test_reassembly_holds_for_various_lengths(self) -> None:
        for length in (1, 799, 800, 801, 1000, 1001, 1800, 5000):
            with self.subTest(length=length):
                text = "x" * length
                chunks = chunk_text(text)
                self.assertEqual(self._reassemble(chunks), text)
                for chunk in chunks:
                    self.assertLessEqual(len(chunk), CHUNK_SIZE)


class ParseDocumentTests(unittest.TestCase):
    def test_txt_and_md_decode_utf8_and_strip(self) -> None:
        payload = "  你好，StudyPilot  ".encode("utf-8")
        self.assertEqual(parse_document("txt", payload), "你好，StudyPilot")
        self.assertEqual(parse_document("md", payload), "你好，StudyPilot")

    def test_utf8_bom_is_tolerated(self) -> None:
        payload = "hello".encode("utf-8-sig")  # prepends a UTF-8 BOM
        self.assertEqual(parse_document("txt", payload), "hello")

    def test_invalid_utf8_raises_parse_failed(self) -> None:
        with self.assertRaises(DocumentParseError) as error:
            parse_document("txt", b"\xff\xfe\x00\x01bad")
        self.assertEqual(error.exception.code, "PARSE_FAILED")

    def test_pdf_parser_failure_maps_to_parse_failed(self) -> None:
        # Not a real PDF; the underlying library failure must be normalized.
        with self.assertRaises(DocumentParseError) as error:
            parse_document("pdf", b"not a real pdf payload")
        self.assertEqual(error.exception.code, "PARSE_FAILED")

    def test_docx_parser_failure_maps_to_parse_failed(self) -> None:
        with self.assertRaises(DocumentParseError) as error:
            parse_document("docx", b"not a real docx payload")
        self.assertEqual(error.exception.code, "PARSE_FAILED")


class StoreDocumentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in (
                "DATABASE_URL",
                "DB_PASSWORD",
                "AES_KEY",
                "SESSION_TIMEOUT_MINUTES",
            )
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
        os.environ["SESSION_TIMEOUT_MINUTES"] = "30"
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
            username=f"doc-{uuid.uuid4().hex[:12]}",
            password_hash="placeholder-password-hash",
        )
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()

    def _rows(self) -> list[UserDocument]:
        self.session.expire_all()
        return list(
            self.session.scalars(
                select(UserDocument)
                .where(UserDocument.user_id == self.user.id)
                .order_by(UserDocument.chunk_index)
            )
        )

    def test_stores_contiguous_chunks_sharing_one_doc_id(self) -> None:
        text = "".join(str(i % 10) for i in range(2500))
        doc_id, count = store_document(
            self.session, self.user.id, "notes.txt", text.encode("utf-8")
        )

        rows = self._rows()
        self.assertEqual(count, len(rows))
        self.assertGreater(count, 1)
        self.assertEqual([row.chunk_index for row in rows], list(range(count)))
        self.assertEqual({row.doc_id for row in rows}, {doc_id})
        self.assertEqual({row.file_type for row in rows}, {"txt"})
        for row in rows:
            self.assertLessEqual(len(row.content), CHUNK_SIZE)

    def test_empty_text_raises_parse_failed_and_writes_nothing(self) -> None:
        with self.assertRaises(DocumentParseError) as error:
            store_document(
                self.session, self.user.id, "blank.txt", "    \n\t ".encode("utf-8")
            )
        self.assertEqual(error.exception.code, "PARSE_FAILED")
        self.assertEqual(self._rows(), [])

    def test_unsupported_type_raises_and_writes_nothing(self) -> None:
        with self.assertRaises(UnsupportedFileTypeError) as error:
            store_document(self.session, self.user.id, "archive.zip", b"data")
        self.assertEqual(error.exception.code, "UNSUPPORTED_TYPE")
        self.assertEqual(self._rows(), [])

    def test_oversized_file_raises_parse_failed_and_writes_nothing(self) -> None:
        oversized = b"a" * (document_service.MAX_FILE_BYTES + 1)
        with self.assertRaises(DocumentParseError) as error:
            store_document(self.session, self.user.id, "big.txt", oversized)
        self.assertEqual(error.exception.code, "PARSE_FAILED")
        self.assertEqual(self._rows(), [])


if __name__ == "__main__":
    unittest.main()
