import base64
import json
import os
import unittest
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import encrypt, get_cipher
from app.models.base import Base
from app.models.entities import ApiConfig, User
from app.services.ai_proxy import (
    CredentialUnavailableError,
    NoVerifiedApiConfigError,
    ResolvedCredential,
    build_client_error,
    build_outbound_headers,
    resolve_credential,
)

# Placeholder test credential; never a real key.
TEST_API_KEY = "sk-test-placeholder-abcd1234"


class AiProxyTests(unittest.TestCase):
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
        self.session.query(ApiConfig).delete()
        self.session.query(User).delete()
        self.session.commit()
        self.user = User(
            id=uuid.uuid4(),
            username=f"test-{uuid.uuid4().hex[:12]}",
            password_hash="placeholder-password-hash",
        )
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()

    def _add_config(self, *, cipher: str, is_verified: bool = True) -> ApiConfig:
        config = ApiConfig(
            user_id=self.user.id,
            api_key_cipher=cipher,
            model_type="test-model",
            base_url="https://api.example.test/v1",
            is_verified=is_verified,
        )
        self.session.add(config)
        self.session.commit()
        return config

    def test_verified_config_resolves_plaintext_and_fields(self) -> None:
        self._add_config(cipher=encrypt(TEST_API_KEY))

        credential = resolve_credential(self.session, self.user.id)

        self.assertEqual(credential.api_key, TEST_API_KEY)
        self.assertEqual(credential.model_type, "test-model")
        self.assertEqual(credential.base_url, "https://api.example.test/v1/chat/completions")

    def test_missing_config_raises_no_api_key(self) -> None:
        with self.assertRaises(NoVerifiedApiConfigError) as error:
            resolve_credential(self.session, self.user.id)
        self.assertEqual(error.exception.code, "NO_API_KEY")

    def test_unverified_config_raises_no_api_key(self) -> None:
        self._add_config(cipher=encrypt(TEST_API_KEY), is_verified=False)

        with self.assertRaises(NoVerifiedApiConfigError) as error:
            resolve_credential(self.session, self.user.id)
        self.assertEqual(error.exception.code, "NO_API_KEY")

    def test_tampered_ciphertext_raises_cred_unavailable(self) -> None:
        cipher = encrypt(TEST_API_KEY)
        # Flip one character while keeping valid base64 length.
        flipped = "A" if cipher[10] != "A" else "B"
        tampered = cipher[:10] + flipped + cipher[11:]
        self._add_config(cipher=tampered)

        with self.assertRaises(CredentialUnavailableError) as error:
            resolve_credential(self.session, self.user.id)
        self.assertEqual(error.exception.code, "CRED_UNAVAILABLE")
        # The safe message must not leak the tampered ciphertext.
        self.assertNotIn(tampered, str(error.exception))

    def test_repr_does_not_leak_api_key(self) -> None:
        credential = ResolvedCredential(
            api_key=TEST_API_KEY,
            model_type="test-model",
            base_url="https://api.example.test/v1",
        )
        rendered = repr(credential)
        self.assertNotIn(TEST_API_KEY, rendered)
        self.assertIn("api_key=***", rendered)
        self.assertIn("test-model", rendered)

    def test_client_error_is_credential_free(self) -> None:
        for error in (NoVerifiedApiConfigError(), CredentialUnavailableError()):
            with self.subTest(error=type(error).__name__):
                payload = build_client_error(error)
                serialized = json.dumps(payload, ensure_ascii=False)
                self.assertEqual(payload["status"], "error")
                self.assertIn(payload["code"], {"NO_API_KEY", "CRED_UNAVAILABLE"})
                self.assertTrue(payload["message"])
                self.assertNotIn(TEST_API_KEY, serialized)

    def test_client_error_maps_codes(self) -> None:
        self.assertEqual(
            build_client_error(NoVerifiedApiConfigError())["code"], "NO_API_KEY"
        )
        self.assertEqual(
            build_client_error(CredentialUnavailableError())["code"],
            "CRED_UNAVAILABLE",
        )
        # Unknown errors collapse to a generic, credential-free response.
        self.assertEqual(
            build_client_error(RuntimeError("boom"))["code"], "CRED_UNAVAILABLE"
        )

    def test_outbound_headers_carry_bearer_credential(self) -> None:
        credential = ResolvedCredential(
            api_key=TEST_API_KEY,
            model_type="test-model",
            base_url="https://api.example.test/v1",
        )
        headers = build_outbound_headers(credential)
        self.assertEqual(headers["Authorization"], f"Bearer {TEST_API_KEY}")
        self.assertEqual(headers["X-Model-Type"], "test-model")


if __name__ == "__main__":
    unittest.main()
