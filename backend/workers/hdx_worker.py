"""
HDX Worker — fetches UNOCHA HDX conflict data every 24 hours.
Skip aggressively: if dataset URL not found, required columns missing,
or any parse error — log and return. No exceptions propagate.
No API key required.
"""
import csv
import io
import requests
from datetime import datetime, timezone

from backend.models import Event, EventType, Signal, SourceCategory, ConfidenceLevel
# Confirmed: acled_worker.py uses flat-style imports (`from backend.models import X, Y`).
# If acled_worker.py uses a different style after reading it, match that instead.
from backend.workers.ingest_utils import make_event_id, make_signal_id, truncate

HDX_API = "https://data.humdata.org/api/3/action"
HDX_SEARCH_TERMS = "conflict fatalities"
HEADERS = {"User-Agent": "PARALLAX/phase5-ingestion"}


def _find_csv_url() -> str | None:
    """
    Search HDX for a conflict CSV resource.
    Bounded search only — do not retry across multiple queries or datasets.
    If nothing suitable is found in the first result page, return None and skip.
    """
    try:
        resp = requests.get(
            f"{HDX_API}/package_search",
            params={"q": HDX_SEARCH_TERMS, "rows": 10},
            timeout=30,
            headers=HEADERS,
        )
        resp.raise_for_status()
        results = resp.json().get("result", {}).get("results", [])
    except Exception as exc:
        print(f"[hdx_worker] HDX search failed: {exc}")
        return None

    # Prefer resources whose name suggests structured event data
    for pkg in results:
        for resource in pkg.get("resources", []):
            url = resource.get("url", "")
            fmt = resource.get("format", "").upper()
            name = resource.get("name", "").lower()
            if fmt == "CSV" and url.lower().endswith(".csv"):
                if any(kw in name for kw in ("event", "conflict", "fatality", "incident")):
                    return url

    # Fallback: any CSV
    for pkg in results:
        for resource in pkg.get("resources", []):
            url = resource.get("url", "")
            if resource.get("format", "").upper() == "CSV" and url.lower().endswith(".csv"):
                return url

    return None


def _detect_columns(fieldnames: list) -> dict:
    """Return a map of role → column name for the detected CSV.
    Keyword lists are broad to handle varied HDX dataset schemas.
    Does not use pandas — operates on plain fieldnames list.
    """
    def find(keywords):
        for f in fieldnames:
            fl = f.lower().replace(" ", "_")
            if any(k in fl for k in keywords):
                return f
        return None

    return {
        "lat":  find(["latitude", "lat", "geo_lat", "y_coord", "coord_y", "decimallatitude"]),
        "lng":  find(["longitude", "lon", "lng", "geo_lon", "x_coord", "coord_x", "decimallongitude"]),
        "date": find(["date", "event_date", "incident_date", "report_date", "year_month", "period"]),
        "url":  find(["url", "source_url", "source", "link", "href"]),
        "desc": find(["event_type", "sub_event_type", "type", "description", "notes", "incident_type", "category"]),
    }


def ingest_hdx(db) -> None:
    try:
        csv_url = _find_csv_url()
        if not csv_url:
            print("[hdx_worker] No suitable CSV resource found — skipping.")
            return

        resp = requests.get(csv_url, timeout=90, headers=HEADERS)
        resp.raise_for_status()
        content = resp.text

        reader = csv.DictReader(io.StringIO(content))
        fieldnames = list(reader.fieldnames or [])
        cols = _detect_columns(fieldnames)
    except Exception as exc:
        print(f"[hdx_worker] Setup failed: {exc} — skipping.")
        return

    # If required columns cannot be confidently detected, log all available fieldnames
    # and return immediately. Do not attempt heuristic guessing beyond the defined keywords.
    if not cols["lat"] or not cols["lng"] or not cols["date"]:
        print(
            f"[hdx_worker] Required lat/lng/date columns not found. "
            f"Dataset: {csv_url} | Available fields: {fieldnames}. Skipping."
        )
        return

    inserted_events = 0
    inserted_signals = 0

    for row in reader:
        try:
            lat_str  = row.get(cols["lat"], "").strip()
            lng_str  = row.get(cols["lng"], "").strip()
            date_str = row.get(cols["date"], "").strip()

            if not lat_str or not lng_str or not date_str:
                continue

            lat = float(lat_str)
            lng = float(lng_str)
            if lat == 0.0 and lng == 0.0:
                continue

            ts = None
            # Try ISO format first (covers YYYY-MM-DDTHH:MM:SSZ and similar)
            try:
                ts = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
            except ValueError:
                pass
            # Fall back to common fixed formats
            if ts is None:
                for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y"):
                    try:
                        ts = datetime.strptime(date_str[:10], fmt).replace(tzinfo=timezone.utc)
                        break
                    except ValueError:
                        continue
            if ts is None:
                continue

            url  = row.get(cols["url"] or "", "").strip() or None
            desc = row.get(cols["desc"] or "", "").strip()

            event_id = make_event_id(lat, lng, ts, "HDX")
            event = db.query(Event).filter(Event.id == event_id).first()
            if not event:
                event = Event(
                    id=event_id,
                    lat=lat,
                    lng=lng,
                    first_detection_time=ts,
                    event_type=EventType("STRIKE"),
                    confidence=ConfidenceLevel.REPORTED,
                    cluster_radius_km=5.0,
                )
                db.add(event)
                db.flush()
                inserted_events += 1

            composite = f"{url or ''}|{desc[:80]}"
            sig_id = make_signal_id(event_id, "HDX", composite)
            if db.query(Signal).filter(Signal.id == sig_id).first():
                continue

            sig = Signal(
                id=sig_id,
                event_id=event_id,
                source="HDX",
                source_category=SourceCategory.WESTERN,
                article_url=url,
                published_at=ts,
                raw_text=None,
                description=truncate(desc, 400),
                coordinates_mentioned=f"{lat:.3f},{lng:.3f}",
            )
            db.add(sig)
            inserted_signals += 1

        except Exception as exc:
            print(f"[hdx_worker] Skipping row: {exc}")
            continue

    db.commit()
    print(f"[hdx_worker] Done — {inserted_events} events, {inserted_signals} signals.")


def ingest_hdx_task():
    """Celery-compatible entry point."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        ingest_hdx(db)
    finally:
        db.close()
