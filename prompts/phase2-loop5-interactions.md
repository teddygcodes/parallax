# PARALLAX Phase 2 — Loop 5: Interactions

You are building PARALLAX. Loop 4 (Globe Foundation) is complete: Next.js 14 frontend, globe.gl rendering events, proxy to backend.
Full spec: `/Users/tylergilstrap/Desktop/PARALLAX/PARALLAXprompt.md`. Read it.

## ALWAYS START HERE — CHECK WHAT EXISTS

```bash
ls -la /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/
cd /Users/tylergilstrap/Desktop/PARALLAX/frontend && npm run build 2>&1 | tail -5
curl -s localhost:3000/api/events | python3 -m json.tool | head -10
```

Working directory: `/Users/tylergilstrap/Desktop/PARALLAX/frontend`

If Loop 4 is not complete (build fails, or globe is not rendering), stop and fix that first.
Only build what is missing. Do not overwrite working code.

---

## WHAT YOU ARE BUILDING

Four interaction components layered on top of the existing globe:

1. **HoverCard** — telemetry overlay on event hover
2. **TensionLayer** — deck.gl heatmap (non-blocking; skip to v2 if stuck after 2 iterations)
3. **GlobeControls** — time rewind slider + type toggles + Living Earth Mode button
4. **NarrativePanel** — right-side analysis panel (slide in on event click)

---

## COMPONENT SPECS

### 1. frontend/components/HoverCard.tsx

Appears when user hovers over a globe event point.

**Format** (IBM Plex Mono throughout):
```
STRIKE  ·  CONFIRMED
31.343°N  34.305°E
18:03 UTC  ·  Mar 4 2026
Source: ACLED + Bellingcat

Signals received:    37
Unique sources:      12
```

**Confidence display mapping** — never show raw backend enum values:
- `VERIFIED`   → `CONFIRMED`
- `LIKELY`     → `LIKELY`
- `REPORTED`   → `REPORTED`
- `UNCONFIRMED`→ `UNCONFIRMED`
- `DISPUTED`   → `DISPUTED`

**Positioning** — use `{ x, y }` from globe.gl hover callbacks with viewport edge clamping:
```ts
const left = Math.max(10, Math.min(x - cardWidth / 2, window.innerWidth - cardWidth - 10))
const top  = Math.max(10, Math.min(y - cardHeight / 2, window.innerHeight - cardHeight - 10))
```
Measure `cardWidth`/`cardHeight` from the DOM ref after first render, or use a fixed estimate (e.g. 240 × 120).

**Animation**: 300ms opacity fade in/out (CSS `transition: opacity 300ms ease`).

**Styling** (CSS custom properties, no Tailwind color classes):
```
background: rgba(10, 10, 14, 0.92)
border: 1px solid rgba(255,255,255,0.06)
font-family: IBM Plex Mono, monospace
font-size: 11px
letter-spacing: 0.08em
color: #e8e6e0 (primary text)
color: #8a8a8a (secondary labels)
color: #64b5f6 (data values — lat/lng, counts)
```

**Wire into Globe.tsx**: pass `onEventHover` prop to `<GlobeComponent>` in page.tsx; HoverCard reads the forwarded event + cursor position.

### 2. frontend/components/TensionLayer.tsx — deck.gl HeatmapLayer

**NON-BLOCKING RULE**: If deck.gl HeatmapLayer integration doesn't resolve cleanly within 2 implementation iterations, skip it entirely and replace TensionLayer with a simple no-op stub:
```tsx
export default function TensionLayer() { return null }
```
Do NOT let this block HoverCard, GlobeControls, NarrativePanel, or passing `npm run build`.

If deck.gl works, spec:
- `HeatmapLayer` from `@deck.gl/aggregation-layers`
- Input: `ConflictEvent[]` with lat/lng
- Intensity proportional to event density per cell
- Color scale: invisible at low density → `#c0392b` at 30% opacity at high density
- Updates when the event list refreshes

### 3. frontend/components/GlobeControls.tsx

