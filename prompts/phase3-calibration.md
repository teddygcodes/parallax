# PARALLAX Phase 3.1 — Satellite Visual Calibration

## Always start here

Audit current values before touching anything:
```bash
grep -n "0\.35\|0\.3\|0\.12\|0\.06\|0\.22\|1\.1\|slice(-30)" \
  /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/Globe.tsx \
  /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/SatelliteLayer.tsx

grep -n "lastForecastTime\|forceUpdate\|just now\|m ago" \
  /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/NarrativePanel.tsx

grep -n "autoRotateSpeed" \
  /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/LivingEarthMode.tsx

grep -n "isLivingEarth" \
  /Users/tylergilstrap/Desktop/PARALLAX/frontend/app/page.tsx | grep -i "orbital\|footer\|approximate"
```

List what's already correct and what still needs changing before writing any code.

---

## Changes (apply in order)

### 1 · Globe.tsx — pointAltitude multiplier

```ts
// FROM:
if (d._kind === 'satellite') return (d.alt_km / 6371) * 0.35
// TO:
if (d._kind === 'satellite') return (d.alt_km / 6371) * 0.55
```

### 2 · Globe.tsx — pointRadius satellite

```ts
// FROM:
if (d._kind === 'satellite') return 0.3
// TO:
if (d._kind === 'satellite') return 0.2
```

Applies to both SAR and OPTICAL — they share a single satellite radius branch.

### 3 · Globe.tsx — pointColor (SAR opacity up, OPTICAL opacity down)

```ts
// FROM:
const opacity = d.isStale ? 0.45 : (d.type === 'SAR' ? 0.9 : 0.7)
// TO:
const opacity = d.isStale ? 0.45 : (d.type === 'SAR' ? 0.95 : 0.6)
```

### 4 · Globe.tsx — arcColor trail opacity

```ts
// FROM:
d._kind === 'trail' ? 'rgba(100,181,246,0.12)' : '#c0392b'
// TO:
d._kind === 'trail' ? 'rgba(100,181,246,0.09)' : '#c0392b'
```

### 5 · Globe.tsx — footprint ringColor opacities + ringMaxRadius buffer

ringColor callback — change normal and overlap opacities only; leave pulse at 0.35:
```ts
// FROM:
const opacity = (d.pulse && isLivingEarth) ? 0.35 : (d.possibleCoverage ? 0.22 : 0.06)
// TO:
const opacity = (d.pulse && isLivingEarth) ? 0.35 : (d.possibleCoverage ? 0.18 : 0.04)
```

ringMaxRadius buffer:
```ts
// FROM:
return (d.swath_km / 2 * 1.1) / 111
// TO:
return (d.swath_km / 2 * 1.05) / 111
```

### 6 · SatelliteLayer.tsx — positionHistory cap

```ts
// FROM:
historyMap.get(norad)!.slice(-30)
// TO:
historyMap.get(norad)!.slice(-20)
```

### 7 · NarrativePanel.tsx — lastForecastTime tracking + "Last updated" display

**Add ref:**
```ts
const lastForecastTimeRef = useRef<number>(0)
```

**Set on BOTH paths in computeForecast** — cache-hit AND fresh compute:
```ts
// Cache-hit path:
if (forecastCacheRef.current.has(event.id)) {
  setForecastRows(forecastCacheRef.current.get(event.id)!)
  lastForecastTimeRef.current = Date.now()   // required here too
  return
}
// ... fresh compute ...
forecastCacheRef.current.set(event.id, result)
setForecastRows(result)
lastForecastTimeRef.current = Date.now()
```

**Add a 60s display-refresh timer** (separate from the 120s forecast timer):
```ts
const [, forceUpdate] = useState(0)

// Inside the same useEffect block that owns the 120s forecast timer:
const displayTimer = setInterval(() => forceUpdate(n => n + 1), 60_000)

// Cleanup — clear BOTH timers on return:
return () => {
  clearInterval(forecastTimer)
  clearInterval(displayTimer)
}
```

IMPORTANT: Both timers must be scoped to the same useEffect and cleaned up whenever `event.id` or `satVisible` changes (i.e., whenever the effect re-runs). Do not let either timer leak across event changes or panel close.

**Helper function (module-level or inside component):**
```ts
function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  return `${Math.floor(s / 60)}m ago`
}
```

**Render below NEXT OPPORTUNITIES section.**
The wrapper element is a div with inline style — do not omit the wrapper:

```tsx
{lastForecastTimeRef.current > 0 && (
  <div
    style={{
      color: 'var(--text-secondary)',
      fontSize: '0.7rem',
      marginTop: '4px',
      fontFamily: 'IBM Plex Mono, monospace',
    }}
  >
    {'Last updated: ' + fmtAgo(Date.now() - lastForecastTimeRef.current)}
  </div>
)}
```

Only render when `lastForecastTimeRef.current > 0` (never before first compute completes).

### 8 · Confirmations (verify only — do NOT modify if already correct)

```bash
# Footer guard — must be wrapped in {!isLivingEarth && (...)}
grep -n "isLivingEarth" /Users/tylergilstrap/Desktop/PARALLAX/frontend/app/page.tsx | grep -i "orbital\|approximate"

# autoRotateSpeed — must equal 0.1
grep -n "autoRotateSpeed" /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/LivingEarthMode.tsx
```

If either is wrong, fix it. If correct, leave it untouched and note it as confirmed.

---

## Completion criteria

```bash
cd /Users/tylergilstrap/Desktop/PARALLAX/frontend
npm run build   # must exit 0, zero TypeScript errors
```

Visual spot-checks:
- Satellite dots are noticeably higher above globe surface vs before
- Dots are smaller (less dominant than event markers)
- SAR dots slightly crisper; OPTICAL slightly more muted
- Trail arcs subtler
- Footprint rings barely visible at rest; modestly visible on overlap
- NarrativePanel SAT section shows "Last updated: just now" after first compute, then "1m ago", "2m ago" etc.
- Living Earth Mode: footer text hidden, footprint pulse still 0.35 opacity (unchanged from prior behavior — this prompt does not modify pulse logic)
- No TypeScript errors

Only output <promise>CALIBRATION_COMPLETE</promise> when npm run build exits 0 and all spot-checks pass.
