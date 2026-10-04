import base64
import os
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import User, UserDocument
from app.services.session_service import session_store


class DocumentRouteTests(unittest.TestCase):
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
        cls.session_factory = sessionmaker(
            bind=cls.engine, class_=Session, expire_on_commit=False
        )

        def override_get_db():
            session = cls.session_factory()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_get_db

    @classmethod
    def tearDownClass(cls) -> None:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(cls.engine)
        cls.engine.dispose()
        session_store.clear()
        get_cipher.cache_clear()
        get_settings.cache_clear()
        for name, value in cls._environment.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def setUp(self) -> None:
        Base.metadata.create_all(self.engine)
        self.session = self.session_factory()
        username = f"doc-route-{os.urandom(8).hex()}"
        self.client = TestClient(app)
        session_store.clear()
        registration = self.client.post(
            "/api/auth/register",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(registration.status_code, 201, registration.text)
        self.user = self.session.scalar(select(User).where(User.username == username))
        self.assertIsNotNone(self.user)
        login = self.client.post(
            "/api/auth/login",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(login.status_code, 200, login.text)

    def tearDown(self) -> None:
        self.client.close()
        self.session.close()
        session_store.clear()
        Base.metadata.drop_all(self.engine)

    def _rows(self) -> list[UserDocument]:
        self.session.expire_all()
        return list(
            self.session.scalars(
                select(UserDocument).where(UserDocument.user_id == self.user.id)
            )
        )

    def test_upload_txt_succeeds_and_persists_rows(self) -> None:
        text = ("StudyPilot 文档上传测试。" * 200).encode("utf-8")
        response = self.client.post(
            "/api/documents",
            files={"file": ("notes.txt", text, "text/plain")},
        )

        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertTrue(body["docId"])
        rows = self._rows()
        self.assertEqual(body["chunks"], len(rows))
        self.assertEqual({row.doc_id for row in rows}, {body["docId"]})

    def test_unsupported_type_returns_415_and_writes_nothing(self) -> None:
        response = self.client.post(
            "/api/documents",
            files={"file": ("malware.exe", b"MZ binary", "application/octet-stream")},
        )

        self.assertEqual(response.status_code, 415, response.text)
        self.assertEqual(response.json()["code"], "UNSUPPORTED_TYPE")
        self.assertEqual(response.json()["status"], "error")
        self.assertEqual(self._rows(), [])

    def test_legacy_doc_extension_returns_415(self) -> None:
        response = self.client.post(
            "/api/documents",
            files={"file": ("legacy.doc", b"old word data", "application/msword")},
        )
        self.assertEqual(response.status_code, 415)
        self.assertEqual(response.json()["code"], "UNSUPPORTED_TYPE")

    def test_empty_txt_returns_422_and_writes_nothing(self) -> None:
        response = self.client.post(
            "/api/documents",
            files={"file": ("blank.txt", b"   \n\t  ", "text/plain")},
        )

        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["code"], "PARSE_FAILED")
        self.assertEqual(self._rows(), [])

    def test_list_documents_aggregates_uploads(self) -> None:
        text_a = ("第一份考研讲义内容。" * 80).encode("utf-8")
        text_b = ("第二份笔记内容。" * 80).encode("utf-8")
        first = self.client.post(
            "/api/documents",
            files={"file": ("a.txt", text_a, "text/plain")},
        )
        second = self.client.post(
            "/api/documents",
            files={"file": ("b.txt", text_b, "text/plain")},
        )
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(second.status_code, 201, second.text)

        listed = self.client.get("/api/documents")
        self.assertEqual(listed.status_code, 200, listed.text)
        body = listed.json()
        self.assertEqual(body["status"], "ok")
        docs = body["documents"]
        self.assertEqual(len(docs), 2)
        by_name = {d["filename"]: d for d in docs}
        self.assertEqual(by_name["a.txt"]["docId"], first.json()["docId"])
        self.assertEqual(by_name["a.txt"]["chunks"], first.json()["chunks"])
        self.assertTrue(by_name["a.txt"]["ready"])
        self.assertEqual(by_name["b.txt"]["fileType"], "txt")

    def test_list_documents_requires_auth(self) -> None:
        self.client.cookies.clear()
        response = self.client.get("/api/documents")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "UNAUTHENTICATED")

    def test_missing_session_is_unauthenticated(self) -> None:
        self.client.cookies.clear()
        response = self.client.post(
            "/api/documents",
            files={"file": ("notes.txt", b"hello", "text/plain")},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "UNAUTHENTICATED")
        self.assertEqual(self._rows(), [])

    def test_delete_document_removes_all_chunks(self) -> None:
        upload = self.client.post(
            "/api/documents",
            files={"file": ("keep-or-drop.txt", b"alpha beta gamma " * 80, "text/plain")},
        )
        self.assertEqual(upload.status_code, 201, upload.text)
        doc_id = upload.json()["docId"]
        self.assertGreater(upload.json()["chunks"], 0)

        deleted = self.client.delete(f"/api/documents/{doc_id}")
        self.assertEqual(deleted.status_code, 200, deleted.text)
        body = deleted.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["docId"], doc_id)
        self.assertEqual(body["removedChunks"], upload.json()["chunks"])

        self.session.expire_all()
        remaining = list(
            self.session.scalars(
                select(UserDocument).where(UserDocument.doc_id == doc_id)
            )
        )
        self.assertEqual(remaining, [])

        listed = self.client.get("/api/documents")
        self.assertEqual(listed.json()["documents"], [])

        again = self.client.delete(f"/api/documents/{doc_id}")
        self.assertEqual(again.status_code, 404, again.text)
        self.assertEqual(again.json()["code"], "NOT_FOUND")

    def test_delete_foreign_document_is_not_found(self) -> None:
        other_name = f"other-doc-{os.urandom(4).hex()}"
        other = TestClient(app)
        other.post(
            "/api/auth/register",
            json={"username": other_name, "password": "placeholder-password"},
        )
        other.post(
            "/api/auth/login",
            json={"username": other_name, "password": "placeholder-password"},
        )
        upload = other.post(
            "/api/documents",
            files={"file": ("secret.txt", b"owned by other", "text/plain")},
        )
        self.assertEqual(upload.status_code, 201, upload.text)
        doc_id = upload.json()["docId"]

        response = self.client.delete(f"/api/documents/{doc_id}")
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()["code"], "NOT_FOUND")
        self.session.expire_all()
        still_there = list(
            self.session.scalars(
                select(UserDocument).where(UserDocument.doc_id == doc_id)
            )
        )
        self.assertGreater(len(still_there), 0)


if __name__ == "__main__":
    unittest.main()
