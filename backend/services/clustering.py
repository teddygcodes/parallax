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
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def type_similarity(type_a: str, type_b: str) -> float:
    return TYPE_SIMILARITY.get((type_a, type_b), 0.0)


def should_cluster(
    signal_lat: float,
    signal_lon: float,
    signal_time: datetime,
    signal_type: str,
    event_lat: float,
    event_lon: float,
    event_time: datetime,
    event_type: str,
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


def generate_event_id_from_db(db) -> str:
    from backend.models import Event
    import re
    from datetime import datetime
    year = datetime.utcnow().year
    # Find the highest sequence number in use for this year
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


def process_incoming_signal(signal_data: dict, db) -> str:
    """
    Given a signal dict (lat, lon, time, type), find matching event or create new one.
    Returns the event_id this signal belongs to.

    signal_data keys:
        lat  (float)
        lon  (float)
        time (datetime)
        type (str)
    """
    from backend.models import Event, EventType, ConfidenceLevel

    # Search existing non-test events for a cluster match
    events = db.query(Event).filter(~Event.id.like("EVT-TEST-%")).all()
    for ev in events:
        if should_cluster(
            signal_data["lat"],
            signal_data["lon"],
            signal_data["time"],
            signal_data["type"],
            ev.lat,
            ev.lng,
            ev.first_detection_time,
            ev.event_type.value,
        ):
            return ev.id

    # No match — create a new event
    event_id = generate_event_id_from_db(db)
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
