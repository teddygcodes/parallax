# PARALLAX Phase 3 — Satellite Intelligence Layer

## Always start here
Before writing any code, audit what already exists:
```bash
ls /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/
cat /Users/tylergilstrap/Desktop/PARALLAX/frontend/types/index.ts
cat /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/GlobeControls.tsx
cat /Users/tylergilstrap/Desktop/PARALLAX/frontend/app/page.tsx
cat /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/Globe.tsx
cat /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/NarrativePanel.tsx
```
List what's done, what's missing, then proceed.

## Install required packages
```bash
cd /Users/tylergilstrap/Desktop/PARALLAX/frontend
npm install satellite.js
npm install --save-dev @types/satellite.js
```
If `@types/satellite.js` is unavailable (npm install fails or the package does not exist), **immediately** create this minimal declaration — do not spend iterations debugging DefinitelyTyped:
```ts
// frontend/types/satellite.js.d.ts
declare module 'satellite.js';
```
Do not block on typings. Create the declaration and continue.

```bash
cd /Users/tylergilstrap/Desktop/PARALLAX/backend
pip install sgp4 requests
```

## What you're building

### 1. `frontend/types/index.ts` — extend

Add:
```ts
export type SatelliteType = 'SAR' | 'OPTICAL' | 'OPTICAL_CONSTELLATION'

export interface SatellitePosition {
  norad: number | null   // null for constellation entries (Planet Dove) — never rendered on globe
  name: string
  type: SatelliteType
  swath_km: number
  lat: number
  lng: number
  alt_km: number
  velocity_kms: string   // "~7.5 km/s"
  isStale: boolean       // orbital data >24h old
  possibleCoverage: boolean
  pulse: boolean         // Living Earth Mode overlap highlight
  positionHistory: Array<{ lat: number; lng: number; ts: number }>  // last 30 positions
}

export interface SatelliteCoverage {
  satellite_name: string
  pass_type: SatelliteType
  last_pass_ago_seconds: number | null   // null = no recent pass
}

export interface NextOpportunity {
  satellite_name: string
  pass_type: SatelliteType
  in_seconds: number
}
```

Extend `Analysis` interface:
```ts
export interface Analysis {
  // ...existing fields...
  satellite_coverage?: SatelliteCoverage[]
  next_opportunities?: NextOpportunity[]
}
```

### 2. `frontend/components/SatelliteLayer.tsx` — new file

```ts
'use client'
```

**Satellite list (hardcoded, exact):**
```ts
const IMAGING_SATELLITES = [
  { name: 'SENTINEL-1A',               norad: 39634, type: 'SAR'                  as const, swath_km: 250 },
  { name: 'SENTINEL-1B',               norad: 41456, type: 'SAR'                  as const, swath_km: 250 },
  { name: 'ICEYE-X7',                  norad: 47506, type: 'SAR'                  as const, swath_km: 100 },
  { name: 'ICEYE-X8',                  norad: 47507, type: 'SAR'                  as const, swath_km: 100 },
  { name: 'CAPELLA-3',                 norad: 47380, type: 'SAR'                  as const, swath_km: 100 },
  { name: 'CAPELLA-4',                 norad: 47381, type: 'SAR'                  as const, swath_km: 100 },
  { name: 'SENTINEL-2A',               norad: 40697, type: 'OPTICAL'              as const, swath_km: 290 },
  { name: 'SENTINEL-2B',               norad: 42063, type: 'OPTICAL'              as const, swath_km: 290 },
  { name: 'LANDSAT-8',                 norad: 39084, type: 'OPTICAL'              as const, swath_km: 185 },
  { name: 'LANDSAT-9',                 norad: 49260, type: 'OPTICAL'              as const, swath_km: 185 },
  // Planet Dove is intentionally omitted — no single NORAD ID.
  // It must NEVER appear in the onPositionsUpdate output array. Panel text only.
]
```

**Props:**
```ts
interface SatelliteLayerProps {
  events: ConflictEvent[]
  satVisible: boolean
  isLivingEarth: boolean
  onPositionsUpdate: (positions: SatellitePosition[]) => void
}
```

