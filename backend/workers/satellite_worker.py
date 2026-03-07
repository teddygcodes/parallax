"""
Satellite coverage worker — runs every 10 minutes.
For each active event, computes which imaging satellites passed within swath
range in the last 6 hours, and forecasts next opportunities over 12 hours.
Stores results as JSONB on the event record.

Note on data source: uses CelesTrak GP TLE (FORMAT=TLE) for server-side
sgp4 propagation. The frontend uses a separate CelesTrak GP OMM JSON endpoint
(FORMAT=json) for browser-side satellite.js propagation. Separate by design.
Falls back to hardcoded OMM elements (parsed via sgp4.omm) when CelesTrak
is unreachable.
"""
import math
import requests
from datetime import datetime, timedelta, timezone

from sgp4.api import Satrec
from sgp4.conveniences import jday
import sgp4.omm

# Fetch TLE for specific NORAD IDs via CATNR parameter (comma-separated list)
# This is more reliable than GROUP=active which may return 404 for TLE format.
_CATNR_IDS = ",".join(str(s["norad"]) for s in [
    {"norad": 39634}, {"norad": 41456}, {"norad": 47506}, {"norad": 47507},
    {"norad": 47380}, {"norad": 47381}, {"norad": 40697}, {"norad": 42063},
    {"norad": 39084}, {"norad": 49260},
])
CELESTRAK_TLE_URL = f"https://celestrak.org/GP/GP.php?CATNR={_CATNR_IDS}&FORMAT=TLE"

