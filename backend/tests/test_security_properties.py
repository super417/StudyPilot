"""Security property tests (tasks 12.2 / 13.4 / 14.4 / 16.3).

Feature: study-pilot, Property 1 — password hash round-trip
Feature: study-pilot, Property 2 — invalid registration is rejected
Feature: study-pilot, Property 3 — five failed logins lock the account
Feature: study-pilot, Property 4 — AES encrypt/decrypt round-trip
Feature: study-pilot, Property 5 — API key mask exposes only last 4
Feature: study-pilot, Property 7 — proxy responses never leak credentials
"""

from __future__ import annotations

import base64
import json
import os
import unittest
import uuid
from datetime import datetime, timezone

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import AesGcmCipher, get_cipher
from app.models.base import Base
from app.models.entities import User
from app.services.ai_proxy import (
    CredentialUnavailableError,
    NoVerifiedApiConfigError,
    ResolvedCredential,
    build_client_error,
    format_sse,
)
from app.services.api_config_service import mask_api_key
from app.services.auth_service import (
    AuthValidationError,
    InvalidCredentialsError,
    LOCK_DURATION,
    LockedAccountError,
    authenticate_user,
    register_user,
    verify_password,
)

PROPERTY_SETTINGS = settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)

# bcrypt silently truncates past 72 bytes; keep passwords in the verified range.
_passwords = st.text(
    alphabet=st.characters(blacklist_categories=("Cs",), blacklist_characters="\x00"),
    min_size=8,
    max_size=72,
).filter(lambda value: bool(value.strip()))
_usernames = st.text(
    alphabet=st.characters(
        whitelist_categories=("L", "N"),
        whitelist_characters="-_",
    ),
    min_size=3,
    max_size=64,
).filter(lambda value: bool(value.strip()))
# Long enough that accidental base64/error-code substring collisions are rare.
_api_keys = st.text(
    alphabet=st.characters(
        whitelist_categories=("L", "N"),
        whitelist_characters="-_",
    ),
    min_size=12,
    max_size=48,
).map(lambda value: f"sk-test-{value}")


def _distinct_password(password: str, candidate: str) -> str:
    """Return a password that differs within bcrypt's 72-byte window."""
    window = password[:72]
    other = candidate[:72]
    if other != window and other.strip():
        return other if len(candidate) >= 8 else (other + "x" * 8)[:72]
    flipped = ("A" if not window or window[0] != "A" else "B") + window[1:]
    return flipped if len(flipped) >= 8 else (flipped + "xxxxxxxx")[:72]


def _engine_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    return engine, factory()


class _EnvMixin(unittest.TestCase):
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

    @classmethod
    def tearDownClass(cls) -> None:
        get_cipher.cache_clear()
        get_settings.cache_clear()
        for name, value in cls._environment.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


class PasswordHashPropertyTests(_EnvMixin):
    """Feature: study-pilot, Property 1"""

    @PROPERTY_SETTINGS
    @given(password=_passwords, wrong=_passwords)
    def test_property_1_password_hash_round_trip(self, password: str, wrong: str) -> None:
        # Feature: study-pilot, Property 1: 密码哈希往返
        wrong = _distinct_password(password, wrong)
        engine, session = _engine_session()
        try:
            user = register_user(session, f"u-{uuid.uuid4().hex[:12]}", password)
            self.assertNotEqual(user.password_hash, password)
            self.assertNotIn(password, user.password_hash)
            self.assertTrue(verify_password(password, user.password_hash))
            self.assertFalse(verify_password(wrong, user.password_hash))
        finally:
            session.close()
            engine.dispose()


class InvalidRegistrationPropertyTests(_EnvMixin):
    """Feature: study-pilot, Property 2"""

    @PROPERTY_SETTINGS
    @given(
        username=st.one_of(
            st.just(""),
            st.just("  "),
            st.text(min_size=0, max_size=2),
            st.text(min_size=65, max_size=80),
        ),
        password=_passwords,
    )
    def test_property_2_invalid_username_rejected(self, username: str, password: str) -> None:
        # Feature: study-pilot, Property 2: 非法注册一律拒绝且不改动数据
        engine, session = _engine_session()
        try:
            before = session.scalar(select(func.count()).select_from(User)) or 0
            with self.assertRaises(AuthValidationError):
                register_user(session, username, password)
            after = session.scalar(select(func.count()).select_from(User)) or 0
            self.assertEqual(after, before)
        finally:
            session.close()
            engine.dispose()

    @PROPERTY_SETTINGS
    @given(
        username=_usernames,
        password=st.one_of(
            st.just(""),
            st.just("       "),
            st.text(min_size=0, max_size=7),
            st.text(min_size=129, max_size=140),
        ),
    )
    def test_property_2_invalid_password_rejected(self, username: str, password: str) -> None:
        # Feature: study-pilot, Property 2: 非法注册一律拒绝且不改动数据
        engine, session = _engine_session()
        try:
            before = session.scalar(select(func.count()).select_from(User)) or 0
            with self.assertRaises(AuthValidationError):
                register_user(session, username, password)
            after = session.scalar(select(func.count()).select_from(User)) or 0
            self.assertEqual(after, before)
        finally:
            session.close()
            engine.dispose()


