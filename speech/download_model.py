"""Download the official checkpoint entirely into speech/."""
import os
from pathlib import Path

root = Path(__file__).resolve().parent
os.environ["HF_HOME"] = str(root / ".cache" / "huggingface")
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "120"

from huggingface_hub import snapshot_download

snapshot_download(
    "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    local_dir=root / "models" / "serena",
    ignore_patterns=["*.md", ".gitattributes"],
    max_workers=3,
)
