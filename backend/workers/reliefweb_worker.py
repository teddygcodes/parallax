"""
ReliefWeb Worker — attaches humanitarian situation report signals to nearby
existing events every 6 hours. Enrichment-only: no new events are created.
No API key required.
"""
import math
import requests
from datetime import datetime

from backend.models import Event, Signal, SourceCategory
# Confirmed: acled_worker.py uses flat-style imports (`from backend.models import X, Y`).
# If acled_worker.py uses a different style after reading it, match that instead.
from backend.workers.ingest_utils import make_signal_id, truncate

RELIEFWEB_API = "https://api.reliefweb.int/v1/reports"
PROXIMITY_KM  = 200  # skip report if no existing event is within this distance
HEADERS = {"User-Agent": "PARALLAX/phase5-ingestion"}


def _haversine_km(lat1, lng1, lat2, lng2) -> float:
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlng / 2) ** 2)
    return 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _fetch_reports() -> list:
    # appname must be a query param (not body) per ReliefWeb API policy.
    # The appname must also be registered at https://apidoc.reliefweb.int/parameters#appname
    # A 403 here means the appname is not yet approved — register to resolve.
    payload = {
        "limit": 50,
        "sort": ["date:desc"],
        "filter": {
            "operator": "AND",
            "conditions": [
                {"field": "theme.name", "value": ["Conflict and Violence"]}
            ]
        },
        "fields": {"include": ["title", "date", "source", "primary_country", "url"]},
    }
    resp = requests.post(
        RELIEFWEB_API,
        params={"appname": "PARALLAX"},
        json=payload,
        timeout=30,
        headers=HEADERS,
    )
    if resp.status_code == 403:
        print("[reliefweb_worker] 403 Forbidden — appname 'PARALLAX' not approved. "
              "Register at https://apidoc.reliefweb.int/parameters#appname — skipping.")
        return []
    resp.raise_for_status()
    return resp.json().get("data", [])


# Approximate centroid matching only — not precise geolocation.
# If country name is not in this table: skip the report. Do not guess or extend the list at runtime.
_COUNTRY_CENTROIDS = {
    "ukraine":                         (49.0,  31.0),
    "israel":                          (31.5,  34.8),
    "palestine":                       (31.9,  35.2),
    "occupied palestinian territory":  (31.9,  35.2),
    "gaza":                            (31.4,  34.3),
    "west bank":                       (32.0,  35.3),
    "syria":                           (34.8,  38.9),
    "yemen":                           (15.6,  48.5),
    "sudan":                           (15.6,  32.5),
    "south sudan":                     (7.9,   30.2),
    "myanmar":                         (19.2,  96.7),
    "somalia":                         (5.2,   46.2),
    "ethiopia":                        (9.1,   40.5),
    "iraq":                            (33.2,  43.7),
    "afghanistan":                     (33.9,  67.7),
    "mali":                            (17.6,  -3.9),
    "burkina faso":                    (12.4,  -1.6),
    "nigeria":                         (9.1,    8.7),
    "drc":                             (-2.9,  23.7),
    "democratic republic of the congo": (-2.9, 23.7),
    "congo":                           (-4.0,  21.8),
    "lebanon":                         (33.9,  35.5),
    "haiti":                           (18.9, -72.3),
    "mozambique":                      (-18.7,  35.5),
    "central african republic":        (6.6,   20.9),
    "libya":                           (26.3,  17.2),
    "pakistan":                        (30.4,  69.3),
}


def ingest_reliefweb(db) -> None:
    try:
        reports = _fetch_reports()
    except Exception as exc:
        print(f"[reliefweb_worker] Fetch failed: {exc} — skipping.")
        return

    if not reports:
        return

    events = db.query(Event).all()
    if not events:
        print("[reliefweb_worker] No events in DB — nothing to enrich.")
        return

    inserted = 0

    for report in reports:
        try:
            fields      = report.get("fields", {})
            title       = fields.get("title", "")
            url         = fields.get("url") or None
            date_str    = (fields.get("date") or {}).get("created", "")
            country_raw = (fields.get("primary_country") or {}).get("name", "")

            if not date_str or not title:
                continue

            # fromisoformat may raise on malformed dates — treated as a row-level skip
            published_at = datetime.fromisoformat(date_str.replace("Z", "+00:00"))

            # Resolve approximate location from country name
            centroid = _COUNTRY_CENTROIDS.get(country_raw.lower())
            if not centroid:
                continue  # no mapping — skip; do not guess
            c_lat, c_lng = centroid

            nearest = None
            best_dist = float("inf")
            for ev in events:
                d = _haversine_km(c_lat, c_lng, ev.lat, ev.lng)
                if d < best_dist:
                    best_dist = d
                    nearest = ev

            # Enrichment-only: skip if no event is within PROXIMITY_KM.
            # Do not create fallback events. Do not relax the threshold.
            if not nearest or best_dist > PROXIMITY_KM:
                continue

            # Composite key includes published_at to distinguish re-published reports
            composite = f"{url or ''}|{published_at.isoformat()}|{title[:80]}"
            sig_id = make_signal_id(nearest.id, "ReliefWeb", composite)
            if db.query(Signal).filter(Signal.id == sig_id).first():
                continue

            sig = Signal(
                id=sig_id,
                event_id=nearest.id,
                source="ReliefWeb",
                source_category=SourceCategory.WESTERN,
                article_url=url,
                published_at=published_at,
                raw_text=None,
                description=truncate(title, 400),
                coordinates_mentioned=None,
            )
            db.add(sig)
            inserted += 1

        except Exception as exc:
            print(f"[reliefweb_worker] Skipping report: {exc}")
            continue

    db.commit()
    print(f"[reliefweb_worker] Inserted {inserted} enrichment signals.")


def ingest_reliefweb_task():
    """Celery-compatible entry point."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        ingest_reliefweb(db)
    finally:
        db.close()