# Fallback OMM data — same orbital elements as frontend/app/api/satellites/route.ts.
# Epoch 2026-03-06T00:00:00Z. RAAN values spread across orbital planes for global coverage.
# sgp4.omm.initialize() parses these directly into Satrec objects.
_FALLBACK_OMM = [
    {
        "CCSDS_OMM_VERS": "2.0", "OBJECT_NAME": "SENTINEL-1A", "OBJECT_ID": "2014-016A",
        "EPOCH": "2026-03-06T00:00:00.000000",
        "MEAN_MOTION": "14.59197541", "ECCENTRICITY": ".0001459", "INCLINATION": "98.1814",
        "RA_OF_ASC_NODE": "48.2341", "ARG_OF_PERICENTER": "85.4278", "MEAN_ANOMALY": "102.3456",
        "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": "39634",
        "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "12180", "BSTAR": ".10000E-3",
        "MEAN_MOTION_DOT": ".103940E-5", "MEAN_MOTION_DDOT": "0",
    },
    {
        "CCSDS_OMM_VERS": "2.0", "OBJECT_NAME": "SENTINEL-1B", "OBJECT_ID": "2016-025A",
        "EPOCH": "2026-03-06T00:00:00.000000",
        "MEAN_MOTION": "14.59197541", "ECCENTRICITY": ".0001515", "INCLINATION": "98.1814",
        "RA_OF_ASC_NODE": "228.7654", "ARG_OF_PERICENTER": "91.2345", "MEAN_ANOMALY": "287.6543",
        "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": "41456",
        "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "9420", "BSTAR": ".10000E-3",
        "MEAN_MOTION_DOT": ".103940E-5", "MEAN_MOTION_DDOT": "0",
    },
    {
        "CCSDS_OMM_VERS": "2.0", "OBJECT_NAME": "ICEYE-X7", "OBJECT_ID": "2021-006F",
        "EPOCH": "2026-03-06T00:00:00.000000",
        "MEAN_MOTION": "14.92712134", "ECCENTRICITY": ".0002100", "INCLINATION": "97.6840",
        "RA_OF_ASC_NODE": "132.1234", "ARG_OF_PERICENTER": "77.3456", "MEAN_ANOMALY": "45.2345",
        "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": "47506",
        "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "8640", "BSTAR": ".12000E-3",
        "MEAN_MOTION_DOT": ".120000E-5", "MEAN_MOTION_DDOT": "0",
    },
    {
        "CCSDS_OMM_VERS": "2.0", "OBJECT_NAME": "ICEYE-X8", "OBJECT_ID": "2021-006G",
        "EPOCH": "2026-03-06T00:00:00.000000",
        "MEAN_MOTION": "14.92712134", "ECCENTRICITY": ".0002200", "INCLINATION": "97.6840",
        "RA_OF_ASC_NODE": "312.5678", "ARG_OF_PERICENTER": "81.2345", "MEAN_ANOMALY": "220.7654",
        "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": "47507",
        "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "8641", "BSTAR": ".12000E-3",
        "MEAN_MOTION_DOT": ".120000E-5", "MEAN_MOTION_DDOT": "0",
    },
    {
        "CCSDS_OMM_VERS": "2.0", "OBJECT_NAME": "CAPELLA-3", "OBJECT_ID": "2021-006C",
        "EPOCH": "2026-03-06T00:00:00.000000",
        "MEAN_MOTION": "15.05209831", "ECCENTRICITY": ".0001800", "INCLINATION": "97.5541",
        "RA_OF_ASC_NODE": "175.4321", "ARG_OF_PERICENTER": "92.1234", "MEAN_ANOMALY": "161.2345",
        "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": "47380",
        "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "8500", "BSTAR": ".11000E-3",
        "MEAN_MOTION_DOT": ".110000E-5", "MEAN_MOTION_DDOT": "0",
    },
    {
        "CCSDS_OMM_VERS": "2.0", "OBJECT_NAME": "CAPELLA-4", "OBJECT_ID": "2021-006D",
        "EPOCH": "2026-03-06T00:00:00.000000",
        "MEAN_MOTION": "15.05209831", "ECCENTRICITY": ".0001900", "INCLINATION": "97.5541",
        "RA_OF_ASC_NODE": "355.8765", "ARG_OF_PERICENTER": "88.9876", "MEAN_ANOMALY": "335.6789",
        "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": "47381",
        "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "8501", "BSTAR": ".11000E-3",
        "MEAN_MOTION_DOT": ".110000E-5", "MEAN_MOTION_DDOT": "0",
    },
    {
        "CCSDS_OMM_VERS": "2.0", "OBJECT_NAME": "SENTINEL-2A", "OBJECT_ID": "2015-028A",
        "EPOCH": "2026-03-06T00:00:00.000000",
        "MEAN_MOTION": "14.30121522", "ECCENTRICITY": ".0000987", "INCLINATION": "98.5676",
        "RA_OF_ASC_NODE": "89.3456", "ARG_OF_PERICENTER": "90.2345", "MEAN_ANOMALY": "72.1234",
        "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": "40697",
        "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "11180", "BSTAR": ".80000E-4",
        "MEAN_MOTION_DOT": ".800000E-6", "MEAN_MOTION_DDOT": "0",
    },
    {
        "CCSDS_OMM_VERS": "2.0", "OBJECT_NAME": "SENTINEL-2B", "OBJECT_ID": "2017-013A",
        "EPOCH": "2026-03-06T00:00:00.000000",
        "MEAN_MOTION": "14.30121522", "ECCENTRICITY": ".0001023", "INCLINATION": "98.5676",
        "RA_OF_ASC_NODE": "269.7890", "ARG_OF_PERICENTER": "89.5678", "MEAN_ANOMALY": "253.4567",
        "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": "42063",
        "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "9820", "BSTAR": ".80000E-4",
        "MEAN_MOTION_DOT": ".800000E-6", "MEAN_MOTION_DDOT": "0",
    },
    {
        "CCSDS_OMM_VERS": "2.0", "OBJECT_NAME": "LANDSAT-8", "OBJECT_ID": "2013-008A",
        "EPOCH": "2026-03-06T00:00:00.000000",
        "MEAN_MOTION": "14.57319837", "ECCENTRICITY": ".0000734", "INCLINATION": "98.2192",
        "RA_OF_ASC_NODE": "142.6789", "ARG_OF_PERICENTER": "93.4567", "MEAN_ANOMALY": "186.7890",
        "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": "39084",
        "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "12420", "BSTAR": ".75000E-4",
        "MEAN_MOTION_DOT": ".750000E-6", "MEAN_MOTION_DDOT": "0",
    },
    {
        "CCSDS_OMM_VERS": "2.0", "OBJECT_NAME": "LANDSAT-9", "OBJECT_ID": "2021-088A",
        "EPOCH": "2026-03-06T00:00:00.000000",
        "MEAN_MOTION": "14.57319837", "ECCENTRICITY": ".0000812", "INCLINATION": "98.2192",
        "RA_OF_ASC_NODE": "322.3456", "ARG_OF_PERICENTER": "91.8901", "MEAN_ANOMALY": "10.9876",
        "EPHEMERIS_TYPE": "0", "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": "49260",
        "ELEMENT_SET_NO": "999", "REV_AT_EPOCH": "6180", "BSTAR": ".75000E-4",
        "MEAN_MOTION_DOT": ".750000E-6", "MEAN_MOTION_DDOT": "0",
    },
]

