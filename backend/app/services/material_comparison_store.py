"""Process-local material comparison. One current comparison per user.

Restart drops every comparison. Callers still apply the 30-minute limit;
forgetting a frontend id does not remove the server object early.
"""

from dataclasses import dataclass, field
from datetime import datetime
import uuid


@dataclass
class MaterialComparison:
    user_id: uuid.UUID
    comparison_id: str
    created_at: datetime
    goal: dict
    plan_id: str | None
    candidates: list[dict]
    selected_id: str | None = None
    suggestion: dict = field(default_factory=dict)


class MaterialComparisonStore:
    def __init__(self) -> None:
        self._by_user: dict[uuid.UUID, MaterialComparison] = {}
        self._by_id: dict[str, MaterialComparison] = {}
        self._current: dict[uuid.UUID, str] = {}

    def claim(self, user_id: uuid.UUID, comparison_id: str) -> None:
        """Mark this comparison as the user's current attempt before any await."""
        self._current[user_id] = comparison_id

    def publish(self, item: MaterialComparison) -> bool:
        """Store the result only when this attempt is still the current one."""
        if self._current.get(item.user_id) != item.comparison_id:
            return False
        self.put(item)
        return True

    def put(self, item: MaterialComparison) -> None:
        previous = self._by_user.get(item.user_id)
        if previous is not None:
            self._by_id.pop(previous.comparison_id, None)
        self._by_user[item.user_id] = item
        self._by_id[item.comparison_id] = item

    def get(self, comparison_id: str, user_id: uuid.UUID) -> MaterialComparison | None:
        item = self._by_id.get(comparison_id)
        if item is None or item.user_id != user_id:
            return None
        if self._current.get(user_id) != comparison_id:
            return None
        return item

    def clear(self) -> None:
        self._by_user.clear()
        self._by_id.clear()
        self._current.clear()


material_comparison_store = MaterialComparisonStore()
