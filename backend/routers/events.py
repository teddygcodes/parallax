from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Event, Signal, SourceCategory, EventType, ConfidenceLevel
from ..services.ai_analysis import get_analysis
from ..config import settings
from datetime import datetime, timezone
import uuid

router = APIRouter()


def seed_mock_events(db: Session):
    """Seed mock events if DB is empty — enables verification before real ingestion."""
    if db.query(Event).count() > 0:
        return
    mock_event = Event(
        id="EVT-2026-000001",
        lat=31.343,
        lng=34.305,
        first_detection_time=datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc),
        event_type=EventType.STRIKE,
        confidence=ConfidenceLevel.REPORTED,
    )
    db.add(mock_event)
    mock_signals = [
        Signal(
            id=str(uuid.uuid4()),
            event_id="EVT-2026-000001",
            source="Reuters",
            source_category=SourceCategory.WESTERN,
            published_at=datetime(2026, 3, 4, 18, 10, tzinfo=timezone.utc),
            description="Strike confirmed at reported location. Military sources cited.",
        ),
        Signal(
            id=str(uuid.uuid4()),
            event_id="EVT-2026-000001",
            source="RT",
            source_category=SourceCategory.RUSSIAN,
            published_at=datetime(2026, 3, 4, 18, 45, tzinfo=timezone.utc),
            description="Attack on civilian infrastructure. No military targets confirmed.",
        ),
        Signal(
            id=str(uuid.uuid4()),
            event_id="EVT-2026-000001",
            source="Bellingcat",
            source_category=SourceCategory.OSINT,
            published_at=datetime(2026, 3, 4, 21, 30, tzinfo=timezone.utc),
            description="Geolocated video confirms strike coordinates. Target unclear.",
        ),
    ]
    for s in mock_signals:
        db.add(s)
    db.commit()


@router.get("/events")
def list_events(limit: int = 20, offset: int = 0, db: Session = Depends(get_db)):
    seed_mock_events(db)
    total = db.query(Event).count()
    events = db.query(Event).offset(offset).limit(limit).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "events": [
            {
                "id": e.id,
                "lat": e.lat,
                "lng": e.lng,
                "event_type": e.event_type.value,
                "confidence": e.confidence.value,
                "first_detection_time": e.first_detection_time.isoformat(),
                "signal_count": len(e.signals),
            }
            for e in events
        ],
    }


