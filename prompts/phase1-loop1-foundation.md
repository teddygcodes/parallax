# PARALLAX Phase 1 — Loop 1: Foundation

You are building PARALLAX, a real-time global conflict intelligence platform.
Full spec is at: PARALLAXprompt.md — read it before starting.

## ALWAYS START HERE — CHECK WHAT EXISTS

Before doing anything, run these checks and note what's already done:
```bash
ls -la                                     # what's at project root?
ls -la backend/ 2>/dev/null               # does backend exist?
ls -la backend/alembic/ 2>/dev/null       # have migrations been created?
docker exec parallax-db psql -U postgres -d parallax -c "\dt" 2>/dev/null  # do tables exist?
cd backend && python -m pytest tests/ --tb=no -q 2>/dev/null               # do tests pass?
```
Only build what's missing. Never overwrite files that already exist and work.

## WHAT YOU ARE BUILDING

### 1. docker-compose.yml (project root)
```yaml
version: '3.8'
services:
  db:
    image: postgres:16
    container_name: parallax-db
    environment:
      POSTGRES_DB: parallax
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    container_name: parallax-redis
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### 2. .env.example (project root)
```
ANTHROPIC_API_KEY=
ACLED_EMAIL=
ACLED_KEY=
NEWSAPI_KEY=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/parallax
REDIS_URL=redis://localhost:6379
```

### 3. backend/requirements.txt
```
fastapi==0.111.0
uvicorn[standard]==0.29.0
sqlalchemy==2.0.30
alembic==1.13.1
psycopg2-binary==2.9.9
redis==5.0.4
celery==5.4.0
pydantic==2.7.1
pydantic-settings==2.2.1
anthropic==0.28.0
httpx==0.27.0
pytest==8.2.0
pytest-asyncio==0.23.6
httpx==0.27.0
```

### 4. Database Models — 4 tables matching the spec exactly

**backend/models/base.py**
```python
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass
```

**backend/models/event.py**
```python
import enum
from datetime import datetime
from sqlalchemy import Column, String, Float, DateTime, Enum
from sqlalchemy.orm import relationship
from .base import Base

class EventType(str, enum.Enum):
    STRIKE = "STRIKE"
    MISSILE = "MISSILE"
    DRONE = "DRONE"
    NAVAL = "NAVAL"
    TROOP = "TROOP"

class ConfidenceLevel(str, enum.Enum):
    VERIFIED = "VERIFIED"
    LIKELY = "LIKELY"
    REPORTED = "REPORTED"
    UNCONFIRMED = "UNCONFIRMED"
    DISPUTED = "DISPUTED"

