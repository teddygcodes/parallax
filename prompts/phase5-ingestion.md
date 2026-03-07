# PARALLAX Phase 5 — Real Data Ingestion

## Always start here

```bash
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/models/event.py
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/models/signal.py
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/celery_app.py
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/workers/acled_worker.py
ls /Users/tylergilstrap/Desktop/PARALLAX/backend/workers/
```

Before writing any code:
1. List every field on `Event` and `Signal` exactly as they appear in the model files.
2. List every enum member of `EventType`, `ConfidenceLevel`, and `SourceCategory`.
3. Copy the exact enum assignment pattern from `acled_worker.py` (e.g. `ConfidenceLevel.REPORTED`).
4. Confirm the Celery app object name and the beat_schedule dict format from `celery_app.py`.
5. Copy the exact import style for `backend.models` from `acled_worker.py` — mirror it exactly in the new workers.

**Do not invent model fields or enum members. Only use what is confirmed above.**

---

**BEAT SCHEDULE CORRECTION:**
The Celery beat schedule is in `backend/celery_app.py` — NOT `main.py`.
The app object is named `celery_app`. Add new entries into the **existing** `celery_app.conf.beat_schedule` dict.
Do not rebuild or replace the whole dict. Preserve all existing entries.

**IMPORT STYLE CORRECTION:**
Match `acled_worker.py` exactly — do not switch between `from backend.models import X` and `from backend.models.event import X` unless that matches what `acled_worker.py` already does. Check before writing.

**SESSION LIFECYCLE CORRECTION:**
Match `acled_worker.py` exactly. `db.commit()` is called inside `ingest_xxx(db)`, not in the task wrapper:
```python
def ingest_xxx_task():
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        ingest_xxx(db)
    finally:
        db.close()
```

**LOGGING STYLE CORRECTION:**
Match `acled_worker.py` exactly — if acled_worker uses `print()`, use `print()`. Do not switch style. Check before writing.

**RELIEFWEB ENRICHMENT-ONLY CORRECTION:**
ReliefWeb creates `Signal` records attached to existing nearby `Event` records only. It does NOT create new `Event` records. Skip entirely if no event is within `PROXIMITY_KM=200`. Do not create fallback events. Do not relax the threshold.

**HDX BEST-EFFORT CORRECTION:**
Not finding a usable dataset is a valid outcome — log clearly and return. Never raise from `ingest_hdx`. Do not retry across multiple queries or datasets.

---

## What you're building

Five files total:
1. `backend/workers/ingest_utils.py`
2. `backend/workers/gdelt_worker.py`
3. `backend/workers/reliefweb_worker.py`
4. `backend/workers/hdx_worker.py`
5. Modify `backend/celery_app.py`

Constraints:
- No new database tables
- No schema changes
- No API keys (all sources are free/public)
- No pandas (use `csv` module and `io.StringIO`)
- No frontend changes
- Every ingestion function must be safe to call on a cold DB or empty network — never raise from the top-level function

---

## 1. `backend/workers/ingest_utils.py`

**Strictly pure Python — no imports from `backend.*` at all.**

```python
"""Pure ingestion helpers — no database, no network."""
import hashlib
from datetime import datetime, timezone


def make_event_id(lat: float, lng: float, ts: datetime, source: str) -> str:
    """Deterministic, collision-resistant event ID — prevents duplicate inserts.
    Version-prefixed so the key space can be changed in future without collisions.
    """
    raw = f"v1:{source}:{lat:.4f}:{lng:.4f}:{ts.strftime('%Y%m%dT%H%M')}"
    return "EVT-" + hashlib.md5(raw.encode()).hexdigest()[:12].upper()


def make_signal_id(event_id: str, source: str, composite_key: str) -> str:
    """Deterministic signal ID.
    composite_key should include enough fields to distinguish this signal from
    others from the same source on the same event (e.g. f"{url}|{code}|{geo}").
    """
    raw = f"{event_id}|{source}|{composite_key[:120]}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]


def is_violence_code(code: str) -> bool:
    """Return True if GDELT EventCode is a 3-digit violence code in 180–209.
    Two-digit family labels ('18', '19', '20') and 4-digit codes are NOT accepted.
    """
    if not code or not code.isdigit() or len(code) != 3:
        return False
    return 180 <= int(code) <= 209


def normalize_event_type(gdelt_code: str) -> str:
    """Map GDELT EventCode root to an EventType string value."""
    prefix = gdelt_code[:2] if len(gdelt_code) >= 2 else ""
    return {
        "18": "STRIKE",
        "19": "STRIKE",
        "20": "MISSILE",
    }.get(prefix, "STRIKE")


def parse_gdelt_date(sqldate: str) -> datetime:
    """Parse YYYYMMDD (GDELT 2.0 SQLDATE) to a UTC datetime."""
    return datetime.strptime(sqldate[:8], "%Y%m%d").replace(tzinfo=timezone.utc)


def truncate(text: str, n: int = 400) -> str:
    """Truncate text to at most n characters at a word boundary."""
    if not text or len(text) <= n:
        return text
    cut = text.rfind(" ", 0, n - 3)
    return (text[:cut] if cut > 0 else text[:n - 3]).rstrip() + "..."
```

