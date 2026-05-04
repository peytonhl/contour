from logging.config import fileConfig
from pathlib import Path
import os
import sys

from sqlalchemy import engine_from_config, pool
from alembic import context

# Make sure the backend package is importable
_backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(_backend_dir))

# Load .env before importing database so DATABASE_URL is in os.environ
try:
    from dotenv import load_dotenv
    load_dotenv(_backend_dir / ".env", override=False)
except ImportError:
    pass

from database import Base, DATABASE_URL
import models  # noqa: F401 — ensures all models are registered on Base.metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Use the sync version of the URL for Alembic (strip +asyncpg / +aiosqlite)
def _sync_url(url: str) -> str:
    return (
        url.replace("postgresql+asyncpg://", "postgresql+pg8000://")
           .replace("postgresql://", "postgresql+pg8000://")
           .replace("sqlite+aiosqlite://", "sqlite://")
    )

SYNC_URL = _sync_url(DATABASE_URL)


def run_migrations_offline() -> None:
    context.configure(
        url=SYNC_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from sqlalchemy import create_engine
    connectable = create_engine(SYNC_URL, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
