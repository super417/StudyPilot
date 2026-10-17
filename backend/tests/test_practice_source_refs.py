"""PracticeQuestion.source_refs persisted from build_context hits."""

from __future__ import annotations

import asyncio
import base64
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path

from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import (
    ApiConfig,
    DailyTask,
    Phase,
    Plan,
    PracticeQuestion,
    ReinforceTaskEvidence,
    User,
    UserDocument,
    MasteryEvidence,
)
from app.services import practice_service, reinforce_service


class PracticeSourceRefsTests(unittest.TestCase):
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
        self.today = date(2026, 10, 17)

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _user(self) -> User:
        user = User(username=f"src-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(user)
        self.session.commit()
        return user

    def _verified(self, user: User) -> None:
        self.session.add(
            ApiConfig(
                user_id=user.id,
                api_key_cipher="cipher",
                model_type="gpt",
                base_url="https://example.invalid/v1/chat/completions",
                is_verified=True,
            )
        )
        self.session.commit()

    def _plan_phase(self, user: User) -> tuple[Plan, Phase]:
        plan = Plan(
            user_id=user.id,
            goal_name="出处目标",
            start_date=date(2026, 1, 1),
            goal_date=date(2026, 12, 31),
            current_level="入门",
            daily_minutes=60,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="阶段一",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 6, 30),
            is_current=True,
        )
        phase_b = Phase(
            plan_id=plan.id,
            phase_index=2,
            name="阶段二",
            start_date=date(2026, 7, 1),
            end_date=date(2026, 12, 31),
            is_current=False,
        )
        self.session.add_all([phase, phase_b])
        self.session.commit()
        return plan, phase

    def _done_task(self, plan: Plan, phase: Phase, description: str) -> DailyTask:
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=self.today,
            week_label="W42",
            description=description,
            status="done",
        )
        self.session.add(task)
        self.session.commit()
        return task

    def _chunk(self, user: User, content: str) -> None:
        self.session.add(
            UserDocument(
                user_id=user.id,
                doc_id="notes",
                filename="笔记.txt",
                file_type="txt",
                chunk_index=0,
                content=content,
            )
        )
        self.session.commit()

    def test_generate_for_day_stores_source_refs_hits(self) -> None:
        user = self._user()
        self._verified(user)
        plan, phase = self._plan_phase(user)
        self._done_task(plan, phase, "先序中序还原二叉树")
        self._chunk(user, "先序+中序可唯一确定一棵二叉树；仅先序+后序一般不能。")

        def generator(lines, context):
            self.assertIn("先序", context)
            return {
                "questions": [
                    {
                        "subject": "数据结构",
                        "question": "先序和中序能否唯一确定二叉树？",
                        "answer": "能",
                        "explanation": "先序定根，中序分左右",
                    }
                ]
            }

        rows = asyncio.run(
            practice_service.generate_for_day(
                self.session, user.id, self.today, generator
            )
        )
        self.assertEqual(len(rows), 1)
        refs = rows[0].source_refs
        self.assertIsNotNone(refs)
        self.assertGreaterEqual(len(refs), 1)
        hit = refs[0]
        for key in ("docId", "filename", "chunkIndex", "snippet"):
            self.assertIn(key, hit)
        self.assertEqual(hit["filename"], "笔记.txt")
        body = practice_service._question_json(rows[0])
        self.assertEqual(body["sourceRefs"], refs)

    def test_generate_reinforce_retest_stores_source_refs(self) -> None:
        user = self._user()
        self._verified(user)
        plan, phase = self._plan_phase(user)
        done = self._done_task(plan, phase, "普通任务")
        seed_q = PracticeQuestion(
            user_id=user.id,
            source="generated",
            subject="数据结构",
            question="触发补强",
            answer="a",
            explanation="",
            source_task_id=done.id,
            status="pending",
        )
        self.session.add(seed_q)
        self.session.flush()
        seed_ev = MasteryEvidence(
            user_id=user.id,
            knowledge_point=phase.id,
            evidence_type="quiz",
            result="wrong",
            answer_text="错",
            grade_reason="错",
            source_ref="notes#0",
            question_id=seed_q.id,
        )
        self.session.add(seed_ev)
        reinforce = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=self.today,
            week_label="W42",
            description="重做错题：触发补强",
            status="pending",
        )
        self.session.add(reinforce)
        self.session.flush()
        self.session.add(
            ReinforceTaskEvidence(task_id=reinforce.id, evidence_id=seed_ev.id)
        )
        self.session.commit()
        self._chunk(user, "重做错题：触发补强 的关键结论与二叉树遍历")

        def generator(lines, context):
            return {
                "questions": [
                    {
                        "subject": "数据结构",
                        "question": "重测题",
                        "answer": "答",
                        "explanation": "",
                    }
                ]
            }

        rows = asyncio.run(
            practice_service.generate_reinforce_retest(
                self.session, user.id, phase.id, generator
            )
        )
        self.assertEqual(len(rows), 1)
        self.assertIsNotNone(rows[0].source_refs)
        self.assertGreaterEqual(len(rows[0].source_refs), 1)
        hit = rows[0].source_refs[0]
        for key in ("docId", "filename", "chunkIndex", "snippet"):
            self.assertIn(key, hit)

    def test_legacy_null_source_refs_json_is_null(self) -> None:
        user = self._user()
        row = PracticeQuestion(
            user_id=user.id,
            source="uploaded",
            subject="综合",
            question="旧题无出处",
            answer="",
            explanation="",
            source_refs=None,
            status="pending",
        )
        self.session.add(row)
        self.session.commit()
        body = practice_service._question_json(row)
        self.assertIsNone(body["sourceRefs"])

    def test_reread_description_uses_filename(self) -> None:
        user = self._user()
        self._chunk(user, "任意内容")
        text = reinforce_service._reread_description(self.session, user.id, "notes#0")
        self.assertEqual(text, "重读判分原文：笔记.txt · 第 1 段")

    def test_reread_description_keeps_raw_when_missing(self) -> None:
        user = self._user()
        text = reinforce_service._reread_description(
            self.session, user.id, "gone-doc#2"
        )
        self.assertEqual(text, "重读判分原文：gone-doc#2（来源不可用）")


class SourceRefsMigrationTests(unittest.TestCase):
    def test_upgrade_downgrade_upgrade_on_temporary_sqlite(self) -> None:
        from alembic import command
        from alembic.config import Config

        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "batch13-source-refs.db"
            previous = {
                name: os.environ.get(name)
                for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY")
            }
            os.environ["DATABASE_URL"] = f"sqlite:///{database.as_posix()}"
            os.environ["DB_PASSWORD"] = "temporary-test-password"
            os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
            get_settings.cache_clear()
            backend = Path(__file__).resolve().parents[1]
            config = Config(str(backend / "alembic.ini"))
            config.set_main_option("script_location", str(backend / "alembic"))
            config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])
            try:
                command.upgrade(config, "head")
                self._assert_column(database, True)
                command.downgrade(config, "-1")
                self._assert_column(database, False)
                command.upgrade(config, "head")
                self._assert_column(database, True)
            finally:
                get_settings.cache_clear()
                for name, value in previous.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value

    def _assert_column(self, database: Path, present: bool) -> None:
        engine = create_engine(f"sqlite:///{database.as_posix()}")
        columns = {
            column["name"]
            for column in inspect(engine).get_columns("practice_questions")
        }
        engine.dispose()
        self.assertEqual("source_refs" in columns, present)


if __name__ == "__main__":
    unittest.main()
