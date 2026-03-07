# PARALLAX Phase 4A — Auto Brief

## Always start here

```bash
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/models/event.py
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/models/signal.py
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/routers/events.py
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/core/config.py
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/services/ai_analysis.py
grep -n "brief_text\|brief_generated" /Users/tylergilstrap/Desktop/PARALLAX/backend/models/event.py
```

List the exact field names on Event and Signal before writing any code. Confirm whether `brief_text` and `brief_generated_at` already exist. Do not proceed until you have read the files.

---

## What you're building

One new backend endpoint: GET /events/{event_id}/brief
One new AUTO BRIEF section in NarrativePanel.tsx

This feature derives entirely from existing DB data. No new data sources. No new tables. No separate cache model.

---

## Step 1 — Install dependency

```bash
cd /Users/tylergilstrap/Desktop/PARALLAX/backend
pip install anthropic
```

---

## Step 2 — Add cache fields to Event model

In backend/models/event.py, ensure this import exists:
```python
from sqlalchemy import Column, String, Float, DateTime, Enum, Text
```

Add to Event class:
```python
brief_text           = Column(Text, nullable=True)
brief_generated_at   = Column(DateTime(timezone=True), nullable=True)
```

---

## Step 3 — Alembic migration

```bash
cd /Users/tylergilstrap/Desktop/PARALLAX/backend
alembic revision --autogenerate -m "add brief cache fields"
alembic upgrade head
python -c "from models.event import Event; print([c.name for c in Event.__table__.columns])"
```

---

## Step 4 — New endpoint: GET /{event_id}/brief

Add to backend/routers/events.py.

Important:
- Router already sits under /events in main.py — path must be @router.get("/{event_id}/brief"), NOT /events/{event_id}/brief
- Use exact audited field names only (s.source, s.source_category.value, s.description)
- Reuse get_analysis() exactly as the existing /analysis route does — same call style, same signals_data shape
- Load API key via settings.anthropic_api_key; add "from ..core.config import settings" if not already imported
- "from ..services.ai_analysis import get_analysis" — reuse existing import if already present; do not duplicate
- Never hardcode keys; never return 500

Full implementation:

```python
from datetime import datetime, timezone
# from ..core.config import settings  <- add if not already imported

@router.get("/{event_id}/brief")
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
        # Reuse get_analysis exactly the same way the existing /analysis route calls it.
        # Do not invent a sync/async wrapper pattern unless the existing route already uses one.
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
            f"{source_count} signal{'s' if source_count != 1 else ''} were ingested from multiple source categories. "
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
```

---

## Step 5 — Frontend type

Add to frontend/types/index.ts:
```ts
export interface EventBrief {
  event_id: string
  brief: string
  generated_at: string
  cached: boolean
}
```

---

## Step 6 — NarrativePanel.tsx — AUTO BRIEF

Add to imports:
```ts
import type { Signal, Analysis, NextOpportunity, EventBrief } from '@/types'
```
(Add EventBrief to the existing type import — do not duplicate the import line)

Add typed state after existing forecastRows state:
```ts
const [brief, setBrief] = useState<string | null>(null)
const [briefLoading, setBriefLoading] = useState(false)
const [briefGeneratedAt, setBriefGeneratedAt] = useState<string | null>(null)
```

Add fetch effect after escape-key useEffect:
```ts
useEffect(() => {
  setBrief(null)
  setBriefGeneratedAt(null)
  setBriefLoading(true)

  fetch(`/api/events/${event.id}/brief`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`brief failed: ${r.status}`)
      return r.json() as Promise<EventBrief>
    })
    .then((data) => {
      setBrief(data.brief)
      setBriefGeneratedAt(data.generated_at)
    })
    .catch(() => {
      setBrief('BRIEF GENERATION FAILED — retry or check connection')
      setBriefGeneratedAt(null)
    })
    .finally(() => setBriefLoading(false))
}, [event.id])
```

Insert AUTO BRIEF section in JSX — AFTER Satellite Coverage closing fragment, BEFORE the divider that precedes AI Analysis.

The section must use this exact structure:

```tsx
{/* AUTO BRIEF */}
<div style={{ marginTop: '20px' }}>
  <div
    style={{
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: '11px',
      letterSpacing: '0.14em',
      color: 'var(--text-primary)',
      marginBottom: '10px',
    }}
  >
    AUTO BRIEF
  </div>

  <div
    style={{
      borderTop: '1px solid var(--border-subtle)',
      paddingTop: '12px',
    }}
  >
    {briefLoading && (
      <div
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '12px',
          color: 'var(--text-secondary)',
        }}
      >
        GENERATING BRIEF...
      </div>
    )}

    {brief && !briefLoading && (
      <>
        <div
          style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '12px',
            lineHeight: 1.7,
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {brief}
        </div>

        <div
          style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '10px',
            letterSpacing: '0.12em',
            color: 'var(--text-secondary)',
            marginTop: '10px',
          }}
        >
          AI SYNTHESIS · LINKED SOURCES ONLY
        </div>

        {briefGeneratedAt && (
          <div
            style={{
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: '10px',
              color: 'var(--text-secondary)',
              marginTop: '6px',
            }}
          >
            {'Generated ' + new Date(briefGeneratedAt).toLocaleTimeString()}
          </div>
        )}
      </>
    )}

    {!brief && !briefLoading && (
      <div
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '12px',
          color: 'var(--text-secondary)',
        }}
      >
        BRIEF UNAVAILABLE
      </div>
    )}
  </div>
</div>
```

Final section order:
1. Event header
2. Divider
3. Signals
4. Satellite Coverage (when satVisible)
5. AUTO BRIEF
6. Divider
7. AI Analysis
8. Divergence bar

---

## Language rules

NEVER:   "active imaging"
NEVER:   "confirmed imaging"
NEVER:   "scheduled imaging"
ALWAYS:  "possible coverage"
ALWAYS:  "imaging opportunity"
ALWAYS:  "estimated position"
ALWAYS:  "next opportunity"

---

## Anti-pattern guards

1. Never hardcode ANTHROPIC_API_KEY — use settings.anthropic_api_key
2. Never call /brief on every render — event.id dependency only
3. Never return 500 — deterministic fallback must always run
4. Never output bullet points in the brief — prose only
5. Never use forbidden imaging language
6. Never assume field names — confirmed in audit step
7. Model string must be exactly claude-sonnet-4-5
8. Never resolve contradictions — state them only
9. Never regenerate if cached and fresh (under 30 minutes)
10. brief_generated_at stored as DateTime(timezone=True) — no replace(tzinfo=utc) needed
11. Never create a new table or separate cache model — two columns on Event only

---

## Completion criteria

```bash
cd /Users/tylergilstrap/Desktop/PARALLAX/frontend
npm run build

curl localhost:8000/events/EVT-2026-000001/brief | jq '.brief'
# Must return non-null prose string under 90 words

curl localhost:8000/events/EVT-2026-000001/brief | jq '.cached'
# Second call must return true
```

Browser checks:
- NarrativePanel shows GENERATING BRIEF... briefly
- Brief renders as prose only, no bullet points, under 90 words
- AI SYNTHESIS · LINKED SOURCES ONLY appears below brief
- Generated HH:MM:SS appears below that
- Different events generate different briefs
- Same event returns cached brief faster on second open
- No forbidden imaging language
- Fallback renders if ANTHROPIC_API_KEY absent
- Contradictions stated, not resolved

Only output <promise>AUTOBRIEF_COMPLETE</promise> when every check passes.