class Event(Base):
    __tablename__ = "event"

    id = Column(String, primary_key=True)  # EVT-2026-000001 format
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    first_detection_time = Column(DateTime(timezone=True), nullable=False)
    event_type = Column(Enum(EventType), nullable=False)
    confidence = Column(Enum(ConfidenceLevel), default=ConfidenceLevel.UNCONFIRMED)
    cluster_radius_km = Column(Float, default=5.0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    signals = relationship("Signal", back_populates="event")
    claims = relationship("Claim", back_populates="event")
```

**backend/models/signal.py**
```python
import enum
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Enum
from sqlalchemy.orm import relationship
from .base import Base

class SourceCategory(str, enum.Enum):
    WESTERN = "WESTERN"
    RUSSIAN = "RUSSIAN"
    MIDDLE_EAST = "MIDDLE_EAST"
    OSINT = "OSINT"
    LOCAL = "LOCAL"

class Signal(Base):
    __tablename__ = "signals"

    id = Column(String, primary_key=True)
    event_id = Column(String, ForeignKey("event.id"), nullable=False)
    source = Column(String, nullable=False)
    source_category = Column(Enum(SourceCategory), nullable=False)
    article_url = Column(String)
    published_at = Column(DateTime(timezone=True), nullable=False)
    raw_text = Column(Text)
    coordinates_mentioned = Column(String)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    event = relationship("Event", back_populates="signals")
```

**backend/models/claim.py**
```python
import enum
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Enum, Float
from sqlalchemy.orm import relationship
from .base import Base

class ClaimStatus(str, enum.Enum):
    VERIFIED = "VERIFIED"
    UNVERIFIED = "UNVERIFIED"
    DISPUTED = "DISPUTED"
    DISPROVEN = "DISPROVEN"
    COORDINATED_MESSAGING_SUSPECTED = "COORDINATED_MESSAGING_SUSPECTED"

class Claim(Base):
    __tablename__ = "claims"

    id = Column(String, primary_key=True)
    event_id = Column(String, ForeignKey("event.id"), nullable=False)
    claim_text = Column(Text, nullable=False)
    source = Column(String, nullable=False)
    source_category = Column(String, nullable=False)
    first_seen_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(Enum(ClaimStatus), default=ClaimStatus.UNVERIFIED)
    confidence_score = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    event = relationship("Event", back_populates="claims")
    history = relationship("NarrativeHistory", back_populates="claim")
```

**backend/models/narrative.py**
```python
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from .base import Base

class NarrativeHistory(Base):
    __tablename__ = "narrative_history"

    id = Column(String, primary_key=True)
    claim_id = Column(String, ForeignKey("claims.id"), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    status_before = Column(String, nullable=False)
    status_after = Column(String, nullable=False)
    trigger = Column(Text)
    notes = Column(Text)

    claim = relationship("Claim", back_populates="history")
```

**backend/models/__init__.py**
```python
from .base import Base
from .event import Event, EventType, ConfidenceLevel
from .signal import Signal, SourceCategory
from .claim import Claim, ClaimStatus
from .narrative import NarrativeHistory

__all__ = [
    "Base", "Event", "EventType", "ConfidenceLevel",
    "Signal", "SourceCategory", "Claim", "ClaimStatus", "NarrativeHistory"
]
```

### 5. backend/config.py
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:postgres@localhost:5432/parallax"
    redis_url: str = "redis://localhost:6379"
    anthropic_api_key: str = ""
    acled_email: str = ""
    acled_key: str = ""
    newsapi_key: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
```

### 6. backend/database.py
```python
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
```

### 7. Alembic setup

Run once:
```bash
cd backend
pip install -r requirements.txt
alembic init alembic
```

Edit `alembic/env.py` — add these imports at the top after existing imports:
```python
from backend.config import settings
from backend.models import Base

# In run_migrations_offline() and run_migrations_online(), set:
config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata
```

Then:
```bash
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

### 8. backend/services/clustering.py (haversine — NO geopy, pure Python only)
```python
from math import radians, sin, cos, sqrt, atan2
from datetime import datetime

TYPE_SIMILARITY = {
    ("STRIKE", "STRIKE"):   1.0,
    ("STRIKE", "MISSILE"):  0.8,
    ("MISSILE", "STRIKE"):  0.8,
    ("STRIKE", "DRONE"):    0.5,
    ("DRONE", "STRIKE"):    0.5,
    ("DRONE", "DRONE"):     1.0,
    ("NAVAL", "NAVAL"):     1.0,
    ("NAVAL", "STRIKE"):    0.2,
    ("STRIKE", "NAVAL"):    0.2,
    ("TROOP", "TROOP"):     1.0,
}

DISTANCE_THRESHOLD_KM = 5.0
TIME_THRESHOLD_MINUTES = 60
TYPE_SIMILARITY_THRESHOLD = 0.7

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1-a))

def type_similarity(type_a: str, type_b: str) -> float:
    return TYPE_SIMILARITY.get((type_a, type_b), 0.0)

def should_cluster(
    signal_lat: float, signal_lon: float, signal_time: datetime, signal_type: str,
    event_lat: float, event_lon: float, event_time: datetime, event_type: str
) -> bool:
    dist = haversine_km(signal_lat, signal_lon, event_lat, event_lon)
    if dist >= DISTANCE_THRESHOLD_KM:
        return False
    delta_minutes = abs((signal_time - event_time).total_seconds()) / 60
    if delta_minutes >= TIME_THRESHOLD_MINUTES:
        return False
    sim = type_similarity(signal_type, event_type)
    if sim < TYPE_SIMILARITY_THRESHOLD:
        return False
    return True
