import pytest

from app.services.resume_polish_service import validate_polished_payload


INPUT = {
    "skills": [{
        "skill": "数据处理",
        "phase": "第 2 阶段：数据处理",
        "evidenceCount": 5,
        "masteryPercent": 75,
        "description": "已有作答证据支持本阶段的学习表现。",
    }]
}


def test_only_description_may_change():
    candidate = {"skills": [{**INPUT["skills"][0], "description": "作答记录显示该阶段已有学习表现。"}]}
    assert validate_polished_payload(INPUT, candidate) == candidate


@pytest.mark.parametrize("field,value", [
    ("skill", "新技能"),
    ("phase", "第 3 阶段"),
    ("evidenceCount", 6),
    ("masteryPercent", 76),
])
def test_protected_fields_must_match(field, value):
    candidate = {"skills": [{**INPUT["skills"][0], field: value}]}
    with pytest.raises(ValueError):
        validate_polished_payload(INPUT, candidate)


def test_rejects_extra_fields_and_new_numbers_in_description():
    with pytest.raises(ValueError):
        validate_polished_payload(INPUT, {"skills": [{**INPUT["skills"][0], "password_hash": "secret"}]})
    with pytest.raises(ValueError):
        validate_polished_payload(INPUT, {"skills": [{**INPUT["skills"][0], "description": "完成 100 个项目"}]})
