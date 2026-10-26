"""Evidence-backed, read-only learning resume data."""

import uuid
from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import MasteryEvidence
from app.services import planner_service, task_service, weekly_review_service


VERIFIED_MASTERY_PERCENT = 60


def build_resume(
    session: Session,
    user_id: uuid.UUID,
    week_start: date | None = None,
    week_end: date | None = None,
) -> dict[str, list[dict]]:
    """Return current-plan stages using only owned answer evidence for mastery.

    Phase names serve as the display label until a verified phase-to-skill map
    exists. Skill-gap entries are deliberately omitted for the same reason:
    a direction gap alone does not prove the user has not started that skill.
    """
    result: dict[str, list[dict]] = {"verified": [], "learned": [], "awaiting": []}
    plan = planner_service.get_latest_plan(session, user_id)
    if plan is None:
        return result

    phases = planner_service.list_phases_for_plan(session, plan.id)
    phase_ids = [phase.id for phase in phases]
    if not phase_ids:
        return result

    rows = session.scalars(
        select(MasteryEvidence).where(
            MasteryEvidence.user_id == user_id,
            MasteryEvidence.knowledge_point.in_(phase_ids),
        )
    ).all()
    by_phase: dict[uuid.UUID, list[MasteryEvidence]] = defaultdict(list)
    for row in rows:
        day = weekly_review_service._evidence_day(row.created_at)
        if day is None:
            continue
        if week_start is not None and day < week_start:
            continue
        if week_end is not None and day > week_end:
            continue
        if row.knowledge_point is not None:
            by_phase[row.knowledge_point].append(row)

    for phase in phases:
        evidence = by_phase[phase.id]
        count = len(evidence)
        percent = (
            max(
                0,
                min(
                    100,
                    round(
                        sum(
                            weekly_review_service._EVIDENCE_SCORE.get(row.result, 0)
                            for row in evidence
                        )
                        / count
                    ),
                ),
            )
            if count
            else None
        )
        item = {
            "skill": phase.name,
            "phase": f"第 {phase.phase_index} 阶段：{phase.name}",
            "evidenceCount": count,
            "masteryPercent": percent,
            "description": (
                "已有作答证据支持本阶段的学习表现。"
                if count and percent is not None and percent >= VERIFIED_MASTERY_PERCENT
                else "阶段任务已完成，仍需作答证据或更高掌握度来验证。"
            ),
        }
        if count and percent is not None and percent >= VERIFIED_MASTERY_PERCENT:
            result["verified"].append(item)
        elif task_service.phase_is_completed(session, phase.id):
            result["learned"].append(item)

    return result
