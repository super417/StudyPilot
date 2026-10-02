from datetime import datetime, timedelta, timezone
import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.entities import User
from app.services.auth_service import (
    InvalidCredentialsError,
    LOCK_DURATION,
    LockedAccountError,
    authenticate_user,
    register_user,
)


class AuthLoginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
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

    def setUp(self) -> None:
        self.session = self.session_factory()

    def tearDown(self) -> None:
        self.session.close()

    def _register(self, username: str | None = None) -> User:
        username = username or f"login-{self.session.query(User).count() + 1}"
        return register_user(self.session, username, "test-placeholder-password")

    def test_correct_password_returns_same_user_and_clears_auth_state(self) -> None:
        user = self._register()
        user.failed_login_count = 2
        user.locked_until = None
        self.session.commit()

        authenticated = authenticate_user(
            self.session,
            user.username,
            "test-placeholder-password",
            datetime(2025, 1, 1, 12, tzinfo=timezone.utc),
        )

        self.assertIs(authenticated, user)
        self.assertEqual(user.failed_login_count, 0)
        self.assertIsNone(user.locked_until)

    def test_first_four_failures_increment_and_fifth_locks_account(self) -> None:
        user = self._register()
        now = datetime(2025, 1, 1, 12)
        wrong_password = "wrong-placeholder-password"

        for failure_number in range(1, 5):
            with self.subTest(failure_number=failure_number):
                with self.assertRaises(InvalidCredentialsError) as error:
                    authenticate_user(self.session, user.username, wrong_password, now)
                self.assertEqual(error.exception.code, "INVALID_CREDENTIALS")
                self.assertNotIn(wrong_password, str(error.exception))
                self.assertNotIn(user.password_hash, str(error.exception))
                self.session.refresh(user)
                self.assertEqual(user.failed_login_count, failure_number)
                self.assertIsNone(user.locked_until)

        with self.assertRaises(LockedAccountError) as error:
            authenticate_user(self.session, user.username, wrong_password, now)

        self.assertEqual(error.exception.code, "LOCKED")
        self.assertEqual(error.exception.retry_after_seconds, 900)
        self.assertNotIn(wrong_password, str(error.exception))
        self.assertNotIn(user.password_hash, str(error.exception))
        self.session.refresh(user)
        self.assertEqual(user.failed_login_count, 5)
        self.assertEqual(
            user.locked_until.replace(tzinfo=timezone.utc),
            now.replace(tzinfo=timezone.utc) + LOCK_DURATION,
        )

    def test_active_lock_rejects_correct_password_without_changing_state(self) -> None:
        user = self._register()
        locked_at = datetime(2025, 1, 1, 12, tzinfo=timezone.utc)
        for _ in range(5):
            try:
                authenticate_user(
                    self.session, user.username, "wrong-placeholder-password", locked_at
                )
            except (InvalidCredentialsError, LockedAccountError):
                pass

        self.session.refresh(user)
        original_count = user.failed_login_count
        original_locked_until = user.locked_until

        with self.assertRaises(LockedAccountError) as error:
            authenticate_user(
                self.session,
                user.username,
                "test-placeholder-password",
                locked_at + timedelta(seconds=1),
            )

        self.assertEqual(error.exception.code, "LOCKED")
        self.assertEqual(error.exception.retry_after_seconds, 899)
        self.assertEqual(user.failed_login_count, original_count)
        self.assertEqual(user.locked_until, original_locked_until)

    def test_expired_lock_allows_correct_password_and_resets_state(self) -> None:
        user = self._register()
        locked_at = datetime(2025, 1, 1, 12, tzinfo=timezone.utc)
        for _ in range(5):
            try:
                authenticate_user(
                    self.session, user.username, "wrong-placeholder-password", locked_at
                )
            except (InvalidCredentialsError, LockedAccountError):
                pass

        authenticated = authenticate_user(
            self.session,
            user.username,
            "test-placeholder-password",
            locked_at + LOCK_DURATION,
        )

        self.assertIs(authenticated, user)
        self.assertEqual(user.failed_login_count, 0)
        self.assertIsNone(user.locked_until)

    def test_unknown_user_does_not_create_or_modify_records(self) -> None:
        user = self._register()
        before_count = self.session.query(User).count()

        with self.assertRaises(InvalidCredentialsError) as error:
            authenticate_user(
                self.session,
                "missing-login-user",
                "wrong-placeholder-password",
                datetime(2025, 1, 1, tzinfo=timezone.utc),
            )

        self.assertEqual(error.exception.code, "INVALID_CREDENTIALS")
        self.assertEqual(self.session.query(User).count(), before_count)
        self.session.expire_all()
        stored = self.session.scalar(select(User).where(User.id == user.id))
        self.assertIsNotNone(stored)
        self.assertEqual(stored.failed_login_count, 0)
        self.assertIsNone(stored.locked_until)


if __name__ == "__main__":
    unittest.main()