**CelesTrak fetch + cache:**
```ts
const CELESTRAK_URL = 'https://celestrak.org/GP/GP.php?GROUP=active&FORMAT=json'
const CACHE_DURATION_MS = 6 * 3600_000

// In-module cache (not localStorage — SSR incompatible)
let ommCache: { data: any[]; ts: number } | null = null

async function fetchOmmData(): Promise<any[]> {
  if (ommCache && Date.now() - ommCache.ts < CACHE_DURATION_MS) {
    return ommCache.data
  }
  const res = await fetch(CELESTRAK_URL)
  const all = await res.json()
  // Filter to NORAD IDs in IMAGING_SATELLITES
  const noradSet = new Set(IMAGING_SATELLITES.map(s => s.norad))
  const filtered = all.filter((r: any) => noradSet.has(Number(r.NORAD_CAT_ID)))
  ommCache = { data: filtered, ts: Date.now() }
  return filtered
}
```

**Position computation using satellite.js v6 OMM JSON API:**
```ts
import * as satellite from 'satellite.js'

function computePositions(
  ommRecords: any[],
  events: ConflictEvent[],
  isLivingEarth: boolean
): SatellitePosition[] {
  const now = new Date()
  const gmst = satellite.gstime(now)
  const results: SatellitePosition[] = []

  for (const omm of ommRecords) {
    const meta = IMAGING_SATELLITES.find(s => s.norad === Number(omm.NORAD_CAT_ID))
    if (!meta) continue

    let satrec: any
    try {
      satrec = satellite.json2satrec(omm)
    } catch {
      continue
    }

    const posVel = satellite.propagate(satrec, now)
    if (!posVel.position || typeof posVel.position === 'boolean') continue

    const geo = satellite.eciToGeodetic(posVel.position as any, gmst)
    const lat = satellite.degreesLat(geo.latitude)
    const lng = satellite.degreesLong(geo.longitude)
    const alt_km = geo.height
    const vel = posVel.velocity as any
    const velocity_kms = `~${Math.sqrt(vel.x**2 + vel.y**2 + vel.z**2).toFixed(1)} km/s`

    // Data staleness: omm.EPOCH is ISO string
    const epochMs = new Date(omm.EPOCH).getTime()
    const isStale = Date.now() - epochMs > 24 * 3600_000

    // POSSIBLE COVERAGE: haversine overlap with any active event
    const possibleCoverage = events.some(evt => {
      const dist = haversineKm(lat, lng, evt.lat, evt.lng)
      // 1.1 buffer: heuristic — reduces edge-case false negatives from orbital uncertainty and simplified footprint modeling
      if (dist >= meta.swath_km / 2 * 1.1) return false
      // OPTICAL: only flag during solar noon ± 6h at that longitude
      if (meta.type === 'OPTICAL') {
        const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60
        const solarHour = (utcHour + lng / 15 + 24) % 24
        if (Math.abs(solarHour - 12) > 6) return false
      }
      return true
    })

    // Living Earth Mode pulse: overlap = pulse for 3s
    const pulse = isLivingEarth && possibleCoverage

    results.push({ ...meta, lat, lng, alt_km, velocity_kms, isStale, possibleCoverage, pulse, positionHistory: [] as Array<{ lat: number; lng: number; ts: number }> })
  }

  // Sort by proximity to nearest active event, cap at 30
  if (events.length > 0) {
    results.sort((a, b) => {
      const nearA = Math.min(...events.map(e => haversineKm(a.lat, a.lng, e.lat, e.lng)))
      const nearB = Math.min(...events.map(e => haversineKm(b.lat, b.lng, e.lat, e.lng)))
      return nearA - nearB
    })
  }
  return results.slice(0, 30)
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}
```

**Visibility guard — explicit clearing:**
```ts
if (!satVisible) {
  onPositionsUpdate([])
  return   // skip all propagation work when layer is toggled off
}
```
This must be the first check in each interval tick. Prevents stale points lingering if `satVisible` toggles off while the interval is mid-cycle.

