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
COL_COUNTRY   = 53   # ActionGeo_CountryCode (FIPS 10-4, col 51 is ActionGeo_Type)
COL_GEO_NAME  = 52   # ActionGeo_FullName
COL_LAT       = 56   # ActionGeo_Lat
COL_LNG       = 57   # ActionGeo_Long
COL_URL       = 60   # SOURCEURL

# GDELT pins events to publisher location, not actual conflict location
# (e.g., Reuters in US writing about Yemen gets geocoded to US)
# ActionGeo_CountryCode is a 2-character country code in the GDELT feed used here.
# Filter to known active conflict countries to avoid publisher-location geocoding noise.
CONFLICT_COUNTRIES = {
    # GDELT uses FIPS 10-4 codes, NOT ISO 3166-1 alpha-2
    "UP",  # Ukraine        (ISO: UA)
    "SY",  # Syria          (same)
    "YM",  # Yemen          (ISO: YE)
    "SU",  # Sudan          (ISO: SD)
    "OD",  # South Sudan    (ISO: SS)
    "SO",  # Somalia        (same)
    "IZ",  # Iraq           (ISO: IQ)
    "AF",  # Afghanistan    (same)
    "ML",  # Mali           (same)
    "UV",  # Burkina Faso   (ISO: BF)
    "NI",  # Nigeria        (ISO: NG)
    "CG",  # DRC            (ISO: CD)
    "LE",  # Lebanon        (ISO: LB)
    "IS",  # Israel         (ISO: IL)
    "WE",  # West Bank      (ISO: PS)
    "GZ",  # Gaza Strip     (ISO: PS)
    "BM",  # Myanmar        (ISO: MM)
    "ET",  # Ethiopia       (same)
    "LY",  # Libya          (same)
    "CT",  # Central African Republic (ISO: CF)
    "MZ",  # Mozambique     (same)
    "PK",  # Pakistan       (same)
    "RS",  # Russia         (ISO: RU)
    "MX",  # Mexico         (same)
    "HA",  # Haiti          (ISO: HT)
}

# Human-readable labels for GDELT violence event codes (180–209 family)
GDELT_CODE_LABELS = {
    "180": "Military force used",
    "181": "Blockade or movement restriction imposed",
    "182": "Territory occupied",
    "183": "Small arms engagement",
    "184": "Artillery engagement",
    "185": "Air, naval, or missile strike",
    "186": "Ceasefire violated",
    "190": "Conventional military force used",
    "191": "Assault or bombing conducted",
    "192": "Suicide or car bombing conducted",
    "193": "Roadside bombing conducted",
    "194": "Mortar attack conducted",
    "195": "Sniper attack conducted",
    "196": "Missile or rocket attack conducted",
    "200": "Mass violence conducted",
    "201": "Mass expulsion conducted",
    "202": "Mass killings reported",
    "203": "Ethnic cleansing reported",
    "204": "Genocide reported",
}


def _build_gdelt_description(code: str, geo_name: str, url: str | None) -> str:
    """
    Build a human-readable signal description from GDELT fields.
    Format: "{label} reported near {location}. ({domain})"
    Falls back gracefully when fields are missing. Never raises.
    """
    label    = GDELT_CODE_LABELS.get(code, f"Military action reported (code {code})")
    location = geo_name.strip() if geo_name.strip() else "unknown location"

    domain = None
    if url:
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            host   = parsed.netloc.lower()
            domain = host[4:] if host.startswith("www.") else host
        except Exception:
            domain = None

    base = f"{label} reported near {location}."
    if domain:
        base = f"{base} ({domain})"

    return truncate(base, 400)


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
    skipped_country = 0
    # Track signal IDs added this session to catch within-batch duplicates
    # (db.query won't find unflushed adds, causing unique constraint violations)
    seen_sig_ids: set = set()

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

                country_code = row[COL_COUNTRY].strip().upper() if len(row) > COL_COUNTRY else ""
                if country_code not in CONFLICT_COUNTRIES:
                    skipped_country += 1
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
                if sig_id in seen_sig_ids or db.query(Signal).filter(Signal.id == sig_id).first():
                    continue

                sig = Signal(
                    id=sig_id,
                    event_id=event_id,
                    source="GDELT",
                    source_category=SourceCategory.WESTERN,
                    article_url=url,
                    published_at=ts,
                    raw_text=None,
                    description=_build_gdelt_description(code, geo_name, url),
                    coordinates_mentioned=f"{lat:.3f},{lng:.3f}",
                )
                db.add(sig)
                seen_sig_ids.add(sig_id)
                inserted_signals += 1

            except Exception as exc:
                print(f"[gdelt_worker] Skipping row: {exc}")
                continue
    except Exception as exc:
        print(f"[gdelt_worker] Row iteration failed: {exc} — committing partial results.")

    db.commit()
    print(f"[gdelt_worker] Done — {inserted_events} events, {inserted_signals} signals, {skipped_country} skipped (non-conflict country).")


def ingest_gdelt_task():
    """Celery-compatible entry point."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        ingest_gdelt(db)
    finally:
        db.close()