Minimal bottom bar. IBM Plex Mono throughout. No heavy chrome.

**Time Rewind slider**:
- 4 presets: `12H` / `24H` / `72H` / `1W`
- Active preset highlighted in `--text-primary`, inactive in `--text-secondary`
- Clicking a preset sets `timeWindowHours` state (passed up to Globe via props)
- Default: no filter (show all events)

**Event type toggles**:
- 5 buttons: `STRIKE` / `MISSILE` / `DRONE` / `NAVAL` / `TROOP`
- Active = `--text-primary`, inactive = `--text-secondary`
- Toggle state passed to Globe as `visibleTypes: Set<EventType>`
- Default: all types on
- IMPORTANT: if all 5 are toggled off (empty Set), globe renders nothing — do NOT treat empty as "show all"

**Living Earth Mode toggle**:
- Single button `LIVING EARTH` — toggles ambient mode (wired in Loop 6)

**Layout**: `position: fixed`, `bottom: 24px`, `left: 50%`, `transform: translateX(-50%)`, centered. Semi-transparent background `rgba(10,10,14,0.7)`.

### 4. frontend/components/NarrativePanel.tsx

Right-side panel. Slides in from right on event click. Globe dims behind it.

**Globe dimming**: Apply `filter: brightness(0.6)` via Framer Motion `animate` prop on the globe container div in `page.tsx`. NOT an overlay div. HoverCard must live in a z-index layer ABOVE the dimmed globe so it remains visible while the panel is open.

**Event pinning**: when the panel is open, the selected event is stored in local React state in `page.tsx`. The 30s auto-refresh must NOT clear or replace it. Only explicit panel close (X button or Escape key) clears the selection.

**Panel animation**: Framer Motion `AnimatePresence` + `motion.div`:
```tsx
initial={{ x: 400, opacity: 0 }}
animate={{ x: 0, opacity: 1 }}
exit={{ x: 400, opacity: 0 }}
transition={{ duration: 0.4, ease: 'easeOut' }}
```

**Panel width**: `400px`, full viewport height, `position: fixed`, `right: 0`, `top: 0`.

**Panel styling**:
```
background: rgba(10, 10, 14, 0.96)
border-left: 1px solid rgba(255,255,255,0.06)
overflow-y: auto
padding: 32px 24px
```

**Panel content** (from top to bottom):

1. **Event header** (IBM Plex Mono):
   ```
   STRIKE  ·  CONFIRMED
   31.343°N  34.305°E
   18:03 UTC  ·  Mar 4 2026
   ```

2. **Signals grouped by source category** — fetch from `GET /events/{id}/signals`:
   - Group headers: `WESTERN` / `RUSSIAN` / `MIDDLE_EAST` / `OSINT` / `LOCAL`
   - Each signal: source name + description (truncated to 2 lines)
   - If no signals yet, show `NO SIGNALS RECEIVED` in `--text-secondary`

3. **AI Analysis** — fetch from `GET /events/{id}/analysis`:
   - Section headers in `Bebas Neue` or `IBM Plex Mono` uppercase
   - Four sections rendered in order:
     - `WHAT IS CONFIRMED` → `what_is_confirmed`
     - `WHAT IS DISPUTED` → `what_is_disputed`
     - `WHERE INFORMATION GOES DARK` → `where_information_goes_dark`
     - `CORE DISAGREEMENT` → `core_disagreement`
   - Body text in `Instrument Serif` (12–14px), color `--text-primary`
   - If analysis not yet available, show `ANALYSIS PENDING...`

