from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    """Create the configured SQLAlchemy engine once per process."""
    database_url = get_settings().database_url

    if make_url(database_url).get_backend_name() == "sqlite":
        return create_engine(database_url, connect_args={"check_same_thread": False})

    return create_engine(database_url)


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    """Create the configured SQLAlchemy session factory once per process."""
    return sessionmaker(
        bind=get_engine(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )


def get_db() -> Generator[Session, None, None]:
    """Yield a database session and close it after the request."""
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()
