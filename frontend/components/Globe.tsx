'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { ConflictEvent, SatellitePosition } from '@/types'
import { fetchEvents } from '@/lib/api'

type GlobeState = 'loading' | 'error' | 'ready' | 'empty'

// RingEvent extends ConflictEvent with a ring-type discriminator
type RingType = 'strike' | 'drone' | 'missile'
type RingEvent = ConflictEvent & { _rt: RingType }

// Discriminated union for merged pointsData — events and satellites share ONE .pointsData() call
type EventPoint    = ConflictEvent    & { _kind: 'event' }
type SatellitePoint = SatellitePosition & { _kind: 'satellite' }
type GlobePoint    = EventPoint | SatellitePoint

// Footprint ring — satellite position tagged for ringsData routing
type FootprintRing = SatellitePosition & { _rtype: 'footprint' }
// Event ring — discriminated for ringsData routing
type EventRing = RingEvent & { _rtype: 'event' }
type AnyRing = EventRing | FootprintRing

export interface GlobeProps {
  onEventClick?: (event: ConflictEvent) => void
  onEventHover?: (event: ConflictEvent | null, x: number, y: number) => void
  onSatelliteHover?: (sat: SatellitePosition | null, x: number, y: number) => void
  timeWindowHours?: number   // undefined = no time filter
  visibleTypes?: Set<ConflictEvent['event_type']>  // undefined = all types shown; empty Set = nothing shown
  onEventsUpdate?: (events: ConflictEvent[]) => void
  onReady?: (handle: GlobeHandle) => void
  satellitePositions?: SatellitePosition[]
  isLivingEarth?: boolean
}

// Handle exposed for LivingEarthMode and RecordButton
export interface GlobeHandle {
  getGlobe: () => any
  pauseRefresh: () => void
  resumeRefresh: () => void
}