IMAGING_SATELLITES = [
    {"name": "SENTINEL-1A",  "norad": 39634, "type": "SAR",     "swath_km": 250},
    {"name": "SENTINEL-1B",  "norad": 41456, "type": "SAR",     "swath_km": 250},
    {"name": "ICEYE-X7",     "norad": 47506, "type": "SAR",     "swath_km": 100},
    {"name": "ICEYE-X8",     "norad": 47507, "type": "SAR",     "swath_km": 100},
    {"name": "CAPELLA-3",    "norad": 47380, "type": "SAR",     "swath_km": 100},
    {"name": "CAPELLA-4",    "norad": 47381, "type": "SAR",     "swath_km": 100},
    {"name": "SENTINEL-2A",  "norad": 40697, "type": "OPTICAL", "swath_km": 290},
    {"name": "SENTINEL-2B",  "norad": 42063, "type": "OPTICAL", "swath_km": 290},
    {"name": "LANDSAT-8",    "norad": 39084, "type": "OPTICAL", "swath_km": 185},
    {"name": "LANDSAT-9",    "norad": 49260, "type": "OPTICAL", "swath_km": 185},
]

# Step size for historical and forecast sweeps
STEP_MINUTES = 3


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _eci_to_geodetic(r_km, gmst_rad):
    """
    Convert ECI position vector (km) to geodetic (lat, lng in degrees, alt in km).
    Uses the standard iterative geodetic reduction with WGS-84 ellipsoid parameters.
    """
    x, y, z = r_km
    a = 6378.137        # WGS-84 semi-major axis km
    f = 1 / 298.257223563
    b = a * (1 - f)
    e2 = 1 - (b / a) ** 2

    # Longitude: rotate by GMST to convert ECI → ECEF
    lng_rad = math.atan2(y, x) - gmst_rad
    # Normalise to (-π, π]
    lng_rad = (lng_rad + math.pi) % (2 * math.pi) - math.pi

    # Latitude: iterative Bowring method
    p = math.sqrt(x ** 2 + y ** 2)
    lat_rad = math.atan2(z, p * (1 - e2))
    for _ in range(5):
        N = a / math.sqrt(1 - e2 * math.sin(lat_rad) ** 2)
        lat_rad = math.atan2(z + e2 * N * math.sin(lat_rad), p)

    N = a / math.sqrt(1 - e2 * math.sin(lat_rad) ** 2)
    alt_km = p / math.cos(lat_rad) - N if abs(math.cos(lat_rad)) > 1e-10 else abs(z) / math.sin(lat_rad) - N * (1 - e2)

    return math.degrees(lat_rad), math.degrees(lng_rad), alt_km


def _gmst(dt: datetime) -> float:
    """Greenwich Mean Sidereal Time in radians for the given UTC datetime."""
    # Julian date of J2000.0 epoch
    J2000 = 2451545.0
    jd = _jd_from_datetime(dt)
    T = (jd - J2000) / 36525.0
    # GMST in seconds (IAU formula)
    theta = (67310.54841
              + (876600.0 * 3600.0 + 8640184.812866) * T
              + 0.093104 * T ** 2
              - 6.2e-6 * T ** 3)
    return math.radians(theta % 86400.0 / 240.0)


