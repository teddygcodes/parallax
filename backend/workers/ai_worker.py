from sqlalchemy.orm import Session
from datetime import datetime, timezone
from backend.models import Event, Signal, Claim, ClaimStatus
import uuid
import os
import re
import json


def extract_claims_for_event(event_id: str, db: Session):
    """Extract discrete factual claims from signals. Store in claims table."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event or len(event.signals) < 3:
        return

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        _mock_claims(event, db)
        return

    from anthropic import Anthropic
    client = Anthropic(api_key=api_key)

    signals_text = "\n".join([
        f"[{s.source_category.value}] {s.source}: {s.description or ''}"
        for s in event.signals
    ])

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": f"""Extract discrete factual claims from these reports.
Return a JSON array. Each item: {{"claim_text": str, "source": str, "source_category": str}}
Do not include opinions or subjective characterizations. Only factual assertions.

Reports:
{signals_text}

Return only the JSON array."""}]
    )

    try:
        match = re.search(r'\[.*\]', response.content[0].text, re.DOTALL)
        if match:
            claims_data = json.loads(match.group())
            for claim_data in claims_data[:10]:
                _add_claim(
                    event.id,
                    claim_data.get("claim_text", ""),
                    claim_data.get("source", "unknown"),
                    claim_data.get("source_category", "UNKNOWN"),
                    db,
                )
            db.commit()
            return
    except Exception:
        pass

    _mock_claims(event, db)


def _add_claim(event_id: str, claim_text: str, source: str, source_cat: str, db: Session):
    existing = db.query(Claim).filter(
        Claim.event_id == event_id,
        Claim.claim_text == claim_text,
    ).first()
    if not existing:
        db.add(Claim(
            id=str(uuid.uuid4()),
            event_id=event_id,
            claim_text=claim_text,
            source=source,
            source_category=source_cat,
            first_seen_at=datetime.now(timezone.utc),
            status=ClaimStatus.UNVERIFIED,
            confidence_score=0.5,
        ))


def _mock_claims(event, db: Session):
    """Generate mock claims when API key is not set."""
    mock = [
        ("Strike targeted military installation", "Reuters", "WESTERN"),
        ("Attack hit civilian infrastructure", "RT", "RUSSIAN"),
        ("Explosion confirmed by local witnesses", "Bellingcat", "OSINT"),
    ]
    for claim_text, source, source_cat in mock:
        _add_claim(event.id, claim_text, source, source_cat, db)
    db.commit()


def extract_all_claims(db: Session):
    """Extract claims for all non-test events that have >= 3 signals."""
    for event in db.query(Event).filter(~Event.id.like("EVT-TEST-%")).all():
        extract_claims_for_event(event.id, db)
