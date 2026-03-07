"""
News Worker — ingests signals (news articles) for each event.
When NEWSAPI_KEY is set: calls real NewsAPI.
When not set: generates mock signals from multiple source categories per event.
"""
import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from backend.models import Event, Signal, SourceCategory
from backend.config import settings

# Templates keyed by source category: list of (source_name, text_template) tuples
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

# Which categories to sample for each event (cycle through to ensure diversity)
CATEGORY_ORDER = ["WESTERN", "RUSSIAN", "MIDDLE_EAST", "OSINT", "LOCAL"]


def _region_name_for_event(event: Event) -> str:
    """Best-effort region label based on coordinates."""
    lat, lng = event.lat, event.lng

    if 30.0 <= lat <= 32.5 and 33.0 <= lng <= 36.0:
        return "Gaza"
    if 31.0 <= lat <= 32.0 and 34.5 <= lng <= 36.5:
        return "West Bank"
    if 33.0 <= lat <= 34.5 and 35.0 <= lng <= 37.0:
        return "Lebanon"
    if 33.0 <= lat <= 34.0 and 35.5 <= lng <= 37.5:
        return "Damascus"
    if 35.0 <= lat <= 37.5 and 36.0 <= lng <= 38.5:
        return "Syria"
    if 47.0 <= lat <= 52.0 and 22.0 <= lng <= 40.0:
        return "Ukraine"
    if 50.0 <= lat <= 51.0 and 30.0 <= lng <= 31.5:
        return "Kyiv"
    if 47.0 <= lat <= 49.0 and 37.0 <= lng <= 40.0:
        return "Donbas"
    if 12.0 <= lat <= 14.0 and 43.0 <= lng <= 45.0:
        return "Red Sea"
    if 15.0 <= lat <= 16.0 and 44.0 <= lng <= 45.0:
        return "Yemen"
    if 13.0 <= lat <= 14.0 and 43.5 <= lng <= 44.5:
        return "Hodeida"
    if 15.0 <= lat <= 16.5 and 32.0 <= lng <= 33.5:
        return "Sudan"
    return f"{lat:.2f}°N {lng:.2f}°E"


def _signals_exist_for_event(db: Session, event_id: str) -> bool:
    """Return True if signals already exist for this event."""
    return db.query(Signal).filter(Signal.event_id == event_id).count() > 0


def ingest_news(db: Session) -> None:
    """Main entry point: uses real NewsAPI if key is set, else generates mock signals."""
    if settings.newsapi_key:
        _ingest_real_news(db)
    else:
        _ingest_mock_news(db)


def _ingest_mock_news(db: Session) -> None:
    """Generate 3-5 signals per event from different source categories."""
    events = db.query(Event).filter(~Event.id.like("EVT-TEST-%")).all()
    total_inserted = 0

    for event in events:
        # Skip if signals already exist
        if _signals_exist_for_event(db, event.id):
            continue

        region = _region_name_for_event(event)
        event_type_label = event.event_type.value

        # Select 3-5 categories to generate signals from
        # Always include WESTERN, RUSSIAN, OSINT; optionally add MIDDLE_EAST and LOCAL
        selected_categories = ["WESTERN", "RUSSIAN", "OSINT"]
        # Add MIDDLE_EAST for Middle East / Africa events
        if event.lat < 42.0 and 25.0 <= event.lng <= 60.0:
            selected_categories.append("MIDDLE_EAST")
        # Always include LOCAL
        selected_categories.append("LOCAL")

        base_time = event.first_detection_time

        for cat_offset, category in enumerate(selected_categories):
            templates = MOCK_SIGNAL_TEMPLATES[category]
            # Use first template per category for determinism
            source_name, text_template = templates[0]
            description = text_template.format(
                region=region,
                event_type=event_type_label,
            )
            signal_time = base_time + timedelta(minutes=(cat_offset + 1) * 7)

            signal = Signal(
                id=str(uuid.uuid4()),
                event_id=event.id,
                source=source_name,
                source_category=SourceCategory(category),
                published_at=signal_time,
                description=description,
            )
            db.add(signal)
            total_inserted += 1

        db.flush()

    db.commit()
    print(f"[news_worker] Inserted {total_inserted} mock signals across {len(events)} events.")


def _ingest_real_news(db: Session) -> None:
    """Fetch real news articles from NewsAPI for each event's region."""
    import requests

    events = db.query(Event).filter(~Event.id.like("EVT-TEST-%")).all()
    total_inserted = 0

    for event in events:
        if _signals_exist_for_event(db, event.id):
            continue

        region = _region_name_for_event(event)
        url = "https://newsapi.org/v2/everything"
        params = {
            "q": region,
            "apiKey": settings.newsapi_key,
            "pageSize": 5,
            "sortBy": "publishedAt",
            "language": "en",
        }

        try:
            response = requests.get(url, params=params, timeout=15)
            response.raise_for_status()
            articles = response.json().get("articles", [])
        except Exception as e:
            print(f"[news_worker] NewsAPI error for {region}: {e}. Skipping.")
            continue

        for article in articles[:5]:
            try:
                published_at_str = article.get("publishedAt", "")
                published_at = datetime.fromisoformat(
                    published_at_str.replace("Z", "+00:00")
                ) if published_at_str else datetime.now(timezone.utc)

                source_name = article.get("source", {}).get("name", "Unknown")
                description = article.get("description") or article.get("title") or ""

                # Assign source category heuristically
                source_lower = source_name.lower()
                if any(s in source_lower for s in ["rt", "tass", "sputnik", "ria"]):
                    category = SourceCategory.RUSSIAN
                elif any(s in source_lower for s in ["jazeera", "irna", "press tv", "presstv"]):
                    category = SourceCategory.MIDDLE_EAST
                elif any(s in source_lower for s in ["bellingcat", "osint", "intelli"]):
                    category = SourceCategory.OSINT
                elif any(s in source_lower for s in ["telegram", "local", "regional"]):
                    category = SourceCategory.LOCAL
                else:
                    category = SourceCategory.WESTERN

                signal = Signal(
                    id=str(uuid.uuid4()),
                    event_id=event.id,
                    source=source_name,
                    source_category=category,
                    article_url=article.get("url"),
                    published_at=published_at,
                    raw_text=article.get("content"),
                    description=description,
                )
                db.add(signal)
                total_inserted += 1
            except Exception as e:
                print(f"[news_worker] Skipping article: {e}")
                continue

        db.flush()

    db.commit()
    print(f"[news_worker] Inserted {total_inserted} real news signals.")


# Celery task wrapper
def ingest_news_task():
    """Celery-compatible task entry point."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        ingest_news(db)
    finally:
        db.close()