@router.get("/events/{event_id}/signals")
def get_event_signals(event_id: str, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")
    return [
        {
            "id": s.id,
            "source": s.source,
            "source_category": s.source_category.value,
            "published_at": s.published_at.isoformat(),
            "description": s.description,
            "article_url": s.article_url,
        }
        for s in sorted(event.signals, key=lambda x: x.published_at)
    ]


@router.get("/signals/recent")
def get_recent_signals(limit: int = 100, db: Session = Depends(get_db)):
    """Return the most recent signals across all events, newest first.
    Joins Event to include event_type, lat, lng for client-side event reconstruction.
    """
    rows = (
        db.query(Signal, Event)
        .join(Event, Signal.event_id == Event.id)
        .order_by(Signal.published_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id":              sig.id,
            "event_id":        sig.event_id,
            "event_type":      evt.event_type.value,
            "event_lat":       evt.lat,
            "event_lng":       evt.lng,
            "source":          sig.source,
            "source_category": sig.source_category.value,
            "article_url":     sig.article_url,
            "published_at":    sig.published_at.isoformat() if sig.published_at else None,
            "description":     sig.description,
        }
        for sig, evt in rows
    ]


@router.get("/signals/recent-grouped")
def get_recent_signals_grouped(limit: int = 20, db: Session = Depends(get_db)):
    """Return recent signals grouped by event, with per-category buckets.
    Excludes GDELT (source == 'GDELT') — GDELT is background event-generation data,
    not perspective media. LOCAL is excluded from v1 layout.
    Looks at the 300 most recent non-GDELT signals, groups by event_id,
    returns the top `limit` event groups ordered by newest signal desc.
    """
    PERSPECTIVE_CATS = ["WESTERN", "RUSSIAN", "MIDDLE_EAST", "OSINT"]
    MAX_PER_CAT = 3
    RAW_LIMIT = 300

    rows = (
        db.query(Signal, Event)
        .join(Event, Signal.event_id == Event.id)
        .filter(Signal.source != "GDELT")
        .order_by(Signal.published_at.desc())
        .limit(RAW_LIMIT)
        .all()
    )

    # Group signals by event_id
    groups: dict = {}
    for sig, evt in rows:
        eid = evt.id
        if eid not in groups:
            groups[eid] = {
                "event_id":             evt.id,
                "event_type":           evt.event_type.value,
                "event_lat":            evt.lat,
                "event_lng":            evt.lng,
                "first_detection_time": evt.first_detection_time.isoformat() if evt.first_detection_time else None,
                "headline_hint":        None,
                "_newest_ts":           evt.first_detection_time,  # deterministic fallback
                "_signals":             [],
            }
        groups[eid]["_signals"].append(sig)
        ts = sig.published_at
        if ts and (groups[eid]["_newest_ts"] is None or ts > groups[eid]["_newest_ts"]):
            groups[eid]["_newest_ts"] = ts

    # Sort by newest signal descending — datetime.min.replace(tzinfo=timezone.utc) as fallback
    # avoids int/datetime mixing and TypeError on None values
    ordered = sorted(
        groups.values(),
        key=lambda g: g["_newest_ts"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:limit]

    result = []
    for g in ordered:
        sigs = g.pop("_signals")
        newest_ts = g.pop("_newest_ts")

        # headline_hint: best-effort snippet from newest non-empty signal description.
        # Muted subtitle — NOT a canonical location label.
        headline_hint = "No summary available"
        for s in sorted(sigs, key=lambda x: x.published_at, reverse=True):
            if s.description:
                snippet = s.description.strip()
                if len(snippet) > 40:
                    cut = snippet.rfind(" ", 0, 40)
                    snippet = (snippet[:cut] if cut > 0 else snippet[:40]).rstrip() + "..."
                headline_hint = snippet
                break
        g["headline_hint"] = headline_hint

        # Expose newest_signal_at for frontend relative-time display in row header
        g["newest_signal_at"] = newest_ts.isoformat() if newest_ts else None

        # Build per-category buckets (top MAX_PER_CAT newest each)
        # Deduplicate by signal id within each bucket
        by_cat: dict = {cat: [] for cat in PERSPECTIVE_CATS}
        seen_ids: set = set()
        for s in sorted(sigs, key=lambda x: x.published_at, reverse=True):
            if s.id in seen_ids:
                continue
            cat = s.source_category.value
            if cat in by_cat and len(by_cat[cat]) < MAX_PER_CAT:
                by_cat[cat].append({
                    "id":              s.id,
                    "source":          s.source,
                    "source_category": cat,
                    "article_url":     s.article_url,
                    "published_at":    s.published_at.isoformat() if s.published_at else None,
                    "description":     s.description,
                })
                seen_ids.add(s.id)

        g["signals_by_category"] = by_cat
        # Total signals across perspective categories (excludes LOCAL etc.)
        g["signal_count"] = sum(len(v) for v in by_cat.values())
        result.append(g)

    return result


@router.get("/events/{event_id}/analysis")
def get_event_analysis(event_id: str, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")
    signals_data = [
        {
            "source": s.source,
            "source_category": s.source_category.value,
            "description": s.description or "",
        }
        for s in event.signals
    ]
    analysis = get_analysis(event_id, signals_data)
    # Extend with satellite fields from the event record (null until worker runs)
    analysis["satellite_coverage"] = event.satellite_coverage
    analysis["next_opportunities"] = event.next_opportunities
    return analysis


@router.get("/events/{event_id}/brief")
async def get_event_brief(event_id: str, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")

    if not event.signals:
        return {
            "event_id": event_id,
            "brief": "No signals available for this event.",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "cached": False,
        }

    if event.brief_text and event.brief_generated_at:
        age = (datetime.now(timezone.utc) - event.brief_generated_at).total_seconds()
        if age < 1800:
            return {
                "event_id": event_id,
                "brief": event.brief_text,
                "generated_at": event.brief_generated_at.isoformat(),
                "cached": True,
            }

    signal_lines = []
    for s in event.signals:
        signal_lines.append(f"- [{s.source_category.value}] {s.source}: {s.description or ''}")
    signals_text = "\n".join(signal_lines) if signal_lines else "No signals available."

    sat_text = "No satellite imaging opportunity is currently available."
    if event.next_opportunities:
        try:
            opp = event.next_opportunities[0]
            hours = round(opp["in_seconds"] / 3600, 1)
            sat_text = (
                f"Next imaging opportunity: {opp['satellite_name']} "
                f"in approximately {hours} hours ({opp['pass_type']})."
            )
        except (KeyError, IndexError, TypeError):
            pass

    divergence_text = ""
    try:
        signals_data = [
            {
                "source": s.source,
                "source_category": s.source_category.value,
                "description": s.description or "",
            }
            for s in event.signals
        ]
        analysis = get_analysis(event_id, signals_data)
        divergence_score = analysis.get("divergence_score")
        if divergence_score is not None:
            divergence_text = f"Narrative divergence score: {divergence_score:.2f}."
    except Exception:
        divergence_text = ""

    prompt = f"""You are an intelligence analyst writing a concise event brief.

Event: {event.event_type.value} at coordinates {event.lat:.3f}, {event.lng:.3f}
Time: {event.first_detection_time.isoformat()} UTC

Signals:
{signals_text}

Satellite: {sat_text}
{divergence_text}

Write a brief of maximum 90 words. Rules:
- Plain prose only, no bullet points
- State what is confirmed, what is disputed, and what is unknown
- Mention uncertainty explicitly
- Reference the satellite window only if present
- Use "possible coverage" or "imaging opportunity" — never "active imaging", "confirmed imaging", or "scheduled imaging"
- Never use "likely", "appears", or "suggests" unless directly supported by a signal
- If sources contradict, state the contradiction only — do not resolve or favor either side
- Neutral tone, no editorializing
- Only reference information present above
- Maximum 90 words"""

    brief_text = None
    api_key = settings.anthropic_api_key

    if api_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            message = client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=150,
                messages=[{"role": "user", "content": prompt}],
            )
            brief_text = message.content[0].text.strip()
            # Hard-cap AI output to 90 words
            brief_text = " ".join(brief_text.split())
            if len(brief_text.split()) > 90:
                brief_text = " ".join(brief_text.split()[:90])
        except Exception:
            brief_text = None

    # Deterministic fallback — must always succeed, never return 500, must stay under 90 words
    if not brief_text:
        source_count = len(event.signals)
        brief_text = (
            f"A {event.event_type.value.lower()} was reported at this location. "
            f"{source_count} signal{'s were' if source_count != 1 else ' was'} ingested from multiple source categories. "
            f"Some details remain disputed and independent verification is incomplete. "
        )
        if sat_text != "No satellite imaging opportunity is currently available.":
            brief_text += sat_text
        else:
            brief_text += "No satellite imaging opportunity is currently available."

        # Hard-cap fallback to 90 words
        brief_text = " ".join(brief_text.split())
        if len(brief_text.split()) > 90:
            brief_text = " ".join(brief_text.split()[:90])

    # Final normalization before storing
    brief_text = " ".join(brief_text.split())

    event.brief_text = brief_text
    event.brief_generated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(event)

    return {
        "event_id": event_id,
        "brief": event.brief_text,
        "generated_at": event.brief_generated_at.isoformat(),
        "cached": False,
    }


# ── Source Threads ────────────────────────────────────────────────────────────

def classify_signal_type(description: str, url: str = "") -> str:
    if not description:
        return "unknown"

    desc = description.lower()
    url_lower = (url or "").lower()

    # Check URL first — direct media links are stronger evidence than wording
    if any(ext in url_lower for ext in ("youtu", "vimeo", ".mp4")):
        return "video"

    if any(w in desc for w in ["video", "footage", "clip", "film"]):
        return "video"

    if any(w in desc for w in ["image", "photo", "imagery", "satellite imagery"]):
        return "image"

    if any(w in desc for w in ["geolocation", "geolocated", "thread"]):
        return "thread"

    if any(w in desc for w in ["statement", "official", "spokesperson", "ministry"]):
        return "statement"

    if any(w in desc for w in ["article", "report", "field report", "sources cited"]):
        return "article"

    return "unknown"

# v2: allow embedded media previews and geolocation tags

TYPE_PRIORITY = ["thread", "video", "image", "statement", "article", "unknown"]


def sort_key(item):
    t = item.get("type", "unknown")
    return TYPE_PRIORITY.index(t) if t in TYPE_PRIORITY else len(TYPE_PRIORITY)


@router.get("/events/{event_id}/threads")
async def get_event_threads(event_id: str, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()

    if not event:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")

    if not event.signals:
        return {"event_id": event_id, "source_threads": []}

    grouped: dict = {}
    seen: set = set()

    for s in event.signals:
        source_name = s.source
        category = s.source_category.value

        raw_label = (s.description or "").strip()
        label = raw_label if raw_label else "No description available"

        # Truncate at word boundary; fall back to hard cut if no space found before 77
        if len(label) > 80:
            cut = label.rfind(' ', 0, 77)
            label = (label[:cut] if cut > 0 else label[:77]).rstrip() + "..."

        # Deduplicate within source
        dedup_key = (source_name, label.lower())
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        # article_url is confirmed present on Signal (audited) — use directly
        url = s.article_url if s.article_url else None

        if source_name not in grouped:
            grouped[source_name] = {
                "source": source_name,
                "source_category": category,
                "items": []
            }

        grouped[source_name]["items"].append({
            "type": classify_signal_type(raw_label, url or ""),
            "label": label,
            "url": url
        })

    # Sort items within each source group
    for group in grouped.values():
        group["items"].sort(key=sort_key)

    # Order sources by category priority; secondary sort by name for stability
    category_order = ["WESTERN", "OSINT", "MIDDLE_EAST", "LOCAL", "RUSSIAN"]

    ordered = sorted(
        grouped.values(),
        key=lambda g: (
            category_order.index(g["source_category"])
            if g["source_category"] in category_order
            else len(category_order),
            g["source"].lower(),
        )
    )

    return {
        "event_id": event_id,
        "source_threads": ordered
    }
