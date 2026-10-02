import base64
import os
import unittest
from datetime import date

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import CheckIn, User
from app.services import checkin_service
from app.services.checkin_service import CheckInValidationError


class CheckInServiceTests(unittest.TestCase):
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

    def test_create_check_in_persists_and_reads_back(self) -> None:
        user = self._make_user()
        check_in = checkin_service.create_check_in(
            self.session, user.id, date(2025, 2, 10), 90, 3, 4, "专注"
        )
        stored = self.session.scalar(
            select(CheckIn).where(CheckIn.id == check_in.id)
        )
        self.assertIsNotNone(stored)
        self.assertEqual(stored.duration_minutes, 90)
        self.assertEqual(stored.difficulty, 3)
        self.assertEqual(stored.energy, 4)
        self.assertEqual(stored.note, "专注")
        self.assertEqual(stored.check_date, date(2025, 2, 10))

    def _assert_rejected(self, duration: int, difficulty: int, energy: int) -> None:
        user = self._make_user()
        with self.assertRaises(CheckInValidationError) as ctx:
            checkin_service.create_check_in(
                self.session, user.id, date(2025, 2, 10), duration, difficulty, energy
            )
        self.assertEqual(ctx.exception.code, "VALIDATION")
        # Nothing was written.
        rows = list(
            self.session.scalars(select(CheckIn).where(CheckIn.user_id == user.id))
        )
        self.assertEqual(rows, [])

    def test_zero_duration_rejected_without_write(self) -> None:
        self._assert_rejected(0, 3, 3)

    def test_negative_duration_rejected_without_write(self) -> None:
        self._assert_rejected(-5, 3, 3)

    def test_difficulty_below_range_rejected(self) -> None:
        self._assert_rejected(60, 0, 3)

    def test_difficulty_above_range_rejected(self) -> None:
        self._assert_rejected(60, 6, 3)

    def test_energy_out_of_range_rejected(self) -> None:
        self._assert_rejected(60, 3, 6)
        self._assert_rejected(60, 3, 0)


if __name__ == "__main__":
    unittest.main()
