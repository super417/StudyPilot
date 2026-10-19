"""Process-cached loaders for repo-root ``data/*.json`` files.

Missing or corrupt files raise ``DataFileError`` — never silent empty lists.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path


class DataFileError(RuntimeError):
    """Raised when a data file is missing or not valid JSON."""


def data_dir() -> Path:
    # core → app → backend → study-pilot
    return Path(__file__).resolve().parents[3] / "data"


def _load(name: str) -> dict:
    path = data_dir() / name
    if not path.is_file():
        raise DataFileError(f"数据文件不存在: {name}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise DataFileError(f"数据文件损坏: {name}") from error
    if not isinstance(payload, dict):
        raise DataFileError(f"数据文件格式错误: {name}")
    return payload


@lru_cache
def load_jobs() -> dict:
    return _load("jobs.json")


@lru_cache
def load_courses() -> dict:
    return _load("courses.json")


def clear_data_cache() -> None:
    load_jobs.cache_clear()
    load_courses.cache_clear()
