# PARALLAX Phase 1 — Loop 3: AI Pipeline

You are building PARALLAX. Foundation and data pipeline are complete from Loops 1 and 2.
Full spec: PARALLAXprompt.md. Read it.

## ALWAYS START HERE — CHECK WHAT EXISTS

```bash
ls -la backend/services/ai_analysis.py 2>/dev/null
ls -la backend/workers/ai_worker.py 2>/dev/null
curl localhost:8000/events | python3 -m json.tool
curl localhost:8000/events/EVT-2026-000001/signals | python3 -m json.tool
cd backend && python -m pytest tests/ --tb=no -q
```

If events have no signals, run: `python -c "from backend.workers.news_worker import ingest_news; from backend.database import SessionLocal; ingest_news(SessionLocal())"`

## WHAT YOU ARE BUILDING

### 1. backend/services/ai_analysis.py — Full Anthropic integration

CRITICAL RULE: If `ANTHROPIC_API_KEY` env var is SET, ALWAYS call the real API.
The mock fallback is ONLY for when the env var is ABSENT or empty.
Never silently return mock data when a key is present.

```python
import os
import re
import json
from anthropic import Anthropic

def get_analysis(event_id: str, signals: list) -> dict:
    """
    Main entry point. Called by GET /events/{id}/analysis.
    signals: list of dicts with keys: source, source_category, description
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _mock_analysis(event_id, signals)
    return _real_analysis(event_id, signals, api_key)

def _real_analysis(event_id: str, signals: list, api_key: str) -> dict:
    client = Anthropic(api_key=api_key)
    prompt = _build_prompt(event_id, signals)
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}]
    )
    return _parse_response(response.content[0].text, event_id, signals)

def _build_prompt(event_id: str, signals: list) -> str:
    signals_text = "\n".join([
        f"[{s.get('source_category', 'UNKNOWN')}] {s.get('source', 'Unknown')}: {s.get('description', '')}"
        for s in signals
    ])
    return f"""You are a neutral intelligence analyst. Do not take sides. Do not use the word "propaganda".

Event ID: {event_id}
Incoming reports:
{signals_text}

Respond with ONLY a JSON object with exactly these keys:
- "what_is_confirmed": string — only facts multiple independent sources agree on
- "what_is_disputed": string — specific claims sources actively contradict
- "where_information_goes_dark": string — what cannot be verified from current reporting
- "core_disagreement": string — the single central point of narrative conflict
- "divergence_score": number 0.0-1.0 — 0=full consensus, 1=extreme conflict
- "coordinated_messaging_suspected": boolean — true if sources from same category use identical framing

No other text. Return only the JSON."""

def _parse_response(text: str, event_id: str, signals: list) -> dict:
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            result = json.loads(match.group())
            # Validate all required keys present
            required = ["what_is_confirmed", "what_is_disputed", "where_information_goes_dark",
                        "core_disagreement", "divergence_score", "coordinated_messaging_suspected"]
            if all(k in result for k in required):
                return result
        except json.JSONDecodeError:
            pass
    # Fallback if parsing fails
    return _mock_analysis(event_id, signals)

def _mock_analysis(event_id: str, signals: list) -> dict:
    source_categories = list(set(s.get("source_category", "UNKNOWN") for s in signals))
    if len(source_categories) <= 1:
        divergence = 0.25
    elif len(source_categories) == 2:
        divergence = 0.55
    elif len(source_categories) == 3:
        divergence = 0.72
    else:
        divergence = 0.85

    return {
        "what_is_confirmed": "Explosion detected at reported coordinates. Geolocated video verified by OSINT sources.",
        "what_is_disputed": "Target type and casualty figures vary significantly across source categories.",
        "where_information_goes_dark": "No independent access to site. Satellite imagery expected within 6-12 hours.",
        "core_disagreement": "Who launched the strike and what the intended target was.",
        "divergence_score": divergence,
        "coordinated_messaging_suspected": False,
    }
```

### 2. Verify GET /events/{id}/analysis uses the new service

The events router already calls `get_analysis()` from Loop 1 stub. Now that the full service exists, it should work automatically. Verify:

```bash
curl localhost:8000/events/EVT-2026-000001/analysis | python3 -m json.tool
# Must return all 6 keys
curl localhost:8000/events/EVT-9999/analysis
# Must return 404
```

### 3. backend/workers/ai_worker.py — Claim extraction

For each event with ≥3 signals, extract individual factual claims:

