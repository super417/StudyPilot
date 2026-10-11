"""Process-local material-task previews. Nothing here is confirmed or stored."""

from dataclasses import dataclass
import uuid


@dataclass
class MaterialTaskPreview:
    user_id: uuid.UUID
    preview_id: str
    generation_id: str
    comparison_id: str
    selected_candidate_id: str
    plan_id: str | None
    goal: dict
    basis: dict
    phases: list
    validation: dict
    empty_dates: list[str]
    preview_version: int = 0
    status: str = "published"
    confirm_open: bool = False
    display_name: str = ""


class MaterialTaskPreviewStore:
    def __init__(self) -> None:
        self._generation: dict[uuid.UUID, str] = {}
        self._current: dict[uuid.UUID, MaterialTaskPreview] = {}
        self._by_id: dict[str, MaterialTaskPreview] = {}
        self._version: dict[uuid.UUID, int] = {}

    def claim(self, user_id: uuid.UUID, generation_id: str) -> None:
        """Start a generation and drop any preview that could still be confirmed."""
        self._generation[user_id] = generation_id
        previous = self._current.pop(user_id, None)
        if previous is not None:
            previous.status = "superseded"
            previous.confirm_open = False

    def generation(self, user_id: uuid.UUID) -> str | None:
        return self._generation.get(user_id)

    def publish(self, item: MaterialTaskPreview) -> bool:
        if self._generation.get(item.user_id) != item.generation_id:
            return False
        version = self._version.get(item.user_id, 0) + 1
        self._version[item.user_id] = version
        item.preview_version = version
        item.status = "published"
        item.confirm_open = False
        self._current[item.user_id] = item
        self._by_id[item.preview_id] = item
        return True

    def current(self, user_id: uuid.UUID) -> MaterialTaskPreview | None:
        item = self._current.get(user_id)
        if item is None or item.status != "published":
            return None
        return item

    def clear(self) -> None:
        self._generation.clear()
        self._current.clear()
        self._by_id.clear()
        self._version.clear()


material_task_preview_store = MaterialTaskPreviewStore()