class LoginLockPropertyTests(_EnvMixin):
    """Feature: study-pilot, Property 3"""

    @PROPERTY_SETTINGS
    @given(password=_passwords, wrong=_passwords)
    def test_property_3_five_failures_lock_account(self, password: str, wrong: str) -> None:
        # Feature: study-pilot, Property 3: 登录失败连续 5 次触发锁定
        wrong = _distinct_password(password, wrong)
        engine, session = _engine_session()
        try:
            user = register_user(session, f"lock-{uuid.uuid4().hex[:12]}", password)
            now = datetime(2026, 3, 1, 12, tzinfo=timezone.utc)

            for _ in range(4):
                with self.assertRaises(InvalidCredentialsError):
                    authenticate_user(session, user.username, wrong, now)
                session.refresh(user)
                self.assertIsNone(user.locked_until)

            with self.assertRaises(LockedAccountError) as locked:
                authenticate_user(session, user.username, wrong, now)
            self.assertEqual(locked.exception.retry_after_seconds, int(LOCK_DURATION.total_seconds()))
            session.refresh(user)
            self.assertIsNotNone(user.locked_until)
            self.assertGreater(user.locked_until.replace(tzinfo=timezone.utc), now)
            self.assertLessEqual(
                user.locked_until.replace(tzinfo=timezone.utc),
                now + LOCK_DURATION,
            )

            with self.assertRaises(LockedAccountError):
                authenticate_user(session, user.username, password, now)

            unlocked = authenticate_user(
                session,
                user.username,
                password,
                now + LOCK_DURATION,
            )
            self.assertEqual(unlocked.failed_login_count, 0)
            self.assertIsNone(unlocked.locked_until)
        finally:
            session.close()
            engine.dispose()


class AesRoundTripPropertyTests(_EnvMixin):
    """Feature: study-pilot, Property 4"""

    @PROPERTY_SETTINGS
    @given(key=_api_keys)
    def test_property_4_aes_round_trip(self, key: str) -> None:
        # Feature: study-pilot, Property 4: API Key AES 加解密往返
        cipher = AesGcmCipher(os.environ["AES_KEY"])
        encrypted = cipher.encrypt(key)
        self.assertNotEqual(encrypted, key)
        self.assertNotIn(key, encrypted)
        self.assertNotIn(key.encode("utf-8"), base64.b64decode(encrypted))
        self.assertEqual(cipher.decrypt(encrypted), key)


class ApiKeyMaskPropertyTests(unittest.TestCase):
    """Feature: study-pilot, Property 5"""

    @PROPERTY_SETTINGS
    @given(
        api_key=st.text(
            alphabet=st.characters(blacklist_categories=("Cs",), min_codepoint=33, max_codepoint=126),
            min_size=4,
            max_size=128,
        ),
        mask_char=st.sampled_from(["*", "•", "x"]),
    )
    def test_property_5_mask_exposes_only_last_four(self, api_key: str, mask_char: str) -> None:
        # Feature: study-pilot, Property 5: API Key 掩码仅暴露后 4 位
        masked = mask_api_key(api_key, mask_char)
        self.assertEqual(masked[-4:], api_key[-4:])
        self.assertEqual(masked[:-4], mask_char * (len(api_key) - 4))
        if len(api_key) > 4:
            self.assertNotIn(api_key[: max(1, len(api_key) - 4)], masked)


class CredentialLeakPropertyTests(unittest.TestCase):
    """Feature: study-pilot, Property 7"""

    @PROPERTY_SETTINGS
    @given(api_key=_api_keys)
    def test_property_7_responses_never_contain_credential(self, api_key: str) -> None:
        # Feature: study-pilot, Property 7: 出站请求与代理响应不含凭证
        credential = ResolvedCredential(
            api_key=api_key,
            model_type="test-model",
            base_url="https://api.example.test/v1",
        )
        surfaces = [
            repr(credential),
            json.dumps(build_client_error(NoVerifiedApiConfigError()), ensure_ascii=False),
            json.dumps(build_client_error(CredentialUnavailableError()), ensure_ascii=False),
            format_sse("error", {"code": "AI_TIMEOUT", "message": "AI 响应超时，请稍后重试"}),
            format_sse("done", {"finish": "stop"}),
            format_sse("token", {"delta": "hello"}),
        ]
        for surface in surfaces:
            self.assertNotIn(api_key, surface)


if __name__ == "__main__":
    unittest.main()
