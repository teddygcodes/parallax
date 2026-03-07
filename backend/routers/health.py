from fastapi import APIRouter
from sqlalchemy import inspect, text
from ..database import engine, get_redis

router = APIRouter()

# Tables to exclude from the count (internal/system tables)
EXCLUDED_TABLES = {"alembic_version"}


@router.get("/health")
def health_check():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
        inspector = inspect(engine)
        all_tables = inspector.get_table_names()
        table_count = len([t for t in all_tables if t not in EXCLUDED_TABLES])
    except Exception:
        db_ok = False
        table_count = 0

    try:
        r = get_redis()
        r.ping()
        redis_ok = True
    except Exception:
        redis_ok = False

    return {
        "status": "healthy" if db_ok and redis_ok else "degraded",
        "db_connected": db_ok,
        "redis_connected": redis_ok,
        "tables": table_count,
    }
