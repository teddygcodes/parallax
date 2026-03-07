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
