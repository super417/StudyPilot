import base64
from datetime import datetime, timedelta, timezone
import os
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import decrypt, encrypt, get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import ApiConfig, User
from app.routers.api_config import get_api_config_verifier
from app.services.api_config_service import (
    NoVerifiedApiConfigError,
    has_verified_api_config,
    require_verified_api_config,
)
from app.services.session_service import COOKIE_NAME, session_store


class ApiConfigRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY", "SESSION_TIMEOUT_MINUTES")
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

        def override_verifier():
            return cls.verifier

        cls.verifier = cls._successful_verifier
        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_api_config_verifier] = override_verifier

    @classmethod
    async def _successful_verifier(cls, *_: str) -> bool:
        return True

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
        type(self).verifier = type(self)._successful_verifier
        username = f"route-{os.urandom(8).hex()}"
        self.client = TestClient(app)
        session_store.clear()
        registration = self.client.post(
            "/api/auth/register",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(registration.status_code, 201, registration.text)
        self.user = self.session.scalar(select(User).where(User.username == username))
        self.assertIsNotNone(self.user)
        self._login()

    def tearDown(self) -> None:
        self.client.close()
        self.session.close()
        session_store.clear()
        Base.metadata.drop_all(self.engine)

    def _login(self) -> None:
        response = self.client.post(
            "/api/auth/login",
            json={"username": self.user.username, "password": "placeholder-password"},
        )
        self.assertEqual(response.status_code, 200, response.text)

    def _save(self, key: str = "sk-old-placeholder-1234"):
        return self.client.post(
            "/api/api-config",
            json={
                "apiKey": key,
                "modelType": "test-model",
                "baseUrl": "https://api.example.test/v1",
            },
        )

    def _stored_config(self) -> ApiConfig | None:
        self.session.expire_all()
        return self.session.scalar(
            select(ApiConfig).where(ApiConfig.user_id == self.user.id)
        )

    def test_post_returns_masked_key_and_never_exposes_secret(self) -> None:
        response = self._save()

        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["apiKeyMasked"][-4:], "1234")
        self.assertEqual(body["apiKeyMasked"][:-4], "*" * (len("sk-old-placeholder-1234") - 4))
        self.assertNotIn("sk-old-placeholder-1234", response.text)
        self.assertNotIn("api_key_cipher", response.text)
        stored = self._stored_config()
        self.assertIsNotNone(stored)
        self.assertNotEqual(stored.api_key_cipher, "sk-old-placeholder-1234")
        self.assertEqual(decrypt(stored.api_key_cipher), "sk-old-placeholder-1234")

    def test_get_returns_masked_configuration(self) -> None:
        self.assertEqual(self._save().status_code, 201)

        response = self.client.get("/api/api-config")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["apiKeyMasked"][-4:], "1234")
        self.assertEqual(
            response.json()["apiKeyMasked"][:-4],
            "*" * (len("sk-old-placeholder-1234") - 4),
        )
        self.assertEqual(response.json()["modelType"], "test-model")
        self.assertNotIn("api_key_cipher", response.text)
        self.assertNotIn("sk-old-placeholder-1234", response.text)

    def test_put_replaces_cipher_and_patch_failure_preserves_old_config(self) -> None:
        self.assertEqual(self._save().status_code, 201)
        old_cipher = self._stored_config().api_key_cipher

        response = self.client.put(
            "/api/api-config",
            json={
                "apiKey": "sk-new-placeholder-5678",
                "modelType": "new-model",
                "baseUrl": "https://new.example.test/v2",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["apiKeyMasked"][-4:], "5678")
        self.assertEqual(
            response.json()["apiKeyMasked"][:-4],
            "*" * (len("sk-new-placeholder-5678") - 4),
        )
        updated = self._stored_config()
        self.assertNotEqual(updated.api_key_cipher, old_cipher)
        self.assertEqual(decrypt(updated.api_key_cipher), "sk-new-placeholder-5678")

        async def failed_verifier(*_: str) -> bool:
            return False

        type(self).verifier = failed_verifier
        failed = self.client.patch(
            "/api/api-config",
            json={
                "apiKey": "sk-rejected-placeholder-9999",
                "modelType": "rejected-model",
                "baseUrl": "https://rejected.example.test/v1",
            },
        )

        self.assertEqual(failed.status_code, 400)
        self.assertEqual(failed.json()["code"], "VERIFY_FAILED")
        preserved = self._stored_config()
        self.assertEqual(preserved.api_key_cipher, updated.api_key_cipher)
        self.assertEqual(decrypt(preserved.api_key_cipher), "sk-new-placeholder-5678")
        self.assertEqual(preserved.model_type, "new-model")

    def test_delete_then_get_returns_no_api_config(self) -> None:
        self.assertEqual(self._save().status_code, 201)

        deleted = self.client.delete("/api/api-config")
        missing = self.client.get("/api/api-config")

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"status": "ok"})
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["code"], "NO_API_CONFIG")

    def test_missing_and_duplicate_config_errors(self) -> None:
        missing = self.client.get("/api/api-config")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["code"], "NO_API_CONFIG")

        self.assertEqual(self._save().status_code, 201)
        duplicate = self._save("sk-duplicate-placeholder-1111")
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json()["code"], "CONFIG_EXISTS")
        self.assertNotIn("sk-duplicate-placeholder-1111", duplicate.text)

    def test_invalid_url_verification_failure_and_timeout_are_safe_errors(self) -> None:
        invalid_url = self.client.post(
            "/api/api-config",
            json={
                "apiKey": "sk-secret-invalid-url",
                "modelType": "test-model",
                "baseUrl": "ftp://invalid.example.test",
            },
        )
        self.assertEqual(invalid_url.status_code, 400)
        self.assertEqual(invalid_url.json()["code"], "INVALID_URL")
        self.assertNotIn("sk-secret-invalid-url", invalid_url.text)

        async def failed_verifier(*_: str) -> bool:
            return False

        type(self).verifier = failed_verifier
        failed = self._save("sk-secret-verification-failure")
        self.assertEqual(failed.status_code, 400)
        self.assertEqual(failed.json()["code"], "VERIFY_FAILED")
        self.assertNotIn("sk-secret-verification-failure", failed.text)

        async def timeout_verifier(*_: str) -> bool:
            raise httpx.TimeoutException("secret timeout details")

        type(self).verifier = timeout_verifier
        timeout = self._save("sk-secret-timeout")
        self.assertEqual(timeout.status_code, 504)
        self.assertEqual(timeout.json()["code"], "VERIFY_TIMEOUT")
        self.assertNotIn("sk-secret-timeout", timeout.text)

    def test_missing_session_is_unauthenticated(self) -> None:
        self.client.cookies.clear()

        response = self.client.get("/api/api-config")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "UNAUTHENTICATED")
        self.assertEqual(response.json()["status"], "error")

    def test_expired_session_is_revoked_and_cookie_cleared(self) -> None:
        token = self.client.cookies.get(COOKIE_NAME)
        session_store.sessions[token].last_active_at = datetime.now(timezone.utc) - timedelta(
            minutes=31
        )

        response = self.client.get("/api/api-config")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "SESSION_EXPIRED")
        self.assertNotIn(token, session_store.sessions)
        self.assertIn(COOKIE_NAME, response.headers.get("set-cookie", ""))

    def test_verified_config_helpers_distinguish_true_false_and_missing(self) -> None:
        self.assertFalse(has_verified_api_config(self.session, self.user.id))
        with self.assertRaises(NoVerifiedApiConfigError) as missing:
            require_verified_api_config(self.session, self.user.id)
        self.assertEqual(missing.exception.code, "NO_API_KEY")
        self.assertNotIn("api_key_cipher", str(missing.exception))

        config = ApiConfig(
            user_id=self.user.id,
            api_key_cipher=encrypt("sk-helper-placeholder-1234"),
            model_type="test-model",
            base_url="https://api.example.test/v1",
            is_verified=False,
        )
        self.session.add(config)
        self.session.commit()
        self.assertFalse(has_verified_api_config(self.session, self.user.id))
        with self.assertRaises(NoVerifiedApiConfigError):
            require_verified_api_config(self.session, self.user.id)

        config.is_verified = True
        self.session.commit()
        self.assertTrue(has_verified_api_config(self.session, self.user.id))
        self.assertIs(require_verified_api_config(self.session, self.user.id), config)

    def test_list_models_from_draft_credentials(self) -> None:
        class FakeResponse:
            status_code = 200
            headers = {"content-type": "application/json"}

            def json(self):
                return {
                    "data": [
                        {"id": "gpt-4o-mini"},
                        {"id": "gpt-4o"},
                        {"id": "gpt-4o-mini"},
                    ]
                }

        class FakeClient:
            def __init__(self, *_, **__):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def get(self, url, headers=None):
                self.url = url
                self.headers = headers
                return FakeResponse()

        with patch("app.services.api_config_service.httpx.AsyncClient", FakeClient):
            response = self.client.post(
                "/api/api-config/models",
                json={
                    "apiKey": "sk-draft-placeholder-1234",
                    "baseUrl": "https://api.example.test/v1",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(
            body["models"],
            [
                {"id": "gpt-4o-mini", "name": "gpt-4o-mini"},
                {"id": "gpt-4o", "name": "gpt-4o"},
            ],
        )
        self.assertNotIn("sk-draft", response.text)

    def test_list_models_uses_stored_config_when_body_empty(self) -> None:
        self.assertEqual(self._save().status_code, 201)

        class FakeResponse:
            status_code = 200
            headers = {"content-type": "application/json"}

            def json(self):
                return {"data": [{"id": "stored-model-a"}]}

        class FakeClient:
            def __init__(self, *_, **__):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def get(self, url, headers=None):
                return FakeResponse()

        with patch("app.services.api_config_service.httpx.AsyncClient", FakeClient):
            response = self.client.post("/api/api-config/models", json={})

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json()["models"],
            [{"id": "stored-model-a", "name": "stored-model-a"}],
        )

    def test_list_models_without_config_returns_404(self) -> None:
        response = self.client.post("/api/api-config/models", json={})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "NO_API_CONFIG")


if __name__ == "__main__":
    unittest.main()
