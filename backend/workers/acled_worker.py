"""
ACLED Worker — ingests conflict events from ACLED API or generates mock data.
When ACLED_KEY is set: calls real ACLED API.
When not set: generates 20 mock events covering key conflict zones.
"""
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from backend.models import Event, EventType, ConfidenceLevel
from backend.config import settings

MOCK_EVENTS = [
    {"lat": 31.343, "lng": 34.305, "type": "STRIKE",   "region": "Gaza",           "hours_ago": 2},
    {"lat": 31.500, "lng": 34.450, "type": "MISSILE",  "region": "Gaza",           "hours_ago": 5},
    {"lat": 48.379, "lng": 31.165, "type": "DRONE",    "region": "Ukraine",        "hours_ago": 1},
    {"lat": 49.100, "lng": 32.400, "type": "STRIKE",   "region": "Ukraine",        "hours_ago": 8},
    {"lat": 12.900, "lng": 43.300, "type": "NAVAL",    "region": "Red Sea",        "hours_ago": 3},
    {"lat": 13.200, "lng": 43.100, "type": "NAVAL",    "region": "Red Sea",        "hours_ago": 6},
    {"lat": 36.200, "lng": 37.160, "type": "STRIKE",   "region": "Syria",          "hours_ago": 12},
    {"lat": 15.355, "lng": 44.200, "type": "DRONE",    "region": "Yemen",          "hours_ago": 4},
    {"lat": 33.512, "lng": 36.291, "type": "STRIKE",   "region": "Damascus",       "hours_ago": 18},
    {"lat": 50.450, "lng": 30.523, "type": "MISSILE",  "region": "Kyiv",           "hours_ago": 7},
    {"lat": 47.838, "lng": 35.139, "type": "TROOP",    "region": "Zaporizhzhia",   "hours_ago": 24},
    {"lat": 48.718, "lng": 37.800, "type": "STRIKE",   "region": "Donbas",         "hours_ago": 10},
    {"lat": 31.770, "lng": 35.215, "type": "DRONE",    "region": "West Bank",      "hours_ago": 2},
    {"lat": 12.500, "lng": 43.700, "type": "NAVAL",    "region": "Bab-el-Mandeb",  "hours_ago": 9},
    {"lat": 36.800, "lng": 36.100, "type": "MISSILE",  "region": "Aleppo",         "hours_ago": 36},
    {"lat": 33.888, "lng": 35.494, "type": "DRONE",    "region": "Beirut",         "hours_ago": 14},
    {"lat": 47.500, "lng": 38.500, "type": "TROOP",    "region": "Mariupol",       "hours_ago": 48},
    {"lat": 15.552, "lng": 32.532, "type": "STRIKE",   "region": "Sudan",          "hours_ago": 20},
    {"lat": 13.180, "lng": 44.050, "type": "MISSILE",  "region": "Hodeida",        "hours_ago": 15},
    {"lat": 31.600, "lng": 34.450, "type": "STRIKE",   "region": "Southern Gaza",  "hours_ago": 1},
]


def generate_event_id(db: Session) -> str:
    from backend.models import Event
    import re
    from datetime import datetime
    year = datetime.utcnow().year
    prefix = f"EVT-{year}-"
    events = db.query(Event.id).filter(
        Event.id.like(f"{prefix}%"),
        ~Event.id.like("EVT-TEST-%")
    ).all()
    if not events:
        return f"{prefix}000001"
    max_seq = max(
        int(eid[0].replace(prefix, ""))
        for eid in events
        if re.match(r'^\d{6}$', eid[0].replace(prefix, ""))
    )
    return f"{prefix}{max_seq+1:06d}"


def _event_exists(db: Session, lat: float, lng: float, event_time: datetime, tolerance_km: float = 1.0) -> bool:
    """Check if an event already exists near these coordinates and time (within 30 min)."""
    from math import radians, sin, cos, sqrt, atan2
    existing = db.query(Event).filter(~Event.id.like("EVT-TEST-%")).all()
    for ev in existing:
        dlat = radians(lat - ev.lat)
        dlng = radians(lng - ev.lng)
        a = sin(dlat / 2) ** 2 + cos(radians(lat)) * cos(radians(ev.lat)) * sin(dlng / 2) ** 2
        dist_km = 6371 * 2 * __import__("math").atan2(sqrt(a), sqrt(1 - a))
        time_diff_minutes = abs((event_time - ev.first_detection_time).total_seconds()) / 60
        if dist_km < tolerance_km and time_diff_minutes < 30:
            return True
    return False


def ingest_acled(db: Session) -> None:
    """Main entry point: uses real ACLED API if credentials are set, else mock data."""
    if settings.acled_key and settings.acled_email:
        _ingest_real_acled(db)
    else:
        _ingest_mock_acled(db)


def _ingest_mock_acled(db: Session) -> None:
    """Generate and insert 20 realistic mock conflict events."""
    now = datetime.now(timezone.utc)
    inserted = 0

    for mock in MOCK_EVENTS:
        event_time = now - timedelta(hours=mock["hours_ago"])

        # Skip if a similar event already exists
        if _event_exists(db, mock["lat"], mock["lng"], event_time):
            continue

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
        db.flush()  # flush so generate_event_id sees updated count
        inserted += 1

    db.commit()
    print(f"[acled_worker] Inserted {inserted} mock events.")


def _ingest_real_acled(db: Session) -> None:
    """Fetch from real ACLED API and insert events."""
    import requests

    url = "https://api.acleddata.com/acled/read"
    params = {
        "key": settings.acled_key,
        "email": settings.acled_email,
        "limit": 100,
        "event_type": "Explosions/Remote violence",
        "fields": "event_id_cnty|event_date|latitude|longitude|event_type|sub_event_type",
    }

    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        print(f"[acled_worker] ACLED API error: {e}. Falling back to mock data.")
        _ingest_mock_acled(db)
        return

    # Map ACLED sub-event types to our EventType enum
    type_map = {
        "Air/drone strike": "DRONE",
        "Shelling/artillery/missile attack": "MISSILE",
        "Remote explosive/landmine/IED": "STRIKE",
        "Suicide bomb": "STRIKE",
        "Attack": "STRIKE",
    }

    inserted = 0
    for record in data.get("data", []):
        try:
            lat = float(record["latitude"])
            lng = float(record["longitude"])
            event_date_str = record["event_date"]
            event_time = datetime.strptime(event_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            sub_type = record.get("sub_event_type", "Attack")
            event_type_str = type_map.get(sub_type, "STRIKE")

            if _event_exists(db, lat, lng, event_time):
                continue

            event_id = generate_event_id(db)
            event = Event(
                id=event_id,
                lat=lat,
                lng=lng,
                first_detection_time=event_time,
                event_type=EventType(event_type_str),
                confidence=ConfidenceLevel.REPORTED,
                cluster_radius_km=5.0,
            )
            db.add(event)
            db.flush()
            inserted += 1
        except Exception as e:
            print(f"[acled_worker] Skipping record due to error: {e}")
            continue

    db.commit()
    print(f"[acled_worker] Inserted {inserted} real ACLED events.")


# Celery task wrapper
def ingest_acled_task():
    """Celery-compatible task entry point."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        ingest_acled(db)
    finally:
        db.close()