---

## 2. `backend/workers/gdelt_worker.py`

GDELT 2.0 exports a new `.export.CSV.zip` every 15 minutes. Fetch the latest one, filter violence codes, create events and signals.

```python
"""
GDELT 2.0 Worker — ingests conflict events every 15 minutes.
No API key required. Falls back gracefully on any network failure.
"""
import csv
import io
import zipfile
import requests

from backend.models import Event, EventType, ConfidenceLevel, Signal, SourceCategory
# Confirmed: acled_worker.py uses flat-style imports (`from backend.models import X, Y`).
# If acled_worker.py uses a different style after reading it, match that instead.
from backend.workers.ingest_utils import (
    make_event_id, make_signal_id, is_violence_code,
    normalize_event_type, parse_gdelt_date, truncate,
)

GDELT_LASTUPDATE_URL = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt"
# GDELT lastupdate endpoint uses HTTP here; preserve this unless verified otherwise.

HEADERS = {"User-Agent": "PARALLAX/phase5-ingestion"}

# GDELT 2.0 export CSV — tab-delimited, no header, 0-based column indices.
# Verify against a real file: len(cols) should be >= 61.
COL_SQLDATE   = 1
COL_EVENTCODE = 26
COL_GEO_NAME  = 52   # ActionGeo_FullName
COL_LAT       = 56   # ActionGeo_Lat
COL_LNG       = 57   # ActionGeo_Long
COL_URL       = 60   # SOURCEURL


def _get_export_url() -> str | None:
    """Return the .export.CSV.zip URL from GDELT lastupdate.txt, or None.
    Validates: line contains 'export.CSV.zip', has >= 3 space-separated parts,
    and the URL part starts with 'http'. Returns None otherwise.
    """
    resp = requests.get(GDELT_LASTUPDATE_URL, timeout=15, headers=HEADERS)
    resp.raise_for_status()
    for line in resp.text.strip().splitlines():
        if "export.CSV.zip" in line:
            parts = line.strip().split()
            if len(parts) >= 3 and parts[2].startswith("http"):
                return parts[2]
    return None


def _iter_rows(url: str):
    """Decompress GDELT export zip in memory (compressed bytes materialized),
    then stream-parse the decompressed CSV rows via TextIOWrapper — avoids
    materializing the full decoded string. Yields csv rows one at a time.
    """
    resp = requests.get(url, timeout=90, headers=HEADERS)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = zf.namelist()
        if not names:
            raise ValueError("Empty GDELT zip — no files found")
        with zf.open(names[0]) as f:
            text_stream = io.TextIOWrapper(f, encoding="utf-8", errors="replace", newline="")
            yield from csv.reader(text_stream, delimiter="\t")


def ingest_gdelt(db) -> None:
    # GDELT SQLDATE is day-level only (YYYYMMDD). Event IDs are therefore
    # day-bucketed per source location — two events at the same place on the
    # same day from GDELT will share one ID and be deduplicated.
    # parse_gdelt_date() may raise on malformed SQLDATE — treated as a row-level
    # skip inside the loop, not a worker failure.
    try:
        export_url = _get_export_url()
        if not export_url:
            print("[gdelt_worker] No valid export URL found — skipping.")
            return
        row_iter = _iter_rows(export_url)
    except Exception as exc:
        print(f"[gdelt_worker] Fetch failed: {exc} — skipping.")
        return

    inserted_events = 0
    inserted_signals = 0

    # Partial inserts before an iteration failure are committed and logged.
    # Iteration failure is non-fatal — "Done" prints even after partial failure.
    try:
        for row in row_iter:
            try:
                if len(row) <= COL_URL:
                    continue

                code = row[COL_EVENTCODE].strip()
                if not is_violence_code(code):
                    continue

                lat_str = row[COL_LAT].strip()
                lng_str = row[COL_LNG].strip()
                if not lat_str or not lng_str:
                    continue

                lat = float(lat_str)
                lng = float(lng_str)
                if lat == 0.0 and lng == 0.0:
                    continue

                ts       = parse_gdelt_date(row[COL_SQLDATE])
                url      = row[COL_URL].strip() or None
                geo_name = row[COL_GEO_NAME].strip()

                event_id = make_event_id(lat, lng, ts, "GDELT")
                event = db.query(Event).filter(Event.id == event_id).first()
                if not event:
                    event = Event(
                        id=event_id,
                        lat=lat,
                        lng=lng,
                        first_detection_time=ts,
                        event_type=EventType(normalize_event_type(code)),
                        confidence=ConfidenceLevel.REPORTED,
                        cluster_radius_km=5.0,
                    )
                    db.add(event)
                    db.flush()
                    inserted_events += 1

                # Composite key prevents collapse on shared URL or geo_name
                composite = f"{url or ''}|{code}|{geo_name}"
                sig_id = make_signal_id(event_id, "GDELT", composite)
                if db.query(Signal).filter(Signal.id == sig_id).first():
                    continue

                sig = Signal(
                    id=sig_id,
                    event_id=event_id,
                    source="GDELT",
                    source_category=SourceCategory.WESTERN,
                    article_url=url,
                    published_at=ts,
                    raw_text=None,
                    description=truncate(f"GDELT {code} at {geo_name}", 400),
                    coordinates_mentioned=f"{lat:.3f},{lng:.3f}",
                )
                db.add(sig)
                inserted_signals += 1

            except Exception as exc:
                print(f"[gdelt_worker] Skipping row: {exc}")
                continue
    except Exception as exc:
        print(f"[gdelt_worker] Row iteration failed: {exc} — committing partial results.")

    db.commit()
    print(f"[gdelt_worker] Done — {inserted_events} events, {inserted_signals} signals.")


def ingest_gdelt_task():
    """Celery-compatible entry point."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        ingest_gdelt(db)
    finally:
        db.close()
```