function GlobeComponent({
  onEventClick, onEventHover, onSatelliteHover,
  timeWindowHours, visibleTypes, onEventsUpdate, onReady,
  satellitePositions, isLivingEarth,
}: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<any>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isPausedRef = useRef(false)
  const allEventsRef = useRef<ConflictEvent[]>([])
  const mousePosRef = useRef({ x: 0, y: 0 })
  // Stable per-event jitter — generated once per ID, reused on every re-render
  const jitterMapRef = useRef<Map<string, { dlat: number; dlng: number }>>(new Map())
  const satellitePositionsRef = useRef<SatellitePosition[]>(satellitePositions ?? [])
  const isLivingEarthRef = useRef<boolean>(isLivingEarth ?? false)
  // Stable ref for onEventClick — avoids stale closure in the custom click handler
  const onEventClickRef = useRef(onEventClick)
  // Stored so cleanup can removeEventListener with the exact same function reference
  const clickHandlerRef = useRef<((e: MouseEvent) => void) | null>(null)
  const [state, setState] = useState<GlobeState>('loading')
  const [allEvents, setAllEvents] = useState<ConflictEvent[]>([])
  const [showLoadingText, setShowLoadingText] = useState(false)

  // Keep refs in sync so renderToGlobe always has latest values without re-running init
  satellitePositionsRef.current = satellitePositions ?? []
  isLivingEarthRef.current = isLivingEarth ?? false
  onEventClickRef.current = onEventClick

  // Filter events by current props
  function applyFilters(events: ConflictEvent[]): ConflictEvent[] {
    let filtered = events

    if (timeWindowHours !== undefined) {
      const cutoff = Date.now() - timeWindowHours * 3_600_000
      filtered = filtered.filter(e => new Date(e.first_detection_time).getTime() >= cutoff)
    }

    if (visibleTypes !== undefined) {
      if (visibleTypes.size === 0) return []
      filtered = filtered.filter(e => visibleTypes.has(e.event_type))
    }

    return filtered
  }

  async function loadAndRender(): Promise<ConflictEvent[]> {
    try {
      const data = await fetchEvents(100)
      setAllEvents(data.events)
      allEventsRef.current = data.events
      onEventsUpdate?.(data.events)
      return data.events
    } catch {
      setState('error')
      return []
    }
  }

  function renderToGlobe(globe: any, events: ConflictEvent[]) {
    const filtered = applyFilters(events)
    const satPositions = satellitePositionsRef.current
    const livingEarth = isLivingEarthRef.current

    if (filtered.length === 0 && satPositions.length === 0) {
      setState('empty')
    } else {
      setState('ready')
    }

    // Stable jitter: generate once per event ID, reuse on re-renders to prevent visual jumping
    function getJitter(id: string) {
      if (!jitterMapRef.current.has(id)) {
        jitterMapRef.current.set(id, {
          dlat: (Math.random() - 0.5) * 0.2,
          dlng: (Math.random() - 0.5) * 0.2,
        })
      }
      return jitterMapRef.current.get(id)!
    }

    const missiles = filtered.filter(e => e.event_type === 'MISSILE')
    const strikes  = filtered.filter(e => e.event_type === 'STRIKE')
    const drones   = filtered.filter(e => e.event_type === 'DRONE')

    // ── pointsData ──────────────────────────────────────────────────────────
    // Discriminated union: satellites first in array → events render on top
    // ALL event types get a point for hover/click (rings don't support hover callbacks).
    // STRIKE / DRONE / MISSILE use transparent color — rings provide visual.
    // NAVAL / TROOP use real colors.
    const eventPoints: EventPoint[] = filtered.map(e => ({ ...e, _kind: 'event' as const }))
    const satPoints: SatellitePoint[] = satPositions.map(s => ({ ...s, _kind: 'satellite' as const }))
    // satellites first → events render on top (later items paint over earlier ones in globe.gl)
    const allPoints: GlobePoint[] = [...satPoints, ...eventPoints]

    globe
      .pointsData(allPoints)
      .pointLat((d: GlobePoint) => {
        if (d._kind === 'satellite') return d.lat
        return (d as EventPoint).lat + getJitter((d as EventPoint).id).dlat
      })
      .pointLng((d: GlobePoint) => {
        if (d._kind === 'satellite') return d.lng
        return (d as EventPoint).lng + getJitter((d as EventPoint).id).dlng
      })
      .pointColor((d: GlobePoint) => {
        if (d._kind === 'satellite') {
          const sat = d as SatellitePoint
          const opacity = sat.isStale ? 0.45 : (sat.type === 'SAR' ? 0.95 : 0.6)
          const base = sat.type === 'SAR' ? '100,181,246' : '143,207,143'
          return `rgba(${base},${opacity})`
        }
        const evt = d as EventPoint
        if (evt.event_type === 'NAVAL') return '#d4a017'
        if (evt.event_type === 'TROOP') return 'rgba(232,230,224,0.15)'
        return 'rgba(0,0,0,0)'  // invisible hitbox — ring provides visual
      })
      .pointAltitude((d: GlobePoint) => {
        if (d._kind === 'satellite') {
          return ((d as SatellitePoint).alt_km / 6371) * 0.55
        }
        const evt = d as EventPoint
        if (evt.event_type === 'NAVAL')   return 0.01
        if (evt.event_type === 'TROOP')   return 0.005
        if (evt.event_type === 'DRONE')   return 0.03
        if (evt.event_type === 'MISSILE') return 0.04
        return 0.02  // STRIKE
      })
      .pointRadius((d: GlobePoint) => {
        if (d._kind === 'satellite') return 0.28
        const evt = d as EventPoint
        if (evt.event_type === 'NAVAL')   return 0.5
        if (evt.event_type === 'TROOP')   return 0.3
        // Hitbox must be >= ringMaxRadius so any click inside the ring registers.
        // STRIKE ring = 3.0°, DRONE ring = 1.2°, MISSILE ring = 0.6°
        if (evt.event_type === 'STRIKE')  return 4.0   // covers 3.0° ring + buffer
        if (evt.event_type === 'DRONE')   return 2.0   // covers 1.2° ring + buffer
        if (evt.event_type === 'MISSILE') return 1.2   // covers 0.6° ring + buffer
        return 1.5
      })
      .pointLabel(() => '')

    // ── ringsData ────────────────────────────────────────────────────────────
    // STRIKE → large slow crimson ring, 8s period (reads as impact zone)
    // DRONE  → small violet ring, 1.2s period (rapid flicker feel)
    // MISSILE → tiny fast ring at arc endpoint (terminal marker)
    // Footprints → near-static ring at ringPropagationSpeed=0.001, ringRepeatPeriod=9_999_999
    //   (speed=0 halts the renderer loop; 0.001 is visually static while keeping renderer alive)
    //   Never animate footprints like event rings — footprints are static geographic areas, not pulses.
    const eventRingData: EventRing[] = [
      ...strikes.map(e  => ({ ...e, _rt: 'strike'  as RingType, _rtype: 'event' as const })),
      ...drones.map(e   => ({ ...e, _rt: 'drone'   as RingType, _rtype: 'event' as const })),
      ...missiles.map(e => ({ ...e, _rt: 'missile' as RingType, _rtype: 'event' as const })),
    ]
    const footprintRings: FootprintRing[] = satPositions.map(s => ({ ...s, _rtype: 'footprint' as const }))
    const allRings: AnyRing[] = [...eventRingData, ...footprintRings]

    globe
      .ringsData(allRings)
      .ringLat((d: AnyRing) => {
        if (d._rtype === 'footprint') return (d as FootprintRing).lat
        return (d as EventRing).lat + getJitter((d as EventRing).id).dlat
      })
      .ringLng((d: AnyRing) => {
        if (d._rtype === 'footprint') return (d as FootprintRing).lng
        return (d as EventRing).lng + getJitter((d as EventRing).id).dlng
      })
      .ringColor((d: AnyRing) => {
        if (d._rtype === 'footprint') {
          const fp = d as FootprintRing
          const opacity = (fp.pulse && livingEarth) ? 0.35 : (fp.possibleCoverage ? 0.18 : 0.04)
          return () => `rgba(100,181,246,${opacity})`
        }
        const e = d as EventRing
        if (e._rt === 'strike')  return (t: number) => `rgba(192,57,43,${Math.max(0, 1 - t)})`
        if (e._rt === 'drone')   return (t: number) => `rgba(142,68,173,${Math.max(0, 1 - t)})`
        return (t: number) => `rgba(192,57,43,${Math.max(0, 1 - t) * 0.6})`
      })
      .ringMaxRadius((d: AnyRing) => {
        if (d._rtype === 'footprint') {
          // degree radius for VISUAL RENDERING ONLY; 1.1 = heuristic buffer for orbital uncertainty
          return ((d as FootprintRing).swath_km / 2 * 1.05) / 111
        }
        const e = d as EventRing
        return e._rt === 'strike' ? 3 : e._rt === 'drone' ? 1.2 : 0.6
      })
      .ringPropagationSpeed((d: AnyRing) => {
        // footprints: 0.001 (not 0 — speed=0 halts renderer loop)
        if (d._rtype === 'footprint') return 0.001
        const e = d as EventRing
        return e._rt === 'strike' ? 0.4 : e._rt === 'drone' ? 2 : 3
      })
      .ringRepeatPeriod((d: AnyRing) => {
        if (d._rtype === 'footprint') return 9_999_999  // near-static
        const e = d as EventRing
        return e._rt === 'strike' ? 8000 : e._rt === 'drone' ? 1200 : 2000
      })
      .ringAltitude((d: AnyRing) => {
        if (d._rtype === 'footprint') return 0.001
        const e = d as EventRing
        return e._rt === 'strike' ? 0.02 : e._rt === 'drone' ? 0.03 : 0.04
      })

    // ── arcsData ─────────────────────────────────────────────────────────────
    // Merge missile event arcs + satellite trail arcs into ONE .arcsData() call
    const missileArcs = missiles.map(e => ({
      startLat: e.lat - 1.5,
      startLng: e.lng - 1.5,
      endLat:   e.lat,
      endLng:   e.lng,
      _kind:    'missile' as const,
    }))
    const satTrailArcs = satPositions.flatMap(sat =>
      sat.positionHistory.slice(1).map((pos, i) => ({
        startLat: sat.positionHistory[i].lat,
        startLng: sat.positionHistory[i].lng,
        endLat:   pos.lat,
        endLng:   pos.lng,
        _kind:    'trail' as const,
      }))
    )

    globe
      .arcsData([...missileArcs, ...satTrailArcs])
      .arcStartLat((d: any) => d.startLat)
      .arcStartLng((d: any) => d.startLng)
      .arcEndLat((d: any) => d.endLat)
      .arcEndLng((d: any) => d.endLng)
      .arcColor((d: any) => d._kind === 'trail' ? 'rgba(100,181,246,0.09)' : '#c0392b')
      .arcDashLength((d: any) => d._kind === 'trail' ? 1.0 : 0.5)
      .arcDashGap((d: any) => d._kind === 'trail' ? 0 : 0.2)
      .arcDashAnimateTime((d: any) => d._kind === 'trail' ? 0 : 4000)
      .arcStroke((d: any) => d._kind === 'trail' ? 0.4 : 0.9)
  }

  // Exposed handle — called via onReady prop (dynamic() doesn't forward refs)
  function buildHandle(): GlobeHandle {
    return {
      getGlobe: () => globeRef.current,
      pauseRefresh: () => { isPausedRef.current = true },
      resumeRefresh: () => { isPausedRef.current = false },
    }
  }

  useEffect(() => {
    if (!containerRef.current) return

    let mounted = true

    async function init() {
      try {
      setState('loading')

      const evts = await loadAndRender()
      if (!mounted) return

      const GlobeLib = (await import('globe.gl')).default
      if (!mounted || !containerRef.current) return

      const globe = GlobeLib()(containerRef.current)
        .width(window.innerWidth)
        .height(window.innerHeight)
        .backgroundColor('#0a0a0e')
        .globeImageUrl('//unpkg.com/three-globe/example/img/earth-dark.jpg')
        .atmosphereColor('#1a3a5c')
        .atmosphereAltitude(0.2)

      globeRef.current = globe

      // Slight emissive boost to lift land contrast — mutates the THREE.MeshPhongMaterial
      // in place. mat.emissive is already a THREE.Color; setHex mutates without import.
      const mat = globe.globeMaterial()
      if (mat?.emissive) {
        mat.emissive.setHex(0x0d1520)
        mat.emissiveIntensity = 0.12
        mat.needsUpdate = true
      }

      // Bring camera closer — altitude 1.8 vs default ~2.5. Globe fills viewport, not floats in it.
      // lat: 20, lng: 10 = slightly above-equator westward angle (more interesting than 0/0).
      globe.pointOfView({ lat: 20, lng: 10, altitude: 1.8 }, 0)

      // Rotation is OFF by default — static globe is easier to read.
      // Living Earth Mode enables it (autoRotate = true, speed = 0.1) and disables on exit.
      globe.controls().autoRotate = false

      // globe.gl typed API only exposes 2 hover params; use mousemove for real cursor position.
      // Both onSatelliteHover and onEventHover use mousePosRef for stable screen coordinates —
      // do NOT add a second mousemove listener; this single mousePosRef is shared.
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
      globe.onArcHover((arc: object | null) => {
        onEventHover?.(arc as ConflictEvent | null, mousePosRef.current.x, mousePosRef.current.y)
      })
      // globe.onPointClick is NOT used for events — fully-transparent points (rgba=0) are
      // excluded from THREE.js raycasting regardless of pointRadius, so onPointClick never fires.
      // Instead: listen for raw canvas clicks, convert to lat/lng via toGlobeCoords, then
      // find the nearest event within a generous degree threshold.
      clickHandlerRef.current = (e: MouseEvent) => {
        if (!globeRef.current) return
        const rect = containerRef.current!.getBoundingClientRect()
        const coords = (globeRef.current as any).toGlobeCoords(
          e.clientX - rect.left,
          e.clientY - rect.top,
        )
        if (!coords) return  // click was off-globe
        let closest: ConflictEvent | null = null
        let minDist = Infinity
        for (const evt of allEventsRef.current) {
          const d = Math.sqrt((evt.lat - coords.lat) ** 2 + (evt.lng - coords.lng) ** 2)
          if (d < minDist) { minDist = d; closest = evt }
        }
        // 4° threshold — comfortably covers the STRIKE ring radius (3°)
        if (closest && minDist < 4.0) onEventClickRef.current?.(closest)
      }
      containerRef.current!.addEventListener('click', clickHandlerRef.current)
      globe.onArcClick((arc: object | null) => {
        if (arc) onEventClick?.(arc as ConflictEvent)
      })

      // Notify parent with the imperative handle (forwardRef doesn't work through dynamic())
      onReady?.(buildHandle())

      renderToGlobe(globe, evts)
      } catch (err) {
        console.error('[Globe] init() error:', err)
        setState('error')
      }
    }

    init()

    // 30s auto-refresh — skipped while recording is active
    intervalRef.current = setInterval(async () => {
      if (isPausedRef.current) return
      const evts = await loadAndRender()
      if (globeRef.current) renderToGlobe(globeRef.current, evts)
    }, 30_000)

    const handleResize = () => {
      if (globeRef.current) {
        globeRef.current.width(window.innerWidth).height(window.innerHeight)
      }
    }
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('resize', handleResize)
    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      mounted = false
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (clickHandlerRef.current) {
        containerRef.current?.removeEventListener('click', clickHandlerRef.current)
        clickHandlerRef.current = null
      }
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', handleMouseMove)
      // Dispose the WebGL context so React Strict Mode / HMR remounts get a clean container
      if (globeRef.current?._destructor) {
        globeRef.current._destructor()
        globeRef.current = null
      }
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render when filters change (without re-fetching)
  useEffect(() => {
    if (globeRef.current) renderToGlobe(globeRef.current, allEvents)
  }, [timeWindowHours, visibleTypes])  // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render when satellitePositions or isLivingEarth change
  useEffect(() => {
    if (globeRef.current) renderToGlobe(globeRef.current, allEventsRef.current)
  }, [satellitePositions, isLivingEarth])  // eslint-disable-line react-hooks/exhaustive-deps

  // Deferred loading text — only show after 2s to avoid flash on fast connections
  useEffect(() => {
    if (state !== 'loading') {
      setShowLoadingText(false)
      return
    }
    const timer = setTimeout(() => setShowLoadingText(true), 2000)
    return () => clearTimeout(timer)
  }, [state])

  // The globe container must ALWAYS be in the DOM so that:
  //   1. containerRef.current is set before useEffect fires
  //   2. globe.gl has a DOM node to attach its canvas to
  // Loading / error / empty states are overlaid on top, not returned early.
  const overlayStyle: React.CSSProperties = {
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    fontFamily: 'IBM Plex Mono, monospace',
    color: '#8a8a8a', fontSize: '13px', letterSpacing: '0.12em',
    pointerEvents: 'none',
  }

  return (
    <>
      {/* Globe canvas target — always mounted */}
      <div
        ref={containerRef}
        style={{
          width: '100vw', height: '100vh',
          background: '#0a0a0e',
          position: 'absolute', top: 0, left: 0,
        }}
      />

      {/* Status overlays */}
      {state === 'loading' && (
        <div style={{ ...overlayStyle, opacity: showLoadingText ? 1 : 0, transition: 'opacity 600ms ease' }}>
          ACQUIRING SIGNAL...
        </div>
      )}
      {state === 'error' && (
        <div style={overlayStyle}>SIGNAL LOST</div>
      )}
      {state === 'empty' && (
        <div style={overlayStyle}>NO EVENTS IN WINDOW</div>
      )}
    </>
  )
}

export default GlobeComponent