**useEffect wiring:**
- On mount and on each 10s tick: check `satVisible` first (see above), then `fetchOmmData()` → `computePositions()` → `onPositionsUpdate()`
- Interval: 10s (20s on mobile: `window.innerWidth < 768`)
- Page Visibility API: pause when `document.hidden`
- `positionHistory`: maintain last 30 positions per NORAD ID in a `useRef<Map<number, Array<{ lat: number; lng: number; ts: number }>>>`
- 6h cache refresh: re-fetch OMM data and reset satrecs
- On unmount: call `onPositionsUpdate([])` to clear any stale points from the globe, then clear all timers

**Returns null** — no visible UI. Positions propagate to page.tsx via `onPositionsUpdate` only.

### 3. `frontend/components/Globe.tsx` — extend

**New props:**
```ts
export interface GlobeProps {
  // ...existing props...
  satellitePositions?: SatellitePosition[]
  onSatelliteHover?: (sat: SatellitePosition | null, x: number, y: number) => void
  isLivingEarth?: boolean
}
```

**Discriminated union for unified pointsData:**
```ts
type EventPoint  = ConflictEvent  & { _kind: 'event' }
type SatellitePoint = SatellitePosition & { _kind: 'satellite' }
type GlobePoint  = EventPoint | SatellitePoint
```

**In `renderToGlobe()`:** Build `allPoints: GlobePoint[]`:
```ts
const eventPoints: EventPoint[]     = filtered.map(e => ({ ...e, _kind: 'event' as const }))
const satPoints: SatellitePoint[]   = (satellitePositions ?? []).map(s => ({ ...s, _kind: 'satellite' as const }))
const allPoints: GlobePoint[]       = [...satPoints, ...eventPoints]  // satellites first → events render on top

globe
  .pointsData(allPoints)
  .pointLat((d: GlobePoint) => d._kind === 'satellite' ? d.lat : (d as EventPoint).lat + getJitter(d.id).dlat)
  .pointLng((d: GlobePoint) => d._kind === 'satellite' ? d.lng : (d as EventPoint).lng + getJitter(d.id).dlng)
  .pointColor((d: GlobePoint) => {
    if (d._kind === 'satellite') {
      const opacity = d.isStale ? 0.45 : (d.type === 'SAR' ? 0.9 : 0.7)
      const base    = d.type === 'SAR' ? '100,181,246' : '143,207,143'
      return `rgba(${base},${opacity})`
    }
    // ...existing event color logic...
  })
  .pointAltitude((d: GlobePoint) => {
    if (d._kind === 'satellite') return (d.alt_km / 6371) * 0.35
    // ...existing event altitude logic...
  })
  .pointRadius((d: GlobePoint) => {
    if (d._kind === 'satellite') return 0.3   // always smaller than event markers
    // ...existing event radius logic...
  })
```

**onPointHover routing:**

Globe.tsx already tracks cursor position via `mousePosRef` (updated by `mousemove` listener on `window`). Maintain this pattern for satellite hover as well — do NOT add a second listener. Both `onSatelliteHover` and `onEventHover` use `mousePosRef.current` for stable screen coordinates.

```ts
globe.onPointHover((point: any) => {
  if (!point) {
    onEventHover?.(null, 0, 0)
    onSatelliteHover?.(null, 0, 0)
    return
  }
  if (point._kind === 'satellite') {
    onSatelliteHover?.(point as SatellitePosition, mousePosRef.current.x, mousePosRef.current.y)
  } else {
    onEventHover?.(point as ConflictEvent, mousePosRef.current.x, mousePosRef.current.y)
  }
})
```

