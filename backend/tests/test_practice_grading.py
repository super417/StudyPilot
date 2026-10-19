"""Grading writes evidence. Mastery is that ledger, not task completion."""

import asyncio
import base64
import os
import unittest
from datetime import date, datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import (
    ApiConfig,
    CheckIn,
    DailyTask,
    MasteryEvidence,
    Phase,
    Plan,
    PracticeQuestion,
    User,
    UserDocument,
)
from app.services import practice_service, weekly_review_service
from app.services.practice_service import (
    ExplanationInsufficientEvidenceError,
    PracticeGradeError,
)


class PracticeGradingTests(unittest.TestCase):
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
        self.today = datetime.now(timezone.utc).date()
        self.week_start, self.week_end = weekly_review_service.week_bounds(self.today)

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _user(self) -> User:
        user = User(username=f"grader-{os.urandom(4).hex()}", password_hash="x")
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

    def _phase(self, user: User, name: str = "阶段一") -> tuple[Plan, Phase]:
        plan = Plan(
            user_id=user.id,
            goal_name="阶段目标",
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
            name=name,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
        )
        self.session.add(phase)
        self.session.commit()
        return plan, phase

    def _task(self, plan: Plan, phase: Phase, status: str = "done") -> DailyTask:
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=self.today,
            week_label="W42",
            description="复述中值定理",
            status=status,
        )
        self.session.add(task)
        self.session.commit()
        return task

    def _question(
        self, user: User, task: DailyTask | None, text: str = "中值定理要求函数在闭区间上怎样"
    ) -> PracticeQuestion:
        row = PracticeQuestion(
            user_id=user.id,
            source="generated",
            subject="数学",
            question=text,
            answer="连续",
            explanation="",
            source_task_id=None if task is None else task.id,
            status="pending",
        )
        self.session.add(row)
        self.session.commit()
        return row

    def _chunk(self, user: User, content: str, doc_id: str = "notes") -> None:
        self.session.add(
            UserDocument(
                user_id=user.id,
                doc_id=doc_id,
                filename="笔记.txt",
                file_type="txt",
                chunk_index=0,
                content=content,
            )
        )
        self.session.commit()

    def test_empty_retrieval_does_not_generate_questions(self) -> None:
        user = self._user()
        self._verified(user)
        plan, phase = self._phase(user)
        self._task(plan, phase)
        self._chunk(user, "叶绿体在光合作用中吸收光能")
        calls = {"n": 0}

        def generator(lines, context):
            calls["n"] += 1
            return {
                "questions": [
                    {
                        "subject": "数学",
                        "question": "不该出现",
                        "answer": "不该出现",
                        "explanation": "",
                    }
                ]
            }

        rows = asyncio.run(
            practice_service.generate_for_day(
                self.session, user.id, self.today, generator
            )
        )
        self.assertEqual(rows, [])
        self.assertEqual(calls["n"], 0)
        stored = list(self.session.scalars(select(PracticeQuestion)))
        self.assertEqual(stored, [])

    def test_grade_writes_one_evidence_row_on_the_phase(self) -> None:
        user = self._user()
        plan, phase = self._phase(user)
        task = self._task(plan, phase)
        question = self._question(user, task)
        self._chunk(user, "中值定理要求函数在闭区间连续、开区间可导")

        def grader(question_text, answer, source):
            self.assertIn("中值定理", source)
            return {"result": "correct", "reason": "作答与摘录里的连续条件一致", "error_tag": ""}

        row = asyncio.run(
            practice_service.grade_answer(
                self.session, user.id, question.id, "闭区间连续", grader
            )
        )
        stored = list(self.session.scalars(select(MasteryEvidence)))
        self.assertEqual(len(stored), 1)
        self.assertEqual(row.knowledge_point, phase.id)
        self.assertEqual(row.evidence_type, "quiz")
        self.assertEqual(row.result, "correct")
        self.assertEqual(row.source_ref, "notes#0")
        self.assertEqual(row.question_id, question.id)

    def test_null_source_task_is_excluded_from_every_phase(self) -> None:
        user = self._user()
        plan, phase = self._phase(user)
        self._task(plan, phase)
        question = self._question(user, None)

        def grader(question_text, answer, source):
            return {"result": "wrong", "reason": "资料中的原文说答案是连续", "error_tag": "概念"}

        row = asyncio.run(
            practice_service.grade_answer(
                self.session, user.id, question.id, "可导即可", grader
            )
        )
        self.assertIsNone(row.knowledge_point)
        self.assertIsNone(row.source_ref)
        self.assertNotIn("原文", row.grade_reason or "")
        self.assertNotIn("资料中", row.grade_reason or "")
        _avg, detail = weekly_review_service.phase_mastery(
            self.session, user.id, self.week_start, self.week_end
        )
        self.assertEqual(len(detail), 1)
        self.assertEqual(detail[0]["phaseId"], str(phase.id))
        self.assertEqual(detail[0]["evidenceCount"], 0)
        self.assertIsNone(detail[0]["percent"])

    def test_grade_failure_writes_nothing_and_is_not_correct(self) -> None:
        user = self._user()
        plan, phase = self._phase(user)
        question = self._question(user, self._task(plan, phase))

        def broken(question_text, answer, source):
            raise RuntimeError("model down")

        with self.assertRaises(PracticeGradeError):
            asyncio.run(
                practice_service.grade_answer(
                    self.session, user.id, question.id, "连续", broken
                )
            )

        def unparsed(question_text, answer, source):
            return {"result": "yes", "reason": "看起来对"}

        with self.assertRaises(PracticeGradeError):
            asyncio.run(
                practice_service.grade_answer(
                    self.session, user.id, question.id, "连续", unparsed
                )
            )
        self.assertEqual(list(self.session.scalars(select(MasteryEvidence))), [])
        self.session.refresh(question)
        self.assertEqual(question.status, "pending")

    def test_mastery_is_not_completion_rate(self) -> None:
        user = self._user()
        plan, phase = self._phase(user)
        self.session.add(
            CheckIn(
                user_id=user.id,
                check_date=self.today,
                duration_minutes=40,
                difficulty=3,
                energy=3,
            )
        )
        self.session.commit()
        for _ in range(3):
            self._task(plan, phase, "done")
        tasks = list(
            self.session.scalars(select(DailyTask).where(DailyTask.plan_id == plan.id))
        )
        self.assertEqual(len(tasks), 3)
        questions = [self._question(user, task) for task in tasks]
        verdicts = ["correct", "wrong", "wrong"]

        def grader_for(verdict: str):
            def grader(question_text, answer, source):
                return {"result": verdict, "reason": "按作答判断", "error_tag": None}

            return grader

        for question, verdict in zip(questions, verdicts):
            asyncio.run(
                practice_service.grade_answer(
                    self.session, user.id, question.id, "我的作答", grader_for(verdict)
                )
            )

        review = weekly_review_service.generate_weekly_review(
            self.session, user.id, self.week_start, self.week_end
        )
        self.assertIsNotNone(review)
        self.assertEqual(review.completion_rate, 100)
        avg, detail = weekly_review_service.phase_mastery(
            self.session, user.id, self.week_start, self.week_end
        )
        self.assertEqual(avg, 33)
        self.assertNotEqual(review.completion_rate, avg)
        self.assertEqual(detail[0]["evidenceCount"], 3)
        self.assertEqual(detail[0]["percent"], 33)
        self.assertEqual(len(list(self.session.scalars(select(MasteryEvidence)))), 3)

    def test_explain_writes_explanation_evidence_type(self) -> None:
        user = self._user()
        plan, phase = self._phase(user)
        question = self._question(user, self._task(plan, phase))
        self._chunk(user, "中值定理要求函数在闭区间连续、开区间可导")

        def grader(question_text, answer, source):
            return {
                "result": "partial",
                "reason": "口述提到连续，摘录还要求可导",
                "error_tag": "",
                "covered": ["连续（摘录第1段）"],
                "missing": ["开区间可导"],
                "wrong": [],
            }

        row, review = asyncio.run(
            practice_service.explain_answer(
                self.session, user.id, question.id, "只要闭区间连续", grader
            )
        )
        self.assertEqual(row.evidence_type, "explanation")
        self.assertEqual(review["covered"], ["连续（摘录第1段）"])
        self.assertEqual(review["missing"], ["开区间可导"])
        stored = list(self.session.scalars(select(MasteryEvidence)))
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0].evidence_type, "explanation")

    def test_grade_answer_still_writes_quiz_by_default(self) -> None:
        user = self._user()
        plan, phase = self._phase(user)
        question = self._question(user, self._task(plan, phase))
        self._chunk(user, "中值定理要求函数在闭区间连续")

        def grader(question_text, answer, source):
            return {"result": "correct", "reason": "一致", "error_tag": ""}

        row = asyncio.run(
            practice_service.grade_answer(
                self.session, user.id, question.id, "连续", grader
            )
        )
        self.assertEqual(row.evidence_type, "quiz")

    def test_explain_without_source_short_circuits_and_skips_model(self) -> None:
        user = self._user()
        plan, phase = self._phase(user)
        question = self._question(user, self._task(plan, phase))
        calls = {"n": 0}

        def grader(question_text, answer, source):
            calls["n"] += 1
            return {
                "result": "correct",
                "reason": "不该调用",
                "error_tag": "",
                "covered": [],
                "missing": [],
                "wrong": [],
            }

        with self.assertRaises(ExplanationInsufficientEvidenceError) as raised:
            asyncio.run(
                practice_service.explain_answer(
                    self.session, user.id, question.id, "我口述一下", grader
                )
            )
        self.assertIn("依据不足", str(raised.exception))
        self.assertEqual(calls["n"], 0)
        self.assertEqual(list(self.session.scalars(select(MasteryEvidence))), [])

    def test_explanation_evidence_enters_phase_mastery_average(self) -> None:
        user = self._user()
        plan, phase = self._phase(user)
        task = self._task(plan, phase)
        quiz_q = self._question(user, task, "闭区间条件")
        explain_q = self._question(user, task, "可导条件")
        self._chunk(user, "中值定理要求函数在闭区间连续、开区间可导")

        def quiz_grader(question_text, answer, source):
            return {"result": "correct", "reason": "对", "error_tag": ""}

        def explain_grader(question_text, answer, source):
            return {
                "result": "wrong",
                "reason": "口述与摘录不符",
                "error_tag": "",
                "covered": [],
                "missing": ["开区间可导"],
                "wrong": ["说成只要连续"],
            }

        asyncio.run(
            practice_service.grade_answer(
                self.session, user.id, quiz_q.id, "连续", quiz_grader
            )
        )
        asyncio.run(
            practice_service.explain_answer(
                self.session, user.id, explain_q.id, "只要连续", explain_grader
            )
        )
        rows = list(self.session.scalars(select(MasteryEvidence)))
        self.assertEqual(len(rows), 2)
        types = sorted(row.evidence_type for row in rows)
        self.assertEqual(types, ["explanation", "quiz"])
        _avg, detail = weekly_review_service.phase_mastery(
            self.session, user.id, self.week_start, self.week_end
        )
        self.assertEqual(detail[0]["phaseId"], str(phase.id))
        self.assertEqual(detail[0]["evidenceCount"], 2)
        self.assertEqual(detail[0]["percent"], 50)


if __name__ == "__main__":
    unittest.main()
