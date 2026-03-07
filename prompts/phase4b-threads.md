# PARALLAX Phase 4B — Source Threads

## Always start here

```bash
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/models/event.py
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/models/signal.py
cat /Users/tylergilstrap/Desktop/PARALLAX/backend/routers/events.py
cat /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/NarrativePanel.tsx
cat /Users/tylergilstrap/Desktop/PARALLAX/frontend/types/index.ts
```

List the exact field names on the Signal model before writing any code.
Confirm whether `article_url` exists.
Do not assume fields. Read the files first.

**ROUTER PATH CORRECTION — read this before writing any route:**
Check `backend/main.py` to confirm how the events router is mounted.
In this project the router has NO prefix — routes use full paths like `@router.get("/events/{event_id}/brief")`.
The correct path for the new endpoint is `@router.get("/events/{event_id}/threads")`.
Do NOT write `@router.get("/{event_id}/threads")`.

**CONFIG IMPORT CORRECTION:**
The config file is at `backend/config.py` directly — there is NO `backend/core/` directory.
The `/threads` endpoint does NOT use `settings` — do not add a settings import for this endpoint.
If `settings` is already imported at the top of `events.py` from a prior endpoint, leave it; do not add it if absent.

**NARRATIVEPANEL REPLACEMENT NOTE:**
NarrativePanel.tsx already contains a SOURCE THREADS section (an IIFE that groups signals inline from existing state).
This loop must REPLACE that existing section with a fetch-driven version using the new endpoint.
Do not add a second SOURCE THREADS section. Find and remove the IIFE block first, then insert the new one.

---

## What you're building

Add one backend endpoint:

```
GET /events/{event_id}/threads
```

Add one new UI section:

```
SOURCE THREADS
```

inside NarrativePanel — replacing the existing frontend-only implementation.

The feature derives entirely from existing signals.

**Constraints:**
- No new data sources
- No new database tables
- No schema changes
- No embedded media players
- No thumbnails
- Links only

---

## Backend

### 1. Content type classifier

Add to `backend/routers/events.py`.

```python
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
```

### 2. Item sorting priority

Add to the same file.

```python
TYPE_PRIORITY = ["thread", "video", "image", "statement", "article", "unknown"]

def sort_key(item):
    t = item.get("type", "unknown")
    return TYPE_PRIORITY.index(t) if t in TYPE_PRIORITY else len(TYPE_PRIORITY)
```

### 3. Endpoint — GET /events/{event_id}/threads

Add to `backend/routers/events.py`.

**IMPORTANT: The correct decorator is `@router.get("/events/{event_id}/threads")` — full path, not `/{event_id}/threads`.**

```python
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

    # Order sources by category priority
    category_order = ["WESTERN", "OSINT", "MIDDLE_EAST", "LOCAL", "RUSSIAN"]

    # Secondary sort by source name keeps order stable within a category
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
```

---

## Frontend

### 4. Extend `frontend/types/index.ts`

Add after the existing `EventBrief` interface (do not duplicate any existing types):

```ts
export type ThreadItemType =
  | 'article'
  | 'video'
  | 'thread'
  | 'statement'
  | 'image'
  | 'unknown'

export interface ThreadItem {
  type: ThreadItemType
  label: string
  url: string | null
}

export interface SourceThread {
  source: string
  source_category: string
  items: ThreadItem[]
}

export interface EventThreads {
  event_id: string
  source_threads: SourceThread[]
}
```

### 5. NarrativePanel.tsx — replace existing SOURCE THREADS

**Step A — Add imports** (to existing import line at top):
```ts
import type { ..., EventThreads, SourceThread } from '@/types'
```
(`ThreadItem` is not needed directly in the component — omit it from the import)

**Step B — Add state** (near other state declarations):
```ts
const [threads, setThreads]           = useState<SourceThread[]>([])
const [threadsLoading, setThreadsLoading] = useState(false)
```

**Step C — Add fetch effect** (after existing useEffects):
```ts
useEffect(() => {
  setThreads([])
  setThreadsLoading(true)

  fetch(`/api/events/${event.id}/threads`)
    .then(async r => {
      if (!r.ok) throw new Error(`threads failed: ${r.status}`)
      return r.json() as Promise<EventThreads>
    })
    .then(data => setThreads(data.source_threads))
    .catch(() => setThreads([]))
    .finally(() => setThreadsLoading(false))
}, [event.id])
```

**Step D — REMOVE the existing IIFE SOURCE THREADS block from the JSX entirely.**
Find and delete the complete block, which starts with `{/* SOURCE THREADS */}` and ends with `})()}`.
It begins with the comment and the IIFE pattern `signals !== null && signals.length > 0 && (() => {`.
Delete everything from that comment through the closing `})()}` — leave nothing behind.
Do not leave any fallback inline grouping logic in the file.