**Orbit trails as arcsData:** Merge satellite trail arcs with missile arcs:
```ts
// Satellite trail arcs: each consecutive pair in positionHistory → one arc
const satTrailArcs = (satellitePositions ?? []).flatMap(sat =>
  sat.positionHistory.slice(1).map((pos, i) => ({
    startLat: sat.positionHistory[i].lat,
    startLng: sat.positionHistory[i].lng,
    endLat:   pos.lat,
    endLng:   pos.lng,
    _kind:    'trail' as const,
  }))
)
const missileArcs = missiles.map(e => ({
  startLat: e.lat - 1.5, startLng: e.lng - 1.5,
  endLat:   e.lat,       endLng:   e.lng,
  _kind:    'missile' as const,
}))

globe
  .arcsData([...missileArcs, ...satTrailArcs])
  .arcStartLat((d: any) => d.startLat)
  .arcStartLng((d: any) => d.startLng)
  .arcEndLat((d: any) => d.endLat)
  .arcEndLng((d: any) => d.endLng)
  .arcColor((d: any) => d._kind === 'trail' ? 'rgba(100,181,246,0.12)' : '#c0392b')
  .arcDashLength((d: any) => d._kind === 'trail' ? 1.0 : 0.5)
  .arcDashGap((d: any) => d._kind === 'trail' ? 0 : 0.2)
  .arcDashAnimateTime((d: any) => d._kind === 'trail' ? 0 : 4000)
  .arcStroke((d: any) => d._kind === 'trail' ? 0.4 : 0.9)
```

**Footprints as ringsData:** Add satellite footprints alongside event rings:
```ts
type FootprintRing = SatellitePosition & { _rtype: 'footprint' }
const footprintRings: FootprintRing[] = (satellitePositions ?? []).map(s => ({ ...s, _rtype: 'footprint' as const }))

// Merge into existing ringData:
const allRings = [...eventRingData, ...footprintRings]

globe
  .ringsData(allRings)
  // ...existing ring callbacks for event types...
  // Add satellite footprint branches:
  .ringLat((d: any) => d._rtype === 'footprint' ? d.lat : d.lat + getJitter(d.id).dlat)
  .ringLng((d: any) => d._rtype === 'footprint' ? d.lng : d.lng + getJitter(d.id).dlng)
  .ringColor((d: any) => {
    if (d._rtype === 'footprint') {
      const opacity = (d.pulse && isLivingEarth) ? 0.35 : (d.possibleCoverage ? 0.22 : 0.06)
      return () => `rgba(100,181,246,${opacity})`
    }
    // ...existing event ring color logic...
  })
  .ringMaxRadius((d: any) => {
    if (d._rtype === 'footprint') return (d.swath_km / 2 * 1.1) / 111   // degree radius for VISUAL RENDERING ONLY; 1.1 = heuristic buffer for orbital uncertainty
    // ...existing event ring radius logic...
  })
  .ringPropagationSpeed((d: any) => d._rtype === 'footprint' ? 0.001 : /* existing */ ...)
  .ringRepeatPeriod((d: any) => d._rtype === 'footprint' ? 9_999_999 : /* existing */ ...)
  .ringAltitude((d: any) => d._rtype === 'footprint' ? 0.001 : /* existing */ ...)
```

> **Why ringPropagationSpeed = 0.001 (not 0):** globe.gl rings are inherently animated; a speed of `0` halts the renderer loop. `0.001` produces a visually static footprint while keeping the renderer alive. Never set this to `0`. Symmetrically: never set event ring propagation speed to `9_999_999` — event rings animate with short repeat periods, footprints do not.

**Re-render when satellitePositions change:**
```ts
useEffect(() => {
  if (globeRef.current) renderToGlobe(globeRef.current, allEvents)
}, [satellitePositions, isLivingEarth])  // eslint-disable-line react-hooks/exhaustive-deps
```

### 4. `frontend/components/GlobeControls.tsx` — extend

**New props:**
```ts
interface GlobeControlsProps {
  // ...existing...
  satVisible: boolean
  onSatToggle: () => void
}
```

**SAT button** — add after LIVING EARTH button:
```tsx
<button
  onClick={onSatToggle}
  title="Show imaging satellite passes (estimated)"
  style={{
    ...baseButtonStyle,
    color: '#e8e6e0',
    letterSpacing: '0.14em',
    borderColor: satVisible ? 'rgba(100,181,246,0.4)' : 'rgba(255,255,255,0.06)',
  }}
>
  SAT
</button>
```