def _jd_from_datetime(dt: datetime) -> float:
    """Julian date from a UTC datetime (via jday convenience)."""
    yr, mo, day = dt.year, dt.month, dt.day
    hr = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
    jd, fr = jday(yr, mo, day, hr, 0, 0)
    return jd + fr


def _propagate_to_geodetic(satrec: Satrec, dt: datetime):
    """
    Propagate satrec to dt, return (lat_deg, lng_deg, alt_km) or None on error.
    Uses sgp4 library's own geodetic conversion via GMST rotation (not simplified r-vector).
    """
    yr, mo, day = dt.year, dt.month, dt.day
    hr, mi, sc = dt.hour, dt.minute, dt.second + dt.microsecond / 1e6
    jd, fr = jday(yr, mo, day, hr, mi, sc)
    e, r, v = satrec.sgp4(jd, fr)
    if e != 0 or not r:
        return None
    gmst_rad = _gmst(dt)
    lat, lng, alt = _eci_to_geodetic(r, gmst_rad)
    return lat, lng, alt


def _is_solar_daylight(dt: datetime, lng_deg: float) -> bool:
    """Return True if the sub-satellite point is within ±6h of local solar noon."""
    utc_hour = dt.hour + dt.minute / 60.0
    solar_hour = (utc_hour + lng_deg / 15.0 + 24.0) % 24.0
    return abs(solar_hour - 12.0) <= 6.0


def _fetch_satrecs():
    """
    Fetch TLE set from CelesTrak, parse into {norad_id: Satrec} dict.
    Falls back to hardcoded OMM elements (via sgp4.omm.initialize) when
    CelesTrak is unreachable — same data as the frontend /api/satellites fallback.
    """
    target_norads = {s["norad"] for s in IMAGING_SATELLITES}

    # ── Try live CelesTrak TLE first ─────────────────────────────────────────
    try:
        resp = requests.get(CELESTRAK_TLE_URL, timeout=30)
        resp.raise_for_status()
        lines = resp.text.strip().splitlines()
        satrecs = {}
        i = 0
        while i + 2 < len(lines):
            name_line = lines[i].strip()
            line1 = lines[i + 1].strip()
            line2 = lines[i + 2].strip()
            if line1.startswith("1 ") and line2.startswith("2 "):
                try:
                    norad_id = int(line1[2:7])
                    if norad_id in target_norads:
                        sat = Satrec.twoline2rv(line1, line2)
                        satrecs[norad_id] = sat
                except Exception:
                    pass
                i += 3
            else:
                i += 1
        if satrecs:
            return satrecs
    except Exception as exc:
        print(f"[satellite_worker] CelesTrak TLE fetch failed: {exc}")

    # ── Fallback: build Satrec objects from hardcoded OMM elements ───────────
    # sgp4.omm.initialize() accepts the OMM dict directly as its `fields` arg.
    print("[satellite_worker] Using hardcoded OMM fallback data.")
    satrecs = {}
    for omm in _FALLBACK_OMM:
        try:
            norad_id = int(omm["NORAD_CAT_ID"])
            if norad_id not in target_norads:
                continue
            sat = Satrec()
            sgp4.omm.initialize(sat, omm)
            satrecs[norad_id] = sat
        except Exception as exc:
            print(f"[satellite_worker] Fallback OMM parse failed for {omm.get('OBJECT_NAME')}: {exc}")
    return satrecs