**Step E — Insert the new SOURCE THREADS section** in the same position (after Signals, before Satellite Coverage).

Note: `MONO` (`{ fontFamily: 'IBM Plex Mono, monospace' }`) is already defined in NarrativePanel.tsx — reuse it, do not redefine it.

```tsx
{/* SOURCE THREADS */}
<>
  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '20px 0' }} />
  <div style={{ marginBottom: '24px' }}>
    <div style={{ ...MONO, fontSize: '9px', letterSpacing: '0.18em', color: '#8a8a8a', marginBottom: '12px' }}>
      SOURCE THREADS
    </div>

    {threadsLoading && (
      <div style={{ ...MONO, fontSize: '10px', color: '#8a8a8a', letterSpacing: '0.1em' }}>
        LOADING...
      </div>
    )}

    {!threadsLoading && threads.length === 0 && (
      <div style={{ ...MONO, fontSize: '10px', color: '#8a8a8a', letterSpacing: '0.1em' }}>
        No structured evidence threads available from signals
      </div>
    )}

    {/* v2: add inline embeds, thumbnails, geolocation tags, collapsible groups per source */}
    {!threadsLoading && threads.map((thread) => (
      <div key={`${thread.source}-${thread.source_category}`} style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '6px' }}>
          <span style={{ ...MONO, fontSize: '10px', color: '#e8e6e0', letterSpacing: '0.08em' }}>
            {thread.source.toUpperCase()}
          </span>
          <span style={{
            fontSize: '9px',
            color: 'var(--text-secondary, #8a8a8a)',
            background: 'rgba(255,255,255,0.06)',
            padding: '1px 4px',
            borderRadius: '2px',
            marginLeft: '6px',
            fontFamily: 'IBM Plex Mono, monospace',
          }}>
            {thread.source_category}
          </span>
        </div>

        {thread.items.map((item, idx) => (
          <div key={`${thread.source}-${item.type}-${idx}`}>
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  ...MONO,
                  fontSize: '10px',
                  color: '#e8e6e0',
                  textDecoration: 'none',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'flex-start',
                  marginBottom: '4px',
                  paddingLeft: '8px',
                  borderLeft: '1px solid rgba(255,255,255,0.06)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = 'var(--text-data, #64b5f6)'
                  e.currentTarget.style.textDecoration = 'underline'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--text-primary, #e8e6e0)'
                  e.currentTarget.style.textDecoration = 'none'
                }}
              >
                <span style={{ color: '#64b5f6', flexShrink: 0 }}>[{item.type.toUpperCase()}]</span>
                <span>{item.label} →</span>
              </a>
            ) : (
              <div
                style={{
                  ...MONO,
                  fontSize: '10px',
                  color: '#8a8a8a',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'flex-start',
                  marginBottom: '4px',
                  paddingLeft: '8px',
                  borderLeft: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span style={{ color: '#64b5f6', flexShrink: 0 }}>[{item.type.toUpperCase()}]</span>
                <span>{item.label}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    ))}
  </div>
</>
```

---

## Final Panel Order

```
Event header → Signals → SOURCE THREADS → Satellite Coverage → Auto Brief → AI Analysis → Divergence bar
```

---

## Language Rules

```
NEVER:   active imaging
NEVER:   confirmed imaging
NEVER:   scheduled imaging

ALWAYS:  possible coverage
ALWAYS:  imaging opportunity
ALWAYS:  estimated position
ALWAYS:  next opportunity
```

---

## Anti-Pattern Guards

1. Never group by source_category — always group by source name
2. Never fake URLs — only real article_url values become links
3. Never render clickable links without a real URL
4. Never add new DB tables
5. Never call /threads on every render — event.id dependency only
6. Never embed media players
7. Never show thumbnails
8. Always deduplicate (source, label)
9. Always sort items by evidence priority
10. Router path is `/events/{event_id}/threads` — full path, no strip prefix

---

## Completion Criteria

```bash
cd /Users/tylergilstrap/Desktop/PARALLAX/frontend
npm run build
# Must exit 0, zero TypeScript errors

curl localhost:8000/events/EVT-2026-000001/threads | jq '.source_threads'
# Must return array of source groups with items
```

**Browser checks:**
- SOURCE THREADS section visible in panel
- Grouped by source name (Reuters, Bellingcat) — NOT by category
- Category badge beside each source name
- Items sorted: thread → video → image → statement → article → unknown
- Real URLs become `<a>` links opening in new tab; null URLs render as plain text
- No duplicates
- No embedded media
- Labels truncated at 80 chars
- Switching events loads new threads

Only output:

```
<promise>THREADS_COMPLETE</promise>
```

when all checks pass.