### 5. `frontend/components/NarrativePanel.tsx` — extend

Add SATELLITE COVERAGE section after the SIGNALS section and before the NARRATIVE DIVERGENCE bar. Order in panel: header → signals → satellite coverage → AI analysis → divergence bar.

**Client-side revisit forecast (lazy, 120s cadence):**
```ts
// Inside NarrativePanel component:
const [forecastRows, setForecastRows] = useState<NextOpportunity[] | null>(null)
const forecastCacheRef = useRef<Map<string, NextOpportunity[]>>(new Map())

useEffect(() => {
  if (!satVisible) return   // only compute when SAT layer is on

  async function computeForecast() {
    if (forecastCacheRef.current.has(event.id)) {
      setForecastRows(forecastCacheRef.current.get(event.id)!)
      return
    }
    // Lazy import satellite.js to avoid SSR issues
    const satellite = await import('satellite.js')
    // Fetch OMM data (share cache with SatelliteLayer via module-level cache)
    // ... project each satellite forward in 3-minute increments over 12h
    // ... record first overlap per satellite
    // Store in forecastCacheRef.current; setForecastRows(result)
  }

  computeForecast()
  const timer = setInterval(computeForecast, 120_000)
  return () => clearInterval(timer)
}, [event.id, satVisible])
```

**Forecast priority:** Use `analysis.next_opportunities` from the backend when the field is present and non-null — do not overwrite it with client-side rows. Compute the client-side fallback only when `analysis.next_opportunities` is null or missing. Never mix backend and client-computed rows in the same list.

**SATELLITE COVERAGE section UI:**
```
SATELLITE COVERAGE
──────────────────────────────
Sentinel-1A     possible pass  2h 14m ago   SAR
ICEYE-X7        possible pass  47m ago      SAR
Sentinel-2A     no recent pass              OPTICAL
Planet Dove     constellation pass likely   OPTICAL

NEXT OPPORTUNITIES
──────────────────────────────
ICEYE-X8        in ~23m        SAR
Sentinel-2A     in ~5h 11m     OPTICAL
```
- `#64b5f6` for timestamps and "possible pass"
- `#8a8a8a` for "no recent pass"
- "POSSIBLE COVERAGE" language only — never "ACTIVE IMAGING" or "CONFIRMED IMAGING"
- Planet Dove always shows as "constellation pass likely OPTICAL" — no individual dots

**NarrativePanel new props:**
```ts
interface NarrativePanelProps {
  event: ConflictEvent
  onClose: () => void
  satVisible?: boolean        // controls whether to show coverage section
}
```

### 6. `frontend/app/page.tsx` — extend

**New state:**
```ts
type HoveredSatelliteState = {
  sat: SatellitePosition
  x: number
  y: number
} | null

const [satVisible, setSatVisible]                 = useState<boolean>(false)
const [satellitePositions, setSatellitePositions] = useState<SatellitePosition[]>([])
const [hoveredSatellite, setHoveredSatellite]     = useState<HoveredSatelliteState>(null)
```

Page state stores `{ sat, x, y }` as a unit — coordinates are never stored on `SatellitePosition` directly; they always flow through `HoveredSatelliteState`.

**SatelliteLayer mount** (always mounted, like Globe):
```tsx
<SatelliteLayer
  events={currentEvents}
  satVisible={satVisible}
  isLivingEarth={isLivingEarth}
  onPositionsUpdate={setSatellitePositions}
/>
```

**Globe extended:**
```tsx
<GlobeComponent
  // ...existing props...
  satellitePositions={satVisible ? satellitePositions : []}
  onSatelliteHover={(sat, x, y) => setHoveredSatellite(sat ? { sat, x, y } : null)}
  isLivingEarth={isLivingEarth}
/>
```

**Satellite HoverCard** — owned by page.tsx, rendered alongside event HoverCard (mutually exclusive):