---

## 3. `backend/workers/reliefweb_worker.py`

**Enrichment-only**: creates `Signal` records attached to existing nearby events. Never creates new `Event` records. Skips if no event is within `PROXIMITY_KM`.

```python
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
    payload = {
        "appname": "PARALLAX",
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
    resp = requests.post(RELIEFWEB_API, json=payload, timeout=30, headers=HEADERS)
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
```

---

## 4. `backend/workers/hdx_worker.py`

Skip aggressively at every failure point. Never raise from `ingest_hdx`.

```python
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

    for pkg in results:
        for resource in pkg.get("resources", []):
            url = resource.get("url", "")
            fmt = resource.get("format", "").upper()
            name = resource.get("name", "").lower()
            # Prefer resources whose name suggests structured event data
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
        print(f"[hdx_worker] Required lat/lng/date columns not found. "
              f"Dataset: {csv_url} | Available fields: {fieldnames}. Skipping.")
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
```

---

## 5. `backend/celery_app.py` — add 3 entries

Read the file first. Then add exactly these three entries into the **existing** `celery_app.conf.beat_schedule` dict literal — do not remove or modify any existing entries:

```python
    "ingest-gdelt-every-15-minutes": {
        "task": "backend.workers.gdelt_worker.ingest_gdelt_task",
        "schedule": 900.0,
    },
    "ingest-reliefweb-every-6-hours": {
        "task": "backend.workers.reliefweb_worker.ingest_reliefweb_task",
        "schedule": 21600.0,
    },
    "ingest-hdx-every-24-hours": {
        "task": "backend.workers.hdx_worker.ingest_hdx_task",
        "schedule": 86400.0,
    },
```

---

## Anti-Pattern Guards

1. Never create `Event` records from ReliefWeb — enrichment signals only, attach to existing events
2. Never relax the 200km proximity threshold for ReliefWeb — skip the report, never lower the bar
3. Never extend `_COUNTRY_CENTROIDS` at runtime — static table only, skip unknown countries
4. Never raise from a top-level `ingest_xxx` function — all failures log and return
5. Never commit inside the task wrapper — `db.commit()` belongs in `ingest_xxx(db)` only
6. Never use pandas — `csv` module and `io.StringIO` only
7. Never add new DB tables or schema changes
8. Never add API keys — all three sources are free and public
9. Always add `HEADERS` to every outbound request
10. Beat schedule is in `celery_app.py` — not `main.py`, not `main.py`'s startup event