```

### 9. backend/main.py
```python
from fastapi import FastAPI
from .routers import health, events, ingest

app = FastAPI(title="PARALLAX API", version="0.1.0")
app.include_router(health.router)
app.include_router(events.router)
app.include_router(ingest.router)
```

### 10. backend/routers/health.py
```python
from fastapi import APIRouter
from sqlalchemy import inspect, text
from ..database import engine, get_redis

router = APIRouter()

@router.get("/health")
def health_check():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
        inspector = inspect(engine)
        table_count = len(inspector.get_table_names())
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
        "tables": table_count
    }
```

### 11. backend/routers/events.py — with seeded mock data
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Event, Signal, SourceCategory, EventType, ConfidenceLevel
from ..services.ai_analysis import get_analysis
from datetime import datetime, timezone
import uuid

router = APIRouter()

def seed_mock_events(db: Session):
    """Seed mock events if DB is empty — enables verification curls before real ingestion."""
    if db.query(Event).count() > 0:
        return
    mock_event = Event(
        id="EVT-2026-000001",
        lat=31.343,
        lng=34.305,
        first_detection_time=datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc),
        event_type=EventType.STRIKE,
        confidence=ConfidenceLevel.REPORTED,
    )
    db.add(mock_event)
    mock_signals = [
        Signal(id=str(uuid.uuid4()), event_id="EVT-2026-000001",
               source="Reuters", source_category=SourceCategory.WESTERN,
               published_at=datetime(2026, 3, 4, 18, 10, tzinfo=timezone.utc),
               description="Strike confirmed at reported location. Military sources cited."),
        Signal(id=str(uuid.uuid4()), event_id="EVT-2026-000001",
               source="RT", source_category=SourceCategory.RUSSIAN,
               published_at=datetime(2026, 3, 4, 18, 45, tzinfo=timezone.utc),
               description="Attack on civilian infrastructure. No military targets confirmed."),
        Signal(id=str(uuid.uuid4()), event_id="EVT-2026-000001",
               source="Bellingcat", source_category=SourceCategory.OSINT,
               published_at=datetime(2026, 3, 4, 21, 30, tzinfo=timezone.utc),
               description="Geolocated video confirms strike coordinates. Target unclear."),
    ]
    for s in mock_signals:
        db.add(s)
    db.commit()

@router.get("/events")
def list_events(limit: int = 20, offset: int = 0, db: Session = Depends(get_db)):
    seed_mock_events(db)
    total = db.query(Event).count()
    events = db.query(Event).offset(offset).limit(limit).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "events": [
            {
                "id": e.id,
                "lat": e.lat,
                "lng": e.lng,
                "event_type": e.event_type.value,
                "confidence": e.confidence.value,
                "first_detection_time": e.first_detection_time.isoformat(),
                "signal_count": len(e.signals),
            }
            for e in events
        ]
    }

@router.get("/events/{event_id}/signals")
def get_event_signals(event_id: str, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")
    return [
        {
            "id": s.id,
            "source": s.source,
            "source_category": s.source_category.value,
            "published_at": s.published_at.isoformat(),
            "description": s.description,
            "article_url": s.article_url,
        }
        for s in sorted(event.signals, key=lambda x: x.published_at)
    ]

@router.get("/events/{event_id}/analysis")
def get_event_analysis(event_id: str, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")
    signals_data = [
        {"source": s.source, "source_category": s.source_category.value, "description": s.description or ""}
        for s in event.signals
    ]
    return get_analysis(event_id, signals_data)
```

### 12. backend/services/ai_analysis.py (stub for Loop 1, full version in Loop 3)
```python
import os

def get_analysis(event_id: str, signals: list) -> dict:
    """Stub for Loop 1. Full Anthropic integration in Loop 3."""
    source_categories = list(set(s.get("source_category", "UNKNOWN") for s in signals))
    divergence = 0.3 if len(source_categories) <= 1 else 0.6 if len(source_categories) <= 2 else 0.82
    return {
        "what_is_confirmed": "Explosion detected at reported coordinates. Geolocated video verified by OSINT sources.",
        "what_is_disputed": "Target type and casualty figures vary significantly across sources.",
        "where_information_goes_dark": "No independent access to site. Satellite imagery pending.",
        "core_disagreement": "Who launched the strike and what the intended target was.",
        "divergence_score": divergence,
        "coordinated_messaging_suspected": False,
    }
```