```tsx
{hoveredSatellite && !selectedEvent && !hoveredEvent && (
  <div style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none' }}>
    <SatelliteHoverCard
      satellite={hoveredSatellite.sat}
      x={hoveredSatellite.x}
      y={hoveredSatellite.y}
    />
  </div>
)}
```
`SatelliteHoverCard` is a new small component (same file as HoverCard.tsx, or its own file). Same glassmorphism style as event HoverCard. Position offset: +16px right, +16px down from cursor (same as event HoverCard):
```
SENTINEL-1A  ·  SAR
ESTIMATED POSITION
48.234°N  37.891°E
Alt: 693km  ·  ~7.5 km/s

Swath width:    250km
Coverage type:  DAY/NIGHT
```
If `isStale`: show `ORBITAL DATA STALE` + small `STALE` badge.

**GlobeControls extended:**
```tsx
<GlobeControls
  // ...existing...
  satVisible={satVisible}
  onSatToggle={() => setSatVisible(prev => !prev)}
/>
```

**NarrativePanel extended:**
```tsx
<NarrativePanel
  key={selectedEvent.id}
  event={selectedEvent}
  onClose={handlePanelClose}
  satVisible={satVisible}
/>
```

**Page footer** — add inside the root div, below all other content:
```tsx
{!isLivingEarth && (
  <div style={{
    position: 'absolute',
    bottom: '8px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontFamily: 'IBM Plex Mono, monospace',
    fontSize: '0.7rem',
    color: '#8a8a8a',
    letterSpacing: '0.08em',
    pointerEvents: 'none',
    zIndex: 10,
    whiteSpace: 'nowrap',
  }}>
    Orbital positions approximate · Not official intelligence
  </div>
)}
```

### 7. `backend/workers/satellite_worker.py` — new file

**Note on dual data sources:** Frontend uses CelesTrak GP OMM JSON (`FORMAT=json`) for browser-side visualization via satellite.js. Backend worker uses CelesTrak GP TLE (`FORMAT=TLE`) for server-side sgp4 propagation. Separate endpoints, separate implementations — this is by design, not a bug. Do not attempt to share a single fetch between the two.

```python
"""
Satellite coverage worker — runs every 10 minutes.
For each active event, computes which imaging satellites passed within swath
range in the last 6 hours, and forecasts next opportunities over 12 hours.
Stores results as JSONB on the event record.
"""
import math
import requests
from datetime import datetime, timedelta, timezone
from sgp4.api import Satrec, WGS72
from sgp4.conveniences import jday

CELESTRAK_URL = 'https://celestrak.org/GP/GP.php?GROUP=active&FORMAT=tle'

IMAGING_SATELLITES = [
    { 'name': 'SENTINEL-1A',  'norad': 39634, 'type': 'SAR',     'swath_km': 250 },
    { 'name': 'SENTINEL-1B',  'norad': 41456, 'type': 'SAR',     'swath_km': 250 },
    { 'name': 'ICEYE-X7',     'norad': 47506, 'type': 'SAR',     'swath_km': 100 },
    { 'name': 'ICEYE-X8',     'norad': 47507, 'type': 'SAR',     'swath_km': 100 },
    { 'name': 'CAPELLA-3',    'norad': 47380, 'type': 'SAR',     'swath_km': 100 },
    { 'name': 'CAPELLA-4',    'norad': 47381, 'type': 'SAR',     'swath_km': 100 },
    { 'name': 'SENTINEL-2A',  'norad': 40697, 'type': 'OPTICAL', 'swath_km': 290 },
    { 'name': 'SENTINEL-2B',  'norad': 42063, 'type': 'OPTICAL', 'swath_km': 290 },
    { 'name': 'LANDSAT-8',    'norad': 39084, 'type': 'OPTICAL', 'swath_km': 185 },
    { 'name': 'LANDSAT-9',    'norad': 49260, 'type': 'OPTICAL', 'swath_km': 185 },
]

def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

```

