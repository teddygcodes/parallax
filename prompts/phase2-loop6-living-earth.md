# PARALLAX Phase 2 — Loop 6: Living Earth Mode + MediaRecorder

You are building PARALLAX. Loops 4 and 5 are complete: globe renders events, hover cards work, narrative panel works, controls work.
Full spec: `/Users/tylergilstrap/Desktop/PARALLAX/PARALLAXprompt.md`. Read it.

## ALWAYS START HERE — CHECK WHAT EXISTS

```bash
ls -la /Users/tylergilstrap/Desktop/PARALLAX/frontend/components/
cd /Users/tylergilstrap/Desktop/PARALLAX/frontend && npm run build 2>&1 | tail -5
# Verify Loop 5 is done — GlobeControls, NarrativePanel, HoverCard must exist
```

Working directory: `/Users/tylergilstrap/Desktop/PARALLAX/frontend`

If Loop 5 is not complete (build fails, or interaction components are missing), stop and fix that first.
Only build what is missing. Do not overwrite working code.

---

## WHAT YOU ARE BUILDING

Three components that implement the ambient passive display mode:

1. **LivingEarthMode.tsx** — orchestrates ambient mode (hides chrome, manages camera drift)
2. **AmbientSound.tsx** — Web Audio tone on significant new events
3. **RecordButton.tsx** — 30-second canvas recording export

Plus wiring the Living Earth Mode toggle in `GlobeControls.tsx`.

---

## COMPONENT SPECS

### 1. frontend/components/LivingEarthMode.tsx

Passive ambient display mode. When active:

**Chrome visibility**: all UI chrome disappears:
- Tab nav (`GLOBE` / `SIGNAL`) hidden
- PARALLAX wordmark hidden
- GlobeControls bar hidden
- NarrativePanel hidden (if open, close it first)
- HoverCard hidden
- Only globe canvas visible + RecordButton (bottom-right)

**Camera drift**: every 90 seconds, eases camera to a new target:
- Pick target from the current event list: sort by `signal_count` descending, pick randomly from the top 10. This prevents drifting to empty ocean.
- Ease camera using `globe.gl`'s `pointOfView({ lat, lng, altitude: 2.5 })` with transition duration 1500ms
- If event list is empty, skip the drift (do not drift to arbitrary coordinates)

**Globe rotation**: continues using the same time-based `autoRotate` configuration as Loop 4 — starting at 0.3 and adjusting downward if needed to preserve a barely perceptible feel. Never use `requestAnimationFrame` + manual degree increments anywhere in Phase 2.

**Events**: continue rendering at their natural timing. No changes to event display.

**Escape to exit**: pressing `Escape` key exits Living Earth Mode. Re-clicking the `LIVING EARTH` button in GlobeControls also exits.

**Cleanup**: `setInterval` drift timer must be cleared on mode exit (in `useEffect` return or mode toggle handler).

### 2. frontend/components/AmbientSound.tsx

Sound stub — minimal, default muted.

**Trigger**: on significant new event (confidence `VERIFIED` or `LIKELY`) appearing in the event list, play one soft tone.

**Tone**: Web Audio API:
```ts
const ctx = new AudioContext()
const osc = ctx.createOscillator()
const gain = ctx.createGain()
osc.connect(gain)
gain.connect(ctx.destination)
osc.frequency.value = 440
osc.type = 'sine'
gain.gain.setValueAtTime(0, ctx.currentTime)
gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.5)
gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 3.0)
osc.start(ctx.currentTime)
osc.stop(ctx.currentTime + 3.0)
```

**Default muted**: `AudioContext` not created until user interacts (clicks globe). This handles browser autoplay policy.

**No looping background music** — silence between events is intentional.

**Cleanup**: `AudioContext` must be closed on component unmount.

### 3. frontend/components/RecordButton.tsx

MediaRecorder canvas export. Visible only in Living Earth Mode.

**Styling** (IBM Plex Mono):
- Semi-transparent circle, bottom-right corner: `position: fixed; bottom: 32px; right: 32px`
- Background: `rgba(10,10,14,0.75)`, border: `1px solid rgba(255,255,255,0.15)`
- Label: `REC` in IBM Plex Mono, `font-size: 11px`, `letter-spacing: 0.14em`, color `--text-secondary`
- Active recording: label becomes `00:30` countdown in `--text-primary`; add subtle pulsing border `#c0392b`

**MIME type selection** — try formats in order:
```ts
const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
  ? 'video/webm;codecs=vp9'
  : MediaRecorder.isTypeSupported('video/mp4')
  ? 'video/mp4'
  : null
```

