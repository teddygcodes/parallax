from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from ..database import get_db
from ..services.clustering import should_cluster
from ..models import Event, Signal, EventType, ConfidenceLevel, SourceCategory
import uuid

router = APIRouter(prefix="/ingest")


@router.post("/test-cluster")
def test_cluster(db: Session = Depends(get_db)):
    """
    Validates clustering: feeds 3 near-identical signals, must produce 1 event not 3.
    The clustering logic actually runs — response is NOT hardcoded.
    """
    # Clean up any prior test data
    db.query(Signal).filter(Signal.source == "TEST_CLUSTER").delete()
    db.query(Event).filter(Event.id.like("EVT-TEST-%")).delete()
    db.commit()

    test_signals = [
        {
            "lat": 31.343,
            "lon": 34.305,
            "time": datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc),
            "type": "STRIKE",
        },
        {
            "lat": 31.345,
            "lon": 34.307,
            "time": datetime(2026, 3, 4, 18, 10, tzinfo=timezone.utc),
            "type": "STRIKE",
        },
        {
            "lat": 31.341,
            "lon": 34.302,
            "time": datetime(2026, 3, 4, 18, 22, tzinfo=timezone.utc),
            "type": "STRIKE",
        },
    ]

    events_created = []
    signals_merged = 0

    for i, sig_data in enumerate(test_signals):
        merged = False
        for ev in events_created:
            if should_cluster(
                sig_data["lat"],
                sig_data["lon"],
                sig_data["time"],
                sig_data["type"],
                ev["lat"],
                ev["lon"],
                ev["time"],
                ev["type"],
            ):
                signal = Signal(
                    id=str(uuid.uuid4()),
                    event_id=ev["id"],
                    source="TEST_CLUSTER",
                    source_category=SourceCategory.OSINT,
                    published_at=sig_data["time"],
                    description=f"Test signal {i + 1}",
                )
                db.add(signal)
                signals_merged += 1
                merged = True
                break

        if not merged:
            event_id = f"EVT-TEST-{len(events_created) + 1:06d}"
            event = Event(
                id=event_id,
                lat=sig_data["lat"],
                lng=sig_data["lon"],
                first_detection_time=sig_data["time"],
                event_type=EventType(sig_data["type"]),
                confidence=ConfidenceLevel.UNCONFIRMED,
            )
            db.add(event)
            db.flush()
            signal = Signal(
                id=str(uuid.uuid4()),
                event_id=event_id,
                source="TEST_CLUSTER",
                source_category=SourceCategory.OSINT,
                published_at=sig_data["time"],
                description=f"Test signal {i + 1}",
            )
            db.add(signal)
            events_created.append({"id": event_id, **sig_data})

    db.commit()

    return {
        "signals_received": len(test_signals),
        "events_created": len(events_created),
        "events_merged": signals_merged,
        "cluster_id": events_created[0]["id"] if events_created else None,
    }