The worker must:
- Parse TLE with `Satrec.twoline2rv(line1, line2)`
- Propagate with `satrec.sgp4(jd, fr)` using `jday()` for time conversion
- Convert ECI → geodetic using a proper GMST rotation matrix — do NOT use a simplified spherical or r-vector approximation; use the sgp4 library's own geodetic conversion utilities
- For each event, scan 6h backward in 3-minute steps for past passes; scan 12h forward in 3-minute steps for next opportunities
- Record first future overlap per satellite as `next_opportunities`

**DB model addition** (`backend/models/event.py`):
```python
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
satellite_coverage  = Column(JSONB, nullable=True)
next_opportunities  = Column(JSONB, nullable=True)
```
Create a new Alembic migration: `alembic revision --autogenerate -m "add satellite fields"` and apply it. Use `JSONB` (not `JSON`) consistently in the model, migration file, and any prose — never mix.

**Celery task registration** in `backend/main.py` or celery config:
```python
@celery.task
def run_satellite_worker():
    satellite_worker.compute_satellite_coverage()

# Beat schedule: every 10 minutes
```

**`GET /events/{id}/analysis` response** — extend to include `satellite_coverage` and `next_opportunities` from the event record when present (return null when not yet computed).

## Anti-pattern guards

1. **Never** `customLayerData` for satellite dots — `pointsData` only (merged with event points)
2. **Never** individual Planet Dove dots on globe — panel text only
3. **Never** `localStorage` for satellite cache — module-level variable only
4. **Never** satellite dots brighter/larger than conflict event markers (pointRadius ≤ 0.3)
5. **Never** "ACTIVE IMAGING", "CONFIRMED IMAGING", "SCHEDULED IMAGING" anywhere in code or UI
6. Satellite z-index semantically below event markers (achieved via pointsData render order: satellites first in array so events paint on top)
7. Degree radius for footprint VISUAL RENDERING ONLY — haversine for all overlap math
8. Forecast computation lazy and cached — never computed on every 10s tick
9. `npm run build` must exit 0 before outputting SATELLITE_COMPLETE

## Completion criteria

Run ALL of the following. Only output `<promise>SATELLITE_COMPLETE</promise>` when every check passes.

```bash
cd /Users/tylergilstrap/Desktop/PARALLAX/frontend
npm run build                         # must exit 0, zero TS errors

# Backend: apply migration and run worker
cd /Users/tylergilstrap/Desktop/PARALLAX/backend
alembic upgrade head
python -c "from workers import satellite_worker; satellite_worker.compute_satellite_coverage()"
# Then verify data was written:
curl localhost:8000/events/EVT-2026-000001/analysis | jq '.satellite_coverage'
# Must return non-null after worker runs

# Manual browser checks (with frontend running at localhost:3000):
# - Controls bar: SAT button visible, off by default, tooltip "Show imaging satellite passes (estimated)"
# - Toggle SAT on → satellite dots appear at correct orbital altitudes (dots noticeably ABOVE globe surface)
# - SAR dots slightly brighter blue than OPTICAL green dots
# - Dots shift position visibly between 10s update cycles
# - Faint trail arc visible behind each satellite
# - Hover satellite → HoverCard: name, type, ESTIMATED POSITION, alt, velocity
# - Stale orbital data → ORBITAL DATA STALE + STALE badge instead of coordinates
# - Footprint ring visible around satellite at correct scale
# - Footprint brightens to opacity 0.22 when satellite overlaps active event
# - Click event → NarrativePanel → SATELLITE COVERAGE section present
# - NarrativePanel → NEXT OPPORTUNITIES section with time estimates
# - Planet Dove appears in SATELLITE COVERAGE panel, never as globe dot
# - Living Earth Mode → SAT toggle state preserved, footprint pulses 0.35 on overlap
# - SAT toggle off → all satellite elements (dots, trails, footprints) disappear cleanly
# - Footer disclaimer visible: "Orbital positions approximate · Not official intelligence"
# - Zero occurrences of "ACTIVE IMAGING" anywhere in rendered UI
```
