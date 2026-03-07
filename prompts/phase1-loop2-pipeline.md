# PARALLAX Phase 1 — Loop 2: Data Pipeline

You are building PARALLAX. The foundation (DB schema, Docker, health endpoint, clustering stub) is complete from Loop 1.
Full spec: PARALLAXprompt.md. Read it.

## ALWAYS START HERE — CHECK WHAT EXISTS

```bash
ls -la backend/workers/ 2>/dev/null
ls -la backend/services/ 2>/dev/null
cd backend && python -m pytest tests/ --tb=no -q
curl localhost:8000/events | python3 -m json.tool
curl -X POST localhost:8000/ingest/test-cluster | python3 -m json.tool
```

If Loop 1 is not complete (test-cluster returns 3 events instead of 1, or tests fail), stop and fix that first.
Only build what's missing. Do not overwrite working code.

## WHAT YOU ARE BUILDING

### 1. backend/workers/acled_worker.py — ACLED ingestion

When `ACLED_KEY` env var is set: call the real ACLED API (https://acleddata.com/acleddatanew/wp-content/uploads/2017/10/ACLED-API-User-Guide-V2.pdf).
When not set: generate 20 mock events with realistic data.

Mock event requirements:
- Cover at least 3 different regions: Middle East, Eastern Europe, Red Sea
- Include all 5 event types: STRIKE, MISSILE, DRONE, NAVAL, TROOP
- Use realistic coordinates (actual conflict zones)
- Use EVT-{year}-{seq:06d} ID format, incrementing from current DB count
- Spread across a realistic 72-hour window

```python
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from backend.models import Event, EventType, ConfidenceLevel
from backend.config import settings
import uuid

MOCK_EVENTS = [
    {"lat": 31.343, "lng": 34.305, "type": "STRIKE",  "region": "Gaza",         "hours_ago": 2},
    {"lat": 31.500, "lng": 34.450, "type": "MISSILE", "region": "Gaza",         "hours_ago": 5},
    {"lat": 48.379, "lng": 31.165, "type": "DRONE",   "region": "Ukraine",      "hours_ago": 1},
    {"lat": 49.100, "lng": 32.400, "type": "STRIKE",  "region": "Ukraine",      "hours_ago": 8},
    {"lat": 12.900, "lng": 43.300, "type": "NAVAL",   "region": "Red Sea",      "hours_ago": 3},
    {"lat": 13.200, "lng": 43.100, "type": "NAVAL",   "region": "Red Sea",      "hours_ago": 6},
    {"lat": 36.200, "lng": 37.160, "type": "STRIKE",  "region": "Syria",        "hours_ago": 12},
    {"lat": 15.355, "lng": 44.200, "type": "DRONE",   "region": "Yemen",        "hours_ago": 4},
    {"lat": 33.512, "lng": 36.291, "type": "STRIKE",  "region": "Damascus",     "hours_ago": 18},
    {"lat": 50.450, "lng": 30.523, "type": "MISSILE", "region": "Kyiv",         "hours_ago": 7},
    {"lat": 47.838, "lng": 35.139, "type": "TROOP",   "region": "Zaporizhzhia","hours_ago": 24},
    {"lat": 48.718, "lng": 37.800, "type": "STRIKE",  "region": "Donbas",      "hours_ago": 10},
    {"lat": 31.770, "lng": 35.215, "type": "DRONE",   "region": "West Bank",   "hours_ago": 2},
    {"lat": 12.500, "lng": 43.700, "type": "NAVAL",   "region": "Bab-el-Mandeb","hours_ago": 9},
    {"lat": 36.800, "lng": 36.100, "type": "MISSILE", "region": "Aleppo",      "hours_ago": 36},
    {"lat": 33.888, "lng": 35.494, "type": "DRONE",   "region": "Beirut",      "hours_ago": 14},
    {"lat": 47.500, "lng": 38.500, "type": "TROOP",   "region": "Mariupol",    "hours_ago": 48},
    {"lat": 15.552, "lng": 32.532, "type": "STRIKE",  "region": "Sudan",       "hours_ago": 20},
    {"lat": 13.180, "lng": 44.050, "type": "MISSILE", "region": "Hodeida",     "hours_ago": 15},
    {"lat": 31.600, "lng": 34.450, "type": "STRIKE",  "region": "Southern Gaza","hours_ago": 1},
]

def generate_event_id(db: Session) -> str:
    from backend.models import Event
    count = db.query(Event).filter(~Event.id.like("EVT-TEST-%")).count()
    year = datetime.utcnow().year
    return f"EVT-{year}-{count+1:06d}"

def ingest_acled(db: Session):
    if settings.acled_key and settings.acled_email:
        _ingest_real_acled(db)
    else:
        _ingest_mock_acled(db)

def _ingest_mock_acled(db: Session):
    now = datetime.now(timezone.utc)
    for mock in MOCK_EVENTS:
        event_time = now - timedelta(hours=mock["hours_ago"])
        event_id = generate_event_id(db)
        event = Event(
            id=event_id,
            lat=mock["lat"],
            lng=mock["lng"],
            first_detection_time=event_time,
            event_type=EventType(mock["type"]),
            confidence=ConfidenceLevel.REPORTED,
            cluster_radius_km=5.0,
        )
        db.add(event)
        db.flush()
    db.commit()
```

### 2. backend/workers/news_worker.py — NewsAPI/RSS ingestion

When `NEWSAPI_KEY` is set: call the real NewsAPI to find articles for each event region.
When not set: generate mock signals for each existing event.

For each event, generate at least 3 signals from different source categories.
Source categories must be: WESTERN, RUSSIAN, MIDDLE_EAST, OSINT, LOCAL.
Western and Russian signals for the same event should describe it differently.

```python
MOCK_SIGNAL_TEMPLATES = {
    "WESTERN": [
        ("Reuters", "{event_type} confirmed at {region}. Military sources cited."),
        ("AP", "Attack reported in {region}. Damage assessment ongoing."),
        ("BBC", "Strike reported near {region}. Officials have not commented."),
    ],
    "RUSSIAN": [
        ("RT", "Attack on civilian infrastructure in {region}. No military targets confirmed."),
        ("TASS", "Western-backed forces strike {region}. Civilian casualties reported."),
    ],
    "MIDDLE_EAST": [
        ("Al Jazeera", "Explosion in {region}. Conflicting accounts from officials."),
        ("IRNA", "Attack reported in {region} region. Resistance groups claim responsibility."),
    ],
    "OSINT": [
        ("Bellingcat", "Geolocated video confirms strike at {region} coordinates."),
        ("IntelliTimes", "OSINT analysis: {event_type} activity confirmed via satellite."),
    ],
    "LOCAL": [
        ("Local Telegram", "Large blast heard in {region} district."),
    ],
}

def ingest_news(db: Session):
    if settings.newsapi_key:
        _ingest_real_news(db)
    else:
        _ingest_mock_news(db)
```

### 3. Extend services/clustering.py with pipeline integration

Add to the existing clustering.py:
```python
def process_incoming_signal(signal_data: dict, db) -> str:
    """
    Given a signal dict, find nearest matching event or create new one.
    Returns the event_id this signal belongs to.
    signal_data keys: lat, lon, time (datetime), type (str)
    """
    from backend.models import Event, EventType, ConfidenceLevel
    events = db.query(Event).filter(~Event.id.like("EVT-TEST-%")).all()
    for ev in events:
        if should_cluster(
            signal_data["lat"], signal_data["lon"], signal_data["time"], signal_data["type"],
            ev.lat, ev.lng, ev.first_detection_time, ev.event_type.value
        ):
            return ev.id
    # No match — create new event
    from .event_id import generate_event_id
    event_id = generate_event_id(db)
    event = Event(
        id=event_id,
        lat=signal_data["lat"],
        lng=signal_data["lon"],
        first_detection_time=signal_data["time"],
        event_type=EventType(signal_data["type"]),
        confidence=ConfidenceLevel.UNCONFIRMED,
    )
    db.add(event)
    db.flush()
    return event_id
```

### 4. Celery config — backend/celery_app.py
```python
from celery import Celery
from .config import settings

celery_app = Celery(
    "parallax",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.beat_schedule = {
    "ingest-acled-every-5-minutes": {
        "task": "backend.workers.acled_worker.ingest_acled_task",
        "schedule": 300.0,
    },
    "ingest-news-every-10-minutes": {
        "task": "backend.workers.news_worker.ingest_news_task",
        "schedule": 600.0,
    },
}
```

### 5. GET /events/{id}/signals — already exists in Loop 1, verify it works

```bash
curl localhost:8000/events/EVT-2026-000001/signals | python3 -m json.tool
```

Must return array with source_category field on each signal.

### 6. Seed and verify

After writing workers, run them manually to seed data:
```bash
cd backend
python -c "
from backend.workers.acled_worker import ingest_acled
from backend.workers.news_worker import ingest_news
from backend.database import SessionLocal
db = SessionLocal()
ingest_acled(db)
ingest_news(db)
from backend.models import Event, Signal
print(f'Events: {db.query(Event).count()}')
print(f'Signals: {db.query(Signal).count()}')
"
```

## COMPLETION CRITERIA

All must pass. Tests must assert on actual output — not just "function ran without error."

```bash
cd backend && pytest tests/test_clustering.py -v
# All 6 tests must pass. Names:
# test_signals_within_threshold_cluster
# test_signals_too_far_apart_dont_cluster
# test_signals_too_old_dont_cluster
# test_incompatible_types_dont_cluster
# test_strike_and_missile_cluster
# test_haversine_known_distance

cd backend && python -c "
from backend.workers.acled_worker import ingest_acled
from backend.database import SessionLocal
db = SessionLocal()
ingest_acled(db)
from backend.models import Event
count = db.query(Event).filter(~Event.id.like('EVT-TEST-%')).count()
print(f'Events in DB: {count}')
assert count >= 10, f'Expected >= 10 events, got {count}'
print('PASS')
"

curl "localhost:8000/events?limit=5" | python3 -m json.tool
# Must show: total, limit, offset, events
# Each event must have signal_count field

curl localhost:8000/events/EVT-2026-000001/signals | python3 -m json.tool
# Must return array of signals, each with source_category
```

Only output this when all pass:

<promise>PIPELINE_COMPLETE</promise>