4. **Divergence bar**:
   ```
   Consensus ●━━━━━━━━━━━━━━━━● Contested
             [████████████░░░░░░]  62%
   ```
   - Color: `--divergence-low` (#27ae60) at 0–0.33, `--divergence-mid` (#f39c12) at 0.34–0.66, `--divergence-high` (#c0392b) at 0.67–1.0
   - Label below: `LOW` / `MODERATE` / `HIGH` / `EXTREME`

5. **Close button**: top-right of panel, `×` in IBM Plex Mono. On click: clears selected event, globe returns to full brightness.

---

## WIRING IN page.tsx

Update `page.tsx` to pass state down and receive events up:

```tsx
const [selectedEvent, setSelectedEvent] = useState<ConflictEvent | null>(null)
const [hoveredEvent, setHoveredEvent] = useState<{ event: ConflictEvent; x: number; y: number } | null>(null)
const [timeWindowHours, setTimeWindowHours] = useState<number | undefined>(undefined)
const [visibleTypes, setVisibleTypes] = useState<Set<ConflictEvent['event_type']>>(
  new Set(['STRIKE', 'MISSILE', 'DRONE', 'NAVAL', 'TROOP'])
)

// Globe dims when panel is open
const globeDim = selectedEvent !== null

// GlobeComponent receives filter props + callbacks
<motion.div
  animate={{ filter: globeDim ? 'brightness(0.6)' : 'brightness(1)' }}
  transition={{ duration: 0.4 }}
  style={{ position: 'absolute', inset: 0, zIndex: 1 }}
>
  <GlobeComponent
    onEventClick={(e) => setSelectedEvent(e)}
    onEventHover={(e, x, y) => setHoveredEvent(e ? { event: e, x, y } : null)}
    timeWindowHours={timeWindowHours}
    visibleTypes={visibleTypes}
  />
</motion.div>

{/* HoverCard on its own z-index layer — above the dim */}
{hoveredEvent && (
  <div style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none' }}>
    <HoverCard event={hoveredEvent.event} x={hoveredEvent.x} y={hoveredEvent.y} />
  </div>
)}

{/* NarrativePanel */}
<AnimatePresence>
  {selectedEvent && (
    <NarrativePanel
      event={selectedEvent}
      onClose={() => setSelectedEvent(null)}
    />
  )}
</AnimatePresence>

{/* GlobeControls */}
<GlobeControls
  timeWindowHours={timeWindowHours}
  onTimeWindowChange={setTimeWindowHours}
  visibleTypes={visibleTypes}
  onVisibleTypesChange={setVisibleTypes}
  onLivingEarthToggle={() => { /* wired in Loop 6 */ }}
/>
```

---

## ANTI-PATTERN GUARDS

1. **HoverCard z-index above globe dim** — `zIndex: 50` minimum on HoverCard wrapper; globe container at `zIndex: 1`
2. **Globe dim via Framer Motion filter, not overlay div** — `animate={{ filter: 'brightness(0.6)' }}` on globe wrapper
3. **Event pinning** — `selectedEvent` state in page.tsx, never cleared by auto-refresh, only by panel close
4. **Empty visibleTypes Set = nothing rendered** — this must flow correctly through Globe.tsx's `applyFilters`
5. **TensionLayer non-blocking** — stub it out rather than block build or other features
6. **All animation ≥ 300ms** — nothing faster than 300ms
7. **No raw Three.js, no pure white/black, no system fonts** — same rules as Loop 4

---

## COMPLETION CRITERIA

```bash
cd /Users/tylergilstrap/Desktop/PARALLAX/frontend
npm run build
# Must still exit 0 — no regressions from Loop 4
```

Manual browser checks (localhost:3000):
- Hover over an event → HoverCard appears in IBM Plex Mono with confidence label (CONFIRMED not VERIFIED)
- HoverCard never clips viewport edges
- HoverCard stays visible when NarrativePanel is open (it's above the dim)
- Time Rewind: click `12H` → only events from last 12 hours visible; click again to cycle
- Type toggles: NAVAL off → amber dots disappear; all off → globe shows nothing
- Click event → NarrativePanel slides in from right (400ms), globe dims to 60%
- Panel shows: event header, signals grouped by category, analysis sections, divergence bar
- Divergence bar correct color (green/amber/crimson based on score)
- Close button → panel exits, globe returns to full brightness
- 30s auto-refresh does NOT close the open panel or clear selected event

Only output this when `npm run build` exits 0 AND manual browser checks pass:

<promise>INTERACTIONS_COMPLETE</promise>