### 13. backend/routers/ingest.py — test-cluster endpoint
```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from ..database import get_db
from ..services.clustering import should_cluster
from ..models import Event, Signal, EventType, ConfidenceLevel, SourceCategory
import uuid

router = APIRouter(prefix="/ingest")

@router.post("/test-cluster")
def test_cluster(db: Session = Depends(get_db)):
    """
    Validates clustering: feeds 3 near-identical signals, must produce 1 event not 3.
    The clustering logic actually runs — response is NOT hardcoded.
    """
    db.query(Signal).filter(Signal.source == "TEST_CLUSTER").delete()
    db.query(Event).filter(Event.id.like("EVT-TEST-%")).delete()
    db.commit()

    test_signals = [
        {"lat": 31.343, "lon": 34.305, "time": datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc),  "type": "STRIKE"},
        {"lat": 31.345, "lon": 34.307, "time": datetime(2026, 3, 4, 18, 10, tzinfo=timezone.utc), "type": "STRIKE"},
        {"lat": 31.341, "lon": 34.302, "time": datetime(2026, 3, 4, 18, 22, tzinfo=timezone.utc), "type": "STRIKE"},
    ]

    events_created = []
    signals_merged = 0

    for i, sig_data in enumerate(test_signals):
        merged = False
        for ev in events_created:
            if should_cluster(
                sig_data["lat"], sig_data["lon"], sig_data["time"], sig_data["type"],
                ev["lat"], ev["lon"], ev["time"], ev["type"]
            ):
                signal = Signal(
                    id=str(uuid.uuid4()),
                    event_id=ev["id"],
                    source="TEST_CLUSTER",
                    source_category=SourceCategory.OSINT,
                    published_at=sig_data["time"],
                    description=f"Test signal {i+1}",
                )
                db.add(signal)
                signals_merged += 1
                merged = True
                break

        if not merged:
            event_id = f"EVT-TEST-{len(events_created)+1:06d}"
            event = Event(
                id=event_id,
                lat=sig_data["lat"],
                lng=sig_data["lon"],
                first_detection_time=sig_data["time"],
                event_type=EventType(sig_data["type"]),
                confidence=ConfidenceLevel.UNCONFIRMED,
            )
            db.add(event)
            db.flush()
            signal = Signal(
                id=str(uuid.uuid4()),
                event_id=event_id,
                source="TEST_CLUSTER",
                source_category=SourceCategory.OSINT,
                published_at=sig_data["time"],
                description=f"Test signal {i+1}",
            )
            db.add(signal)
            events_created.append({"id": event_id, **sig_data})

    db.commit()

    return {
        "signals_received": len(test_signals),
        "events_created": len(events_created),
        "events_merged": signals_merged,
        "cluster_id": events_created[0]["id"] if events_created else None
    }
```

### 14. backend/tests/conftest.py
```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from backend.models import Base
from backend.main import app
from backend.database import get_db

TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/parallax_test"

@pytest.fixture(scope="session")
def db_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)

@pytest.fixture
def db_session(db_engine):
    Session = sessionmaker(bind=db_engine)
    session = Session()
    yield session
    session.rollback()
    session.close()

@pytest.fixture
def test_client(db_session):
    def override_get_db():
        yield db_session
    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
```