**Unsupported fallback**: if `typeof MediaRecorder === 'undefined'` or `mimeType === null`, do NOT show the countdown UI. Instead display `RECORDING UNSUPPORTED` centered in IBM Plex Mono at `--text-secondary`. Do not throw.

**Recording flow**:
1. Click REC → check MIME type support → start `MediaRecorder` on `canvas.captureStream(30)`
2. Find the globe canvas: `document.querySelector('canvas')`
3. **Suppress auto-refresh while recording**: pause the Globe's 30s refresh interval for the duration. Resume immediately after download is triggered.
4. Countdown from `00:30` updating every second
5. After 30 seconds: stop recorder, collect chunks, create `Blob`, trigger download:
   ```ts
   const blob = new Blob(chunks, { type: mimeType })
   const url = URL.createObjectURL(blob)
   const a = document.createElement('a')
   a.href = url
   a.download = `parallax-${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`
   a.click()
   URL.revokeObjectURL(url)
   ```
6. After download: resume normal auto-refresh, reset button to `REC` state

**Cleanup**: MediaRecorder event listeners must be removed on component unmount.

---

## WIRING IN page.tsx AND GlobeControls.tsx

### GlobeControls.tsx

Wire the existing `LIVING EARTH` toggle button to a real callback:
```tsx
onLivingEarthToggle: () => void
```
Pass it through from page.tsx: `onLivingEarthToggle={() => setIsLivingEarth(prev => !prev)}`

### page.tsx additions

```tsx
const [isLivingEarth, setIsLivingEarth] = useState(false)
const globeRef = useRef<any>(null)  // ref to forward globe instance to LivingEarthMode

// When entering Living Earth Mode, close any open NarrativePanel
useEffect(() => {
  if (isLivingEarth) setSelectedEvent(null)
}, [isLivingEarth])

// Escape key exits Living Earth Mode
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isLivingEarth) setIsLivingEarth(false)
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [isLivingEarth])
```

In JSX: conditionally render chrome based on `isLivingEarth`:
```tsx
{!isLivingEarth && <nav>{/* tabs */}</nav>}
{!isLivingEarth && <div>{/* wordmark */}</div>}
{!isLivingEarth && <GlobeControls ... />}
{!isLivingEarth && hoveredEvent && <HoverCard ... />}
{!isLivingEarth && <AnimatePresence>{selectedEvent && <NarrativePanel ... />}</AnimatePresence>}

{isLivingEarth && (
  <LivingEarthMode
    events={currentEvents}   // pass current event list for camera drift targets
    globeRef={globeRef}
    onExit={() => setIsLivingEarth(false)}
  />
)}
{isLivingEarth && <RecordButton />}
```

Pass `globeRef` to `<GlobeComponent>` via a `ref` callback or `forwardRef` so LivingEarthMode can call `globe.pointOfView(...)`.

---

## ANTI-PATTERN GUARDS

1. **Camera drift only to real event locations** — sort by `signal_count` desc, pick from top 10, never drift to `{lat:0, lng:0}` or arbitrary ocean
2. **Globe rotation stays time-based** — `autoRotate = true`, `autoRotateSpeed` starting at 0.3, never `requestAnimationFrame` + manual increments
3. **Suppress auto-refresh during recording** — globe's 30s `setInterval` must be paused while `MediaRecorder` is active
4. **Unsupported = graceful** — `RECORDING UNSUPPORTED` text, no throw, no countdown shown
5. **Cleanup on unmount** — `clearInterval` (drift timer), `removeEventListener` (Escape key), `AudioContext.close()`, MediaRecorder listeners removed
6. **Chrome hide via conditional render** — not CSS `display: none` or opacity. Use `{!isLivingEarth && <component>}` pattern
7. **No pure white/black, no system fonts** — same rules as all loops

---

## COMPLETION CRITERIA

```bash
cd /Users/tylergilstrap/Desktop/PARALLAX/frontend
npm run build
# Must exit 0 — no regressions
```

Manual browser checks (localhost:3000):
- Click `LIVING EARTH` in GlobeControls → all chrome disappears (tabs, wordmark, controls, hover cards, panel)
- Globe continues rotating, events continue appearing
- Camera eases to a new region every ~90s (check it doesn't jump to ocean)
- `REC` button visible bottom-right
- Press `Escape` → chrome returns
- Click `REC` → either:
  - (supported browser) countdown starts from `00:30`, counts down, file download triggers after 30s
  - (unsupported browser) `RECORDING UNSUPPORTED` shown gracefully, no error thrown
- After download: button resets to `REC`, auto-refresh resumes
- `npm run build` exits 0 — this is the primary automated gate

Only output this when `npm run build` exits 0 AND manual browser checks pass:

<promise>LIVING_EARTH_COMPLETE</promise>
