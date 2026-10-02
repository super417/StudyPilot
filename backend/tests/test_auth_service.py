import re
import unittest

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.models.base import Base
from app.models.entities import User
from app.services.auth_service import (
    AuthValidationError,
    UsernameTakenError,
    hash_password,
    register_user,
    validate_registration,
    verify_password,
)


class AuthServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(
            "sqlite:///:memory:", connect_args={"check_same_thread": False}
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

    def _user_count(self) -> int:
        return self.session.scalar(select(func.count()).select_from(User)) or 0

    def test_valid_registration_hashes_password_and_preserves_username(self) -> None:
        username = "  test-learner  "
        password = "test-placeholder-password"

        user = register_user(self.session, username, password)

        self.assertEqual(user.username, username)
        self.assertNotEqual(user.password_hash, password)
        self.assertRegex(
            user.password_hash,
            re.compile(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}"),
        )
        self.assertTrue(verify_password(password, user.password_hash))
        self.assertFalse(verify_password("wrong-placeholder-password", user.password_hash))
        self.assertIsNotNone(user.last_active_at)
        self.assertIsNotNone(user.created_at)

        second_hash = hash_password(password)
        self.assertNotEqual(user.password_hash, second_hash)

    def test_verify_password_returns_false_for_invalid_hash(self) -> None:
        self.assertFalse(verify_password("test-placeholder-password", "not-a-bcrypt-hash"))

    def test_invalid_registration_does_not_add_users_and_identifies_field(self) -> None:
        invalid_usernames = (None, "", "   ", "ab", "u" * 65)
        invalid_passwords = (None, "", "       ", "short", "p" * 129)

        for username in invalid_usernames:
            with self.subTest(field="username", value=username):
                before = self._user_count()
                with self.assertRaises(AuthValidationError) as error:
                    register_user(self.session, username, "test-placeholder-password")
                self.assertEqual(error.exception.code, "VALIDATION")
                self.assertIn("username", str(error.exception).lower())
                self.assertEqual(self._user_count(), before)

        for password in invalid_passwords:
            with self.subTest(field="password", value=password):
                before = self._user_count()
                with self.assertRaises(AuthValidationError) as error:
                    register_user(self.session, "test-learner", password)
                self.assertEqual(error.exception.code, "VALIDATION")
                self.assertIn("password", str(error.exception).lower())
                self.assertEqual(self._user_count(), before)

    def test_duplicate_username_raises_without_modifying_existing_record(self) -> None:
        username = "duplicate-learner"
        original_password = "original-placeholder-password"
        original = register_user(self.session, username, original_password)
        original_hash = original.password_hash

        with self.assertRaises(UsernameTakenError) as error:
            register_user(self.session, username, "replacement-placeholder-password")

        self.assertEqual(error.exception.code, "USERNAME_TAKEN")
        self.session.expire_all()
        stored = self.session.scalar(select(User).where(User.username == username))
        self.assertIsNotNone(stored)
        self.assertEqual(self._user_count(), 1)
        self.assertEqual(stored.password_hash, original_hash)
        self.assertTrue(verify_password(original_password, stored.password_hash))


if __name__ == "__main__":
    unittest.main()