### 15. backend/tests/test_schema.py
```python
def test_all_four_tables_exist(db_engine):
    from sqlalchemy import inspect
    inspector = inspect(db_engine)
    tables = inspector.get_table_names()
    assert "event" in tables, f"'event' table missing. Found: {tables}"
    assert "signals" in tables, f"'signals' table missing. Found: {tables}"
    assert "claims" in tables, f"'claims' table missing. Found: {tables}"
    assert "narrative_history" in tables, f"'narrative_history' table missing. Found: {tables}"

def test_foreign_keys(db_engine):
    from sqlalchemy import inspect
    inspector = inspect(db_engine)
    signal_fks = [fk["referred_table"] for fk in inspector.get_foreign_keys("signals")]
    assert "event" in signal_fks
    claim_fks = [fk["referred_table"] for fk in inspector.get_foreign_keys("claims")]
    assert "event" in claim_fks
    narrative_fks = [fk["referred_table"] for fk in inspector.get_foreign_keys("narrative_history")]
    assert "claims" in narrative_fks

def test_event_id_format(db_session):
    from backend.models import Event, EventType, ConfidenceLevel
    from datetime import datetime, timezone
    ev = Event(
        id="EVT-2026-TEST-001",
        lat=31.343, lng=34.305,
        first_detection_time=datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc),
        event_type=EventType.STRIKE,
        confidence=ConfidenceLevel.UNCONFIRMED,
    )
    db_session.add(ev)
    db_session.commit()
    result = db_session.get(Event, "EVT-2026-TEST-001")
    assert result is not None
    assert result.lat == 31.343
```

### 16. backend/tests/test_clustering.py
```python
from datetime import datetime, timezone
from backend.services.clustering import should_cluster, haversine_km, type_similarity

def test_signals_within_threshold_cluster():
    result = should_cluster(
        31.343, 34.305, datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc), "STRIKE",
        31.345, 34.307, datetime(2026, 3, 4, 18, 23, tzinfo=timezone.utc), "STRIKE"
    )
    assert result is True

def test_signals_too_far_apart_dont_cluster():
    result = should_cluster(
        31.343, 34.305, datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc), "STRIKE",
        31.800, 34.700, datetime(2026, 3, 4, 18, 5, tzinfo=timezone.utc), "STRIKE"
    )
    assert result is False

def test_signals_too_old_dont_cluster():
    result = should_cluster(
        31.343, 34.305, datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc), "STRIKE",
        31.345, 34.307, datetime(2026, 3, 4, 21, 10, tzinfo=timezone.utc), "STRIKE"
    )
    assert result is False

def test_incompatible_types_dont_cluster():
    result = should_cluster(
        31.343, 34.305, datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc), "NAVAL",
        31.344, 34.306, datetime(2026, 3, 4, 18, 5, tzinfo=timezone.utc), "TROOP"
    )
    assert result is False

def test_strike_and_missile_cluster():
    result = should_cluster(
        31.343, 34.305, datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc), "STRIKE",
        31.344, 34.306, datetime(2026, 3, 4, 18, 10, tzinfo=timezone.utc), "MISSILE"
    )
    assert result is True

def test_haversine_known_distance():
    # Tel Aviv to Jerusalem — approximately 55km
    dist = haversine_km(32.0853, 34.7818, 31.7683, 35.2137)
    assert 50 < dist < 60
```

## COMPLETION CRITERIA

Run ALL 12 commands. Do NOT output the promise until every single one passes.

```bash
docker compose up -d
cd backend && alembic upgrade head
cd backend && pytest
curl localhost:8000/health
# Expected: {"status":"healthy","db_connected":true,"redis_connected":true,"tables":4}
curl localhost:8000/events
# Expected: {"total":N,"limit":20,"offset":0,"events":[...]}
curl localhost:8000/events/EVT-2026-000001/analysis
# Expected: JSON with what_is_confirmed, divergence_score, etc.
curl localhost:8000/events/EVT-9999/analysis
# Expected: 404 response
docker exec parallax-db psql -U postgres -d parallax -c "\dt"
# Expected: event, signals, claims, narrative_history all listed
docker exec parallax-db psql -U postgres -d parallax -c "SELECT count(*) FROM event;"
docker exec parallax-db psql -U postgres -d parallax -c "SELECT count(*) FROM signals;"
docker exec parallax-db psql -U postgres -d parallax -c "SELECT count(*) FROM claims;"
curl -X POST localhost:8000/ingest/test-cluster
# Expected: {"signals_received":3,"events_created":1,"events_merged":2,"cluster_id":"EVT-TEST-000001"}
```

Only output this when ALL 12 pass:

<promise>FOUNDATION_COMPLETE</promise>
