'use client'

import { useEffect, useRef } from 'react'
import type { ConflictEvent, SatellitePosition } from '@/types'

// Satellite list — Planet Dove intentionally omitted (no single NORAD ID).
// It must NEVER appear in the onPositionsUpdate output array. Panel text only.
const IMAGING_SATELLITES = [
  { name: 'SENTINEL-1A',  norad: 39634, type: 'SAR'     as const, swath_km: 250 },
  { name: 'SENTINEL-1B',  norad: 41456, type: 'SAR'     as const, swath_km: 250 },
  { name: 'ICEYE-X7',     norad: 47506, type: 'SAR'     as const, swath_km: 100 },
  { name: 'ICEYE-X8',     norad: 47507, type: 'SAR'     as const, swath_km: 100 },
  { name: 'CAPELLA-3',    norad: 47380, type: 'SAR'     as const, swath_km: 100 },
  { name: 'CAPELLA-4',    norad: 47381, type: 'SAR'     as const, swath_km: 100 },
  { name: 'SENTINEL-2A',  norad: 40697, type: 'OPTICAL' as const, swath_km: 290 },
  { name: 'SENTINEL-2B',  norad: 42063, type: 'OPTICAL' as const, swath_km: 290 },
  { name: 'LANDSAT-8',    norad: 39084, type: 'OPTICAL' as const, swath_km: 185 },
  { name: 'LANDSAT-9',    norad: 49260, type: 'OPTICAL' as const, swath_km: 185 },
]

// Server-side proxy — avoids CORS and falls back to hardcoded orbital elements
const SATELLITES_API = '/api/satellites'
const CACHE_DURATION_MS = 6 * 3600_000

// In-module cache (not localStorage — SSR incompatible)
let ommCache: { data: any[]; ts: number } | null = null

async function fetchOmmData(): Promise<any[]> {
  if (ommCache && Date.now() - ommCache.ts < CACHE_DURATION_MS) {
    return ommCache.data
  }
  try {
    const res = await fetch(SATELLITES_API)
    if (!res.ok) throw new Error(`Satellites API failed: ${res.status}`)
    const data = await res.json()
    ommCache = { data: data, ts: Date.now() }
    return data
  } catch {
    // Return cached stale data on error rather than breaking propagation
    return ommCache?.data ?? []
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function computePositions(
  ommRecords: any[],
  events: ConflictEvent[],
  isLivingEarth: boolean,
  historyMap: Map<number, Array<{ lat: number; lng: number; ts: number }>>
): Promise<SatellitePosition[]> {
  // Lazy import to avoid SSR issues
  const satellite = await import('satellite.js')
  const now = new Date()
  const gmst = (satellite as any).gstime(now)
  const results: SatellitePosition[] = []

  for (const omm of ommRecords) {
    const meta = IMAGING_SATELLITES.find(s => s.norad === Number(omm.NORAD_CAT_ID))
    if (!meta) continue

    let satrec: any
    try {
      satrec = (satellite as any).json2satrec(omm)
    } catch {
      continue
    }

    const posVel = (satellite as any).propagate(satrec, now)
    if (!posVel.position || typeof posVel.position === 'boolean') continue

    const geo = (satellite as any).eciToGeodetic(posVel.position, gmst)
    const lat = (satellite as any).degreesLat(geo.latitude)
    const lng = (satellite as any).degreesLong(geo.longitude)
    const alt_km: number = geo.height
    const vel = posVel.velocity as any
    const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2)
    const velocity_kms = `~${speed.toFixed(1)} km/s`

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

    // Living Earth Mode pulse: overlap = pulse
    const pulse = isLivingEarth && possibleCoverage

    // Update positionHistory (last 30 positions per NORAD ID)
    const prev = historyMap.get(meta.norad) ?? []
    const updated = [...prev, { lat, lng, ts: Date.now() }].slice(-20)
    historyMap.set(meta.norad, updated)

    results.push({
      ...meta,
      lat,
      lng,
      alt_km,
      velocity_kms,
      isStale,
      possibleCoverage,
      pulse,
      positionHistory: [...updated] as Array<{ lat: number; lng: number; ts: number }>,
    })
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

interface SatelliteLayerProps {
  events: ConflictEvent[]
  satVisible: boolean
  isLivingEarth: boolean
  onPositionsUpdate: (positions: SatellitePosition[]) => void
}

export default function SatelliteLayer({ events, satVisible, isLivingEarth, onPositionsUpdate }: SatelliteLayerProps) {
  const historyMapRef = useRef<Map<number, Array<{ lat: number; lng: number; ts: number }>>>(new Map())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const eventsRef = useRef<ConflictEvent[]>(events)
  const isLivingEarthRef = useRef<boolean>(isLivingEarth)
  const satVisibleRef = useRef<boolean>(satVisible)
  // tickRef: lets the satVisible-change effect trigger an immediate fetch without
  // waiting up to 10s for the next interval cycle
  const tickRef = useRef<() => void>(() => {})

  // Keep refs in sync with latest props (avoids stale closure in interval)
  eventsRef.current = events
  isLivingEarthRef.current = isLivingEarth
  satVisibleRef.current = satVisible

  useEffect(() => {
    let mounted = true

    async function tick() {
      // Visibility guard — explicit clearing: first check in each tick
      if (!satVisibleRef.current) {
        onPositionsUpdate([])
        return
      }
      // Skip if tab is hidden
      if (document.hidden) return

      try {
        const ommRecords = await fetchOmmData()
        if (!mounted) return
        const positions = await computePositions(
          ommRecords,
          eventsRef.current,
          isLivingEarthRef.current,
          historyMapRef.current
        )
        if (!mounted) return
        onPositionsUpdate(positions)
      } catch {
        // Silently fail — stale positions stay on globe until next tick
      }
    }

    // Expose tick so the satVisible effect can trigger an immediate fetch on toggle-on
    tickRef.current = tick

    // Initial tick
    tick()

    // 10s interval (20s on mobile)
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
    const intervalMs = isMobile ? 20_000 : 10_000
    intervalRef.current = setInterval(tick, intervalMs)

    return () => {
      mounted = false
      // On unmount: clear stale points from the globe, then clear all timers
      onPositionsUpdate([])
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Immediately fetch on toggle-on; immediately clear on toggle-off
  useEffect(() => {
    if (satVisible) {
      tickRef.current()  // don't wait up to 10s for the next interval
    } else {
      onPositionsUpdate([])
    }
  }, [satVisible])  // eslint-disable-line react-hooks/exhaustive-deps

  // Returns null — no visible UI
  return null
}
