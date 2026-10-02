from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    database_url: str = Field(validation_alias="DATABASE_URL")
    db_password: str = Field(validation_alias="DB_PASSWORD")
    aes_key: str = Field(validation_alias="AES_KEY")
    session_timeout_minutes: int = Field(default=30, validation_alias="SESSION_TIMEOUT_MINUTES")


@lru_cache
def get_settings() -> Settings:
    """Load and cache settings only when configuration is needed."""
    return Settings()