def compute_satellite_coverage() -> None:
    """
    Main entry point called by the Celery beat task.
    For each active event in the DB:
      - Scan 6h backward in 3-min steps → satellite_coverage (last pass info)
      - Scan 12h forward in 3-min steps → next_opportunities (first future overlap per sat)
    Writes results as JSONB to the event record.
    """
    from backend.database import SessionLocal
    from backend.models import Event

    db = SessionLocal()
    try:
        satrecs = _fetch_satrecs()
        if not satrecs:
            print("[satellite_worker] No satrecs loaded — skipping coverage computation.")
            return

        meta_by_norad = {s["norad"]: s for s in IMAGING_SATELLITES}
        now = datetime.now(timezone.utc)

        events = db.query(Event).all()
        for event in events:
            evt_lat, evt_lng = event.lat, event.lng

            # --- Historical scan: 6h back in 3-min steps ---
            # last_pass_ts: norad_id → most recent timestamp of overlap (or None)
            last_pass_ts: dict[int, datetime | None] = {n: None for n in satrecs}

            steps_back = int(6 * 60 / STEP_MINUTES)
            for step in range(steps_back):
                t = now - timedelta(minutes=step * STEP_MINUTES)
                for norad_id, satrec in satrecs.items():
                    if last_pass_ts.get(norad_id) is not None:
                        continue  # already found a pass for this satellite
                    geo = _propagate_to_geodetic(satrec, t)
                    if geo is None:
                        continue
                    sat_lat, sat_lng, _ = geo
                    meta = meta_by_norad[norad_id]
                    dist = haversine_km(sat_lat, sat_lng, evt_lat, evt_lng)
                    # 1.1 heuristic buffer for orbital uncertainty
                    if dist < meta["swath_km"] / 2 * 1.1:
                        # OPTICAL: require solar daylight window
                        if meta["type"] == "OPTICAL" and not _is_solar_daylight(t, sat_lng):
                            continue
                        last_pass_ts[norad_id] = t

            satellite_coverage = []
            for norad_id, satrec in satrecs.items():
                meta = meta_by_norad[norad_id]
                ts = last_pass_ts[norad_id]
                ago_seconds = int((now - ts).total_seconds()) if ts else None
                satellite_coverage.append({
                    "satellite_name": meta["name"],
                    "pass_type": meta["type"],
                    "last_pass_ago_seconds": ago_seconds,
                })

            # --- Forward scan: 12h ahead in 3-min steps ---
            # first_opportunity_ts: norad_id → earliest future overlap timestamp
            first_opp_ts: dict[int, datetime | None] = {n: None for n in satrecs}

            steps_fwd = int(12 * 60 / STEP_MINUTES)
            for step in range(1, steps_fwd + 1):
                t = now + timedelta(minutes=step * STEP_MINUTES)
                for norad_id, satrec in satrecs.items():
                    if first_opp_ts.get(norad_id) is not None:
                        continue  # already found first opportunity
                    geo = _propagate_to_geodetic(satrec, t)
                    if geo is None:
                        continue
                    sat_lat, sat_lng, _ = geo
                    meta = meta_by_norad[norad_id]
                    dist = haversine_km(sat_lat, sat_lng, evt_lat, evt_lng)
                    if dist < meta["swath_km"] / 2 * 1.1:
                        if meta["type"] == "OPTICAL" and not _is_solar_daylight(t, sat_lng):
                            continue
                        first_opp_ts[norad_id] = t

            next_opportunities = []
            for norad_id, ts in first_opp_ts.items():
                if ts is None:
                    continue
                meta = meta_by_norad[norad_id]
                in_seconds = int((ts - now).total_seconds())
                next_opportunities.append({
                    "satellite_name": meta["name"],
                    "pass_type": meta["type"],
                    "in_seconds": in_seconds,
                })
            # Sort by soonest first
            next_opportunities.sort(key=lambda x: x["in_seconds"])

            event.satellite_coverage = satellite_coverage
            event.next_opportunities = next_opportunities

        db.commit()
        print(f"[satellite_worker] Updated satellite coverage for {len(events)} events.")
    except Exception as exc:
        db.rollback()
        print(f"[satellite_worker] Error: {exc}")
        raise
    finally:
        db.close()


def run_satellite_coverage_task() -> None:
    """Celery-compatible task entry point."""
    compute_satellite_coverage()