```python
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
Do not include opinions. Do not use the word "propaganda". Only factual assertions.

Reports:
{signals_text}

Return only the JSON array."""}]
    )

    try:
        match = re.search(r'\[.*\]', response.content[0].text, re.DOTALL)
        if match:
            claims_data = json.loads(match.group())
            for claim_data in claims_data[:10]:  # cap at 10 claims per event
                claim = Claim(
                    id=str(uuid.uuid4()),
                    event_id=event_id,
                    claim_text=claim_data.get("claim_text", ""),
                    source=claim_data.get("source", "unknown"),
                    source_category=claim_data.get("source_category", "UNKNOWN"),
                    first_seen_at=datetime.now(timezone.utc),
                    status=ClaimStatus.UNVERIFIED,
                    confidence_score=0.5,
                )
                db.add(claim)
            db.commit()
    except Exception:
        _mock_claims(event, db)

def _mock_claims(event, db: Session):
    """Generate mock claims when API key not set."""
    mock_claims = [
        ("Strike targeted military installation", "Reuters", "WESTERN"),
        ("Attack hit civilian infrastructure", "RT", "RUSSIAN"),
        ("Explosion confirmed by local witnesses", "Bellingcat", "OSINT"),
    ]
    for claim_text, source, source_cat in mock_claims:
        existing = db.query(Claim).filter(
            Claim.event_id == event.id,
            Claim.claim_text == claim_text
        ).first()
        if not existing:
            claim = Claim(
                id=str(uuid.uuid4()),
                event_id=event.id,
                claim_text=claim_text,
                source=source,
                source_category=source_cat,
                first_seen_at=datetime.now(timezone.utc),
                status=ClaimStatus.UNVERIFIED,
                confidence_score=0.5,
            )
            db.add(claim)
    db.commit()
```

### 4. backend/tests/test_ai.py

```python
from unittest.mock import patch, MagicMock
import pytest
import os

def test_returns_all_required_fields_with_mock():
    """When no API key, mock returns correct structure with all required fields."""
    os.environ.pop("ANTHROPIC_API_KEY", None)
    from backend.services.ai_analysis import get_analysis
    result = get_analysis("EVT-2026-000001", [
        {"source": "Reuters", "source_category": "WESTERN", "description": "Strike hit military depot"},
        {"source": "RT", "source_category": "RUSSIAN", "description": "Strike hit civilian building"},
    ])
    required_keys = ["what_is_confirmed", "what_is_disputed", "where_information_goes_dark",
                     "core_disagreement", "divergence_score", "coordinated_messaging_suspected"]
    for key in required_keys:
        assert key in result, f"Missing required key: {key}"
    assert isinstance(result["divergence_score"], (int, float))
    assert 0.0 <= result["divergence_score"] <= 1.0
    assert isinstance(result["coordinated_messaging_suspected"], bool)

def test_real_api_path_called_when_key_present():
    """When API key is set, must call real Anthropic client — NOT the mock fallback."""
    os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test-fake-key"
    mock_response_text = json.dumps({
        "what_is_confirmed": "confirmed test",
        "what_is_disputed": "disputed test",
        "where_information_goes_dark": "dark test",
        "core_disagreement": "disagreement test",
        "divergence_score": 0.5,
        "coordinated_messaging_suspected": False,
    })
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=mock_response_text)]
    mock_client.messages.create.return_value = mock_response

    with patch("backend.services.ai_analysis.Anthropic", return_value=mock_client):
        from importlib import reload
        import backend.services.ai_analysis as ai_mod
        reload(ai_mod)
        result = ai_mod.get_analysis("EVT-2026-000001", [
            {"source": "Reuters", "source_category": "WESTERN", "description": "Strike confirmed"},
        ])

    mock_client.messages.create.assert_called_once()
    assert result["what_is_confirmed"] == "confirmed test"
    os.environ.pop("ANTHROPIC_API_KEY", None)

def test_divergence_higher_with_more_source_categories():
    """Multi-category sources produce higher divergence score than single-category."""
    os.environ.pop("ANTHROPIC_API_KEY", None)
    from backend.services.ai_analysis import get_analysis
    single = get_analysis("EVT-A", [
        {"source": "Reuters", "source_category": "WESTERN", "description": "A"},
        {"source": "AP",      "source_category": "WESTERN", "description": "B"},
    ])
    multi = get_analysis("EVT-B", [
        {"source": "Reuters",    "source_category": "WESTERN",     "description": "A"},
        {"source": "RT",         "source_category": "RUSSIAN",     "description": "B"},
        {"source": "Al Jazeera", "source_category": "MIDDLE_EAST", "description": "C"},
        {"source": "Bellingcat", "source_category": "OSINT",       "description": "D"},
    ])
    assert multi["divergence_score"] > single["divergence_score"], \
        f"Multi-category score ({multi['divergence_score']}) should exceed single ({single['divergence_score']})"

def test_404_for_unknown_event(test_client):
    response = test_client.get("/events/EVT-DOES-NOT-EXIST/analysis")
    assert response.status_code == 404

import json
```

## SAFETY CHECKS — Run before claiming done

```bash
grep -r "propaganda" backend/
# Must return NOTHING — the word "propaganda" must not appear anywhere in backend code or tests
```

## COMPLETION CRITERIA

All must pass:

```bash
cd backend && pytest tests/test_ai.py -v
# All 4 tests must pass

curl localhost:8000/events/EVT-2026-000001/analysis | python3 -m json.tool
# Must include ALL 6 keys:
# what_is_confirmed, what_is_disputed, where_information_goes_dark,
# core_disagreement, divergence_score, coordinated_messaging_suspected

curl localhost:8000/events/EVT-9999/analysis
# Must return HTTP 404

grep -r "propaganda" backend/
# Must return NO output

cd backend && pytest
# All tests (schema + clustering + ai) must pass
```

Only output this when all pass:

<promise>AI_PIPELINE_COMPLETE</promise>