---

## Completion Criteria

```bash
# 1. Pure helper unit tests (no DB, no network needed)
python -c "
from backend.workers.ingest_utils import (
    make_event_id, make_signal_id, is_violence_code,
    normalize_event_type, parse_gdelt_date, truncate
)
from datetime import datetime, timezone

# Violence code detection: 3-digit codes 180–209 only.
# Two-digit family labels ('18', '19', '20') are intentionally rejected.
assert is_violence_code('180') == True
assert is_violence_code('190') == True
assert is_violence_code('200') == True
assert is_violence_code('209') == True
assert is_violence_code('179') == False   # below range
assert is_violence_code('210') == False   # above range
assert is_violence_code('150') == False
assert is_violence_code('18')   == False  # two-digit family label, rejected
assert is_violence_code('19')   == False  # two-digit family label, rejected
assert is_violence_code('20')   == False  # two-digit family label, rejected
assert is_violence_code('1800') == False  # four-digit, rejected
assert is_violence_code('')     == False
assert is_violence_code('abc')  == False

assert normalize_event_type('200') == 'MISSILE'
assert normalize_event_type('183') == 'STRIKE'
assert normalize_event_type('191') == 'STRIKE'

ts = datetime(2026, 3, 1, tzinfo=timezone.utc)
id1 = make_event_id(31.5, 34.8, ts, 'GDELT')
id2 = make_event_id(31.5, 34.8, ts, 'GDELT')
assert id1 == id2, 'IDs must be deterministic'
assert id1.startswith('EVT-')
assert len(id1) == 16  # 'EVT-' + 12 chars

s1 = make_signal_id('EVT-ABC', 'GDELT', 'http://example.com|190|Gaza')
s2 = make_signal_id('EVT-ABC', 'GDELT', 'http://example.com|190|Gaza')
assert s1 == s2

text = 'word ' * 100
result = truncate(text, 50)
assert len(result) <= 50
assert result.endswith('...')

print('ingest_utils OK')
"

# 2. Import all task functions (confirms no syntax errors)
python -c "
from backend.workers.ingest_utils import make_event_id
from backend.workers.gdelt_worker import ingest_gdelt_task
from backend.workers.reliefweb_worker import ingest_reliefweb_task
from backend.workers.hdx_worker import ingest_hdx_task
print('All task imports OK')
"

# 3. Beat schedule contains all required keys
python -c "
from backend.celery_app import celery_app
keys = list(celery_app.conf.beat_schedule.keys())
assert any('gdelt' in k for k in keys), f'gdelt task missing: {keys}'
assert any('reliefweb' in k for k in keys), f'reliefweb task missing: {keys}'
assert any('hdx' in k for k in keys), f'hdx task missing: {keys}'
assert any('acled' in k for k in keys), f'acled task missing: {keys}'
assert any('news' in k for k in keys), f'news task missing: {keys}'
assert any('satellite' in k for k in keys), f'satellite task missing: {keys}'
print('Beat schedule OK:', keys)
"

# 4. Frontend build (no changes expected — fast)
cd /Users/tylergilstrap/Desktop/PARALLAX/frontend && npm run build
```

**Functional test (requires running backend + DB):**
```bash
python -c "
from backend.workers.gdelt_worker import ingest_gdelt_task
ingest_gdelt_task()
"
# Must not raise. Acceptable outputs:
#   "[gdelt_worker] Done — N events, M signals."
#   "[gdelt_worker] Fetch failed: ... — skipping."

python -c "
from backend.workers.reliefweb_worker import ingest_reliefweb_task
ingest_reliefweb_task()
"
# Expected: "[reliefweb_worker] Inserted N enrichment signals." with N >= 0

python -c "
from backend.workers.hdx_worker import ingest_hdx_task
ingest_hdx_task()
"
# HDX is best-effort. All of these are valid outcomes:
#   "[hdx_worker] No suitable CSV resource found — skipping."
#   "[hdx_worker] Setup failed: ... — skipping."
#   "[hdx_worker] Required lat/lng/date columns not found... Skipping."
#   "[hdx_worker] Done — N events, M signals."
# Any uncaught exception is a failure.
```

Only output:

```
<promise>INGESTION_COMPLETE</promise>
```

when all checks pass.
