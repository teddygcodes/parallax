from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import redis as redis_lib
from .config import settings

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_redis():
    return redis_lib.from_url(settings.redis_url)
