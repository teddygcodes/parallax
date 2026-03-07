def test_all_four_tables_exist(db_engine):
    from sqlalchemy import inspect
    inspector = inspect(db_engine)
    tables = inspector.get_table_names()
    assert "event" in tables, f"'event' table missing. Found: {tables}"
    assert "signals" in tables, f"'signals' table missing. Found: {tables}"
    assert "claims" in tables, f"'claims' table missing. Found: {tables}"
    assert "narrative_history" in tables, f"'narrative_history' table missing. Found: {tables}"


def test_foreign_keys(db_engine):
    from sqlalchemy import inspect
    inspector = inspect(db_engine)
    signal_fks = [fk["referred_table"] for fk in inspector.get_foreign_keys("signals")]
    assert "event" in signal_fks
    claim_fks = [fk["referred_table"] for fk in inspector.get_foreign_keys("claims")]
    assert "event" in claim_fks
    narrative_fks = [fk["referred_table"] for fk in inspector.get_foreign_keys("narrative_history")]
    assert "claims" in narrative_fks


def test_event_id_format(db_session):
    from backend.models import Event, EventType, ConfidenceLevel
    from datetime import datetime, timezone
    ev = Event(
        id="EVT-2026-000099",
        lat=31.343, lng=34.305,
        first_detection_time=datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc),
        event_type=EventType.STRIKE,
        confidence=ConfidenceLevel.UNCONFIRMED,
    )
    db_session.add(ev)
    db_session.commit()
    result = db_session.get(Event, "EVT-2026-000099")
    assert result is not None
    assert result.lat == 31.343


def test_generate_event_id_format(db_session):
    """The ID generator must produce EVT-YYYY-NNNNNN format."""
    import re
    from backend.services.clustering import generate_event_id_from_db
    event_id = generate_event_id_from_db(db_session)
    assert re.match(r'^EVT-\d{4}-\d{6}$', event_id), \
        f"Generated ID '{event_id}' does not match EVT-YYYY-NNNNNN format"
    year_part = event_id.split("-")[1]
    assert year_part == "2026", f"Year part should be 2026, got {year_part}"
