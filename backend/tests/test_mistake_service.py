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
from app.models.entities import Mistake, User
from app.services import mistake_service
from app.services.mistake_service import (
    MistakeNotFoundError,
    MistakeReviewStatusValidationError,
)


class MistakeServiceTests(unittest.TestCase):
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
        cls.session_factory = sessionmaker(
            bind=cls.engine, class_=Session, expire_on_commit=False
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.engine.dispose()
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

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _make_user(self, name: str = "user") -> User:
        user = User(username=f"{name}-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(user)
        self.session.commit()
        return user

    def _make_mistake(
        self, user: User, question: str, review_status: str = "pending"
    ) -> Mistake:
        mistake = Mistake(
            user_id=user.id,
            question=question,
            my_answer="我的答案",
            why_wrong="粗心",
            correct_understanding="正确理解",
            review_status=review_status,
        )
        self.session.add(mistake)
        self.session.commit()
        return mistake

    # --- list_mistakes ------------------------------------------------------

    def test_list_returns_only_own_mistakes(self) -> None:
        mine = self._make_user("mine")
        other = self._make_user("other")
        m1 = self._make_mistake(mine, "题1")
        self._make_mistake(other, "他人题")

        mistakes, _ = mistake_service.list_mistakes(self.session, mine.id)
        self.assertEqual([m.id for m in mistakes], [m1.id])

    def test_pending_count_counts_only_pending(self) -> None:
        user = self._make_user()
        self._make_mistake(user, "p1", "pending")
        self._make_mistake(user, "p2", "pending")
        self._make_mistake(user, "s1", "scheduled")
        self._make_mistake(user, "d1", "done")

        _, pending = mistake_service.list_mistakes(self.session, user.id)
        self.assertEqual(pending, 2)

    def test_pending_count_zero_when_none_pending(self) -> None:
        user = self._make_user()
        self._make_mistake(user, "s1", "scheduled")
        self._make_mistake(user, "d1", "done")

        _, pending = mistake_service.list_mistakes(self.session, user.id)
        self.assertEqual(pending, 0)

    def test_pending_count_ignores_other_users(self) -> None:
        mine = self._make_user("mine")
        other = self._make_user("other")
        self._make_mistake(mine, "mine-pending", "pending")
        self._make_mistake(other, "other-pending", "pending")
        self._make_mistake(other, "other-pending-2", "pending")

        mistakes, pending = mistake_service.list_mistakes(self.session, mine.id)
        self.assertEqual(len(mistakes), 1)
        self.assertEqual(pending, 1)

    def test_empty_list_has_zero_badge(self) -> None:
        user = self._make_user()
        mistakes, pending = mistake_service.list_mistakes(self.session, user.id)
        self.assertEqual(mistakes, [])
        self.assertEqual(pending, 0)

    # --- get_mistake --------------------------------------------------------

    def test_get_returns_own_mistake(self) -> None:
        user = self._make_user()
        mistake = self._make_mistake(user, "题")
        fetched = mistake_service.get_mistake(self.session, user.id, mistake.id)
        self.assertEqual(fetched.id, mistake.id)

    def test_get_foreign_mistake_raises_not_found(self) -> None:
        owner = self._make_user("owner")
        intruder = self._make_user("intruder")
        mistake = self._make_mistake(owner, "题")
        with self.assertRaises(MistakeNotFoundError) as ctx:
            mistake_service.get_mistake(self.session, intruder.id, mistake.id)
        self.assertEqual(ctx.exception.code, "NOT_FOUND")

    def test_get_unknown_mistake_raises_not_found(self) -> None:
        user = self._make_user()
        with self.assertRaises(MistakeNotFoundError):
            mistake_service.get_mistake(self.session, user.id, uuid.uuid4())

    # --- set_review_status --------------------------------------------------

    def test_set_status_updates_and_persists(self) -> None:
        user = self._make_user()
        mistake = self._make_mistake(user, "题", "pending")
        updated = mistake_service.set_review_status(
            self.session, user.id, mistake.id, "scheduled"
        )
        self.assertEqual(updated.review_status, "scheduled")

        self.session.expire_all()
        reloaded = self.session.scalar(
            select(Mistake).where(Mistake.id == mistake.id)
        )
        self.assertEqual(reloaded.review_status, "scheduled")

    def test_set_invalid_status_raises_validation(self) -> None:
        user = self._make_user()
        mistake = self._make_mistake(user, "题", "pending")
        with self.assertRaises(MistakeReviewStatusValidationError) as ctx:
            mistake_service.set_review_status(
                self.session, user.id, mistake.id, "archived"
            )
        self.assertEqual(ctx.exception.code, "VALIDATION")
        self.session.expire_all()
        untouched = self.session.scalar(
            select(Mistake).where(Mistake.id == mistake.id)
        )
        self.assertEqual(untouched.review_status, "pending")

    def test_set_status_foreign_mistake_raises_not_found(self) -> None:
        owner = self._make_user("owner")
        intruder = self._make_user("intruder")
        mistake = self._make_mistake(owner, "题", "pending")
        with self.assertRaises(MistakeNotFoundError):
            mistake_service.set_review_status(
                self.session, intruder.id, mistake.id, "done"
            )
        self.session.expire_all()
        untouched = self.session.scalar(
            select(Mistake).where(Mistake.id == mistake.id)
        )
        self.assertEqual(untouched.review_status, "pending")


if __name__ == "__main__":
    unittest.main()
