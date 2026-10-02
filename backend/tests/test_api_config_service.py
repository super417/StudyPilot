import base64
import os
import unittest
import uuid
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import decrypt, get_cipher, encrypt
from app.models.base import Base
from app.models.entities import ApiConfig, User
from app.services.api_config_service import (
    ApiConfigAlreadyExistsError,
    ApiConfigModelsFetchError,
    ApiConfigValidationError,
    ApiConfigVerificationError,
    ApiConfigVerificationTimeoutError,
    derive_models_url,
    list_remote_models,
    mask_api_key,
    save_api_config,
    validate_base_url,
)


class ApiConfigServiceTests(unittest.IsolatedAsyncioTestCase):
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

    def _config_count(self) -> int:
        return self.session.scalar(select(func.count()).select_from(ApiConfig)) or 0

    def test_valid_http_and_https_base_urls_are_returned_unchanged(self) -> None:
        for base_url in (
            "http://api.example.test/v1",
            "https://api.example.test/v1?format=json  ",
        ):
            with self.subTest(base_url=base_url):
                self.assertEqual(validate_base_url(base_url), base_url)

    def test_invalid_base_urls_raise_error_identifying_base_url(self) -> None:
        invalid_values = (
            None,
            "",
            "   ",
            "ftp://api.example.test",
            "api.example.test/v1",
            "HTTP://api.example.test",
            "Https://api.example.test",
        )

        for base_url in invalid_values:
            with self.subTest(base_url=base_url):
                with self.assertRaises(ApiConfigValidationError) as error:
                    validate_base_url(base_url)
                self.assertEqual(error.exception.code, "INVALID_URL")
                self.assertIn("base URL", str(error.exception))

    def test_long_api_key_only_exposes_final_four_characters(self) -> None:
        api_key = "placeholder-api-key-1234"

        masked = mask_api_key(api_key)

        self.assertEqual(masked[-4:], api_key[-4:])
        self.assertEqual(masked[:-4], "*" * (len(api_key) - 4))
        self.assertNotIn(api_key[:-4], masked)

    def test_four_character_api_key_is_not_longer_than_four_visible_characters(self) -> None:
        self.assertEqual(mask_api_key("abcd"), "abcd")
        self.assertEqual(len(mask_api_key("abcd")), 4)

    def test_short_api_key_is_fully_masked(self) -> None:
        self.assertEqual(mask_api_key("abc"), "***")
        self.assertEqual(mask_api_key("ab", mask_char="#"), "##")

    def test_empty_api_key_returns_empty_string(self) -> None:
        self.assertEqual(mask_api_key(""), "")

    def test_mask_char_must_be_one_character(self) -> None:
        for mask_char in ("", "**", None):
            with self.subTest(mask_char=mask_char):
                with self.assertRaises(ValueError):
                    mask_api_key("placeholder-key", mask_char)

    async def test_verifier_success_encrypts_and_persists_configuration(self) -> None:
        api_key = "sk-test-placeholder-1234"
        calls: list[tuple[str, str, str]] = []

        async def verifier(key: str, model: str, url: str) -> bool:
            calls.append((key, model, url))
            return True

        config = await save_api_config(
            self.session,
            self.user.id,
            api_key,
            "test-model",
            "https://api.example.test/v1",
            verifier,
        )

        self.assertTrue(config.is_verified)
        self.assertTrue(
            calls
            and calls[0][0] == api_key
            and calls[0][1] == "test-model"
            and calls[0][2] == "https://api.example.test/v1"
        )
        self.assertTrue(config.api_key_cipher != api_key)
        self.assertTrue(decrypt(config.api_key_cipher) == api_key)
        stored = self.session.scalar(
            select(ApiConfig).where(ApiConfig.user_id == self.user.id)
        )
        self.assertIsNotNone(stored)
        self.assertTrue(stored.api_key_cipher != api_key)
        self.assertFalse(api_key in stored.api_key_cipher)
        self.assertEqual(self._config_count(), 1)

    async def test_false_verifier_does_not_write_configuration(self) -> None:
        async def verifier(_: str, __: str, ___: str) -> bool:
            return False

        with self.assertRaises(ApiConfigVerificationError) as error:
            await save_api_config(
                self.session,
                self.user.id,
                "sk-test-placeholder-1234",
                "test-model",
                "https://api.example.test/v1",
                verifier,
            )

        self.assertEqual(error.exception.code, "VERIFY_FAILED")
        self.assertEqual(self._config_count(), 0)

    async def test_timeout_verifier_does_not_write_configuration(self) -> None:
        async def verifier(_: str, __: str, ___: str) -> bool:
            raise httpx.TimeoutException("temporary timeout")

        with self.assertRaises(ApiConfigVerificationTimeoutError) as error:
            await save_api_config(
                self.session,
                self.user.id,
                "sk-test-placeholder-1234",
                "test-model",
                "https://api.example.test/v1",
                verifier,
            )

        self.assertEqual(error.exception.code, "VERIFY_TIMEOUT")
        self.assertEqual(self._config_count(), 0)

    async def test_verifier_exception_returns_generic_failure_without_writing(self) -> None:
        async def verifier(_: str, __: str, ___: str) -> bool:
            raise RuntimeError("sensitive verification details")

        with self.assertRaises(ApiConfigVerificationError) as error:
            await save_api_config(
                self.session,
                self.user.id,
                "sk-test-placeholder-1234",
                "test-model",
                "https://api.example.test/v1",
                verifier,
            )

        self.assertEqual(error.exception.code, "VERIFY_FAILED")
        self.assertNotIn("sensitive", str(error.exception))
        self.assertEqual(self._config_count(), 0)

    async def test_non_success_http_response_returns_generic_failure(self) -> None:
        class NonSuccessClient:
            def __init__(self, **kwargs: object) -> None:
                self.timeout = kwargs["timeout"]

            async def __aenter__(self) -> "NonSuccessClient":
                return self

            async def __aexit__(self, *args: object) -> None:
                return None

            async def get(self, url: str, headers: dict[str, str]) -> httpx.Response:
                return httpx.Response(401, request=httpx.Request("GET", url))

        with patch(
            "app.services.api_config_service.httpx.AsyncClient", NonSuccessClient
        ):
            with self.assertRaises(ApiConfigVerificationError) as error:
                await save_api_config(
                    self.session,
                    self.user.id,
                    "sk-test-placeholder-1234",
                    "test-model",
                    "https://api.example.test/v1",
                )

        self.assertEqual(error.exception.code, "VERIFY_FAILED")
        self.assertEqual(self._config_count(), 0)

    async def test_empty_fields_and_invalid_url_skip_verifier_and_database(self) -> None:
        calls = 0

        async def verifier(_: str, __: str, ___: str) -> bool:
            nonlocal calls
            calls += 1
            return True

        invalid_inputs = (
            ("", "test-model", "https://api.example.test/v1"),
            ("sk-test-placeholder-1234", "", "https://api.example.test/v1"),
            ("sk-test-placeholder-1234", "test-model", ""),
            ("sk-test-placeholder-1234", "test-model", "ftp://api.example.test"),
        )
        for index, (api_key, model_type, base_url) in enumerate(invalid_inputs):
            with self.subTest(index=index):
                with self.assertRaises(ValueError) as error:
                    await save_api_config(
                        self.session,
                        self.user.id,
                        api_key,
                        model_type,
                        base_url,
                        verifier,
                    )
                self.assertIn(error.exception.code, {"VALIDATION", "INVALID_URL"})
                self.assertEqual(calls, 0)
                self.assertEqual(self._config_count(), 0)

    async def test_existing_configuration_is_preserved_and_skips_verifier(self) -> None:
        existing = ApiConfig(
            user_id=self.user.id,
            api_key_cipher=encrypt("existing-test-placeholder-key"),
            model_type="existing-model",
            base_url="https://existing.example.test/v1",
            is_verified=True,
        )
        self.session.add(existing)
        self.session.commit()
        existing_id = existing.id
        calls = 0

        async def verifier(_: str, __: str, ___: str) -> bool:
            nonlocal calls
            calls += 1
            return True

        with self.assertRaises(ApiConfigAlreadyExistsError) as error:
            await save_api_config(
                self.session,
                self.user.id,
                "sk-test-placeholder-1234",
                "new-model",
                "https://new.example.test/v1",
                verifier,
            )

        self.assertEqual(error.exception.code, "CONFIG_EXISTS")
        self.assertEqual(calls, 0)
        self.assertEqual(self._config_count(), 1)
        self.session.expire_all()
        stored = self.session.scalar(
            select(ApiConfig).where(ApiConfig.user_id == self.user.id)
        )
        self.assertIsNotNone(stored)
        self.assertEqual(stored.id, existing_id)
        self.assertEqual(stored.model_type, "existing-model")
        self.assertTrue(decrypt(stored.api_key_cipher) == "existing-test-placeholder-key")

    def test_derive_models_url(self) -> None:
        self.assertEqual(
            derive_models_url("https://api.example.test/v1"),
            "https://api.example.test/v1/models",
        )
        self.assertEqual(
            derive_models_url("https://api.example.test/v1/chat/completions"),
            "https://api.example.test/v1/models",
        )
        self.assertEqual(
            derive_models_url("https://api.example.test/v1/models"),
            "https://api.example.test/v1/models",
        )

    def test_normalize_platform_deepseek_url(self) -> None:
        from app.services.api_config_service import normalize_base_url

        self.assertEqual(
            normalize_base_url("https://platform.deepseek.com/v1"),
            "https://api.deepseek.com/v1",
        )
        self.assertEqual(
            normalize_base_url("https://platform.deepseek.com"),
            "https://api.deepseek.com",
        )
        self.assertEqual(
            normalize_base_url("https://platform.deepseek.com/api_keys"),
            "https://api.deepseek.com",
        )

    def test_candidate_models_urls_prefers_deepseek_root(self) -> None:
        from app.services.api_config_service import candidate_models_urls

        self.assertEqual(
            candidate_models_urls("https://api.deepseek.com/v1"),
            [
                "https://api.deepseek.com/v1/models",
                "https://api.deepseek.com/models",
            ],
        )
        self.assertEqual(
            candidate_models_urls("https://api.deepseek.com"),
            [
                "https://api.deepseek.com/models",
                "https://api.deepseek.com/v1/models",
            ],
        )

    async def test_list_remote_models_parses_openai_payload(self) -> None:
        class FakeResponse:
            status_code = 200
            headers = {"content-type": "application/json"}

            def json(self):
                return {"data": [{"id": "alpha"}, {"id": "beta"}]}

        class FakeClient:
            def __init__(self, *_, **__):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def get(self, url, headers=None):
                self.url = url
                return FakeResponse()

        with patch("app.services.api_config_service.httpx.AsyncClient", FakeClient):
            models = await list_remote_models(
                "sk-test-placeholder-1234",
                "https://api.example.test/v1",
            )

        self.assertEqual(
            models,
            [{"id": "alpha", "name": "alpha"}, {"id": "beta", "name": "beta"}],
        )

    async def test_list_remote_models_empty_raises(self) -> None:
        class FakeResponse:
            status_code = 200
            headers = {"content-type": "application/json"}

            def json(self):
                return {"data": []}

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
            with self.assertRaises(ApiConfigModelsFetchError):
                await list_remote_models(
                    "sk-test-placeholder-1234",
                    "https://api.example.test/v1",
                )


if __name__ == "__main__":
    unittest.main()
