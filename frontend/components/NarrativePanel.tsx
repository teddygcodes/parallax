'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type {
  ConflictEvent, Signal, Analysis, SourceCategory, ConfidenceLevel,
  NextOpportunity, SatelliteCoverage, EventBrief, EventThreads, SourceThread,
} from '@/types'
import { fetchSignals, fetchAnalysis } from '@/lib/api'

interface NarrativePanelProps {
  event: ConflictEvent
  onClose: () => void
  satVisible?: boolean        // controls whether to show coverage section
}

function mapConfidence(level: ConfidenceLevel): string {
  switch (level) {
    case 'VERIFIED':     return 'CONFIRMED'
    case 'LIKELY':       return 'LIKELY'
    case 'REPORTED':     return 'REPORTED'
    case 'UNCONFIRMED':  return 'UNCONFIRMED'
    case 'DISPUTED':     return 'DISPUTED'
    default:             return level
  }
}

function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(3)}\u00b0${latDir}  ${Math.abs(lng).toFixed(3)}\u00b0${lngDir}`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const hours   = d.getUTCHours().toString().padStart(2, '0')
  const minutes = d.getUTCMinutes().toString().padStart(2, '0')
  const months  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${hours}:${minutes} UTC  \u00b7  ${months[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`
}

function divergenceColor(score: number): string {
  if (score <= 0.33) return '#27ae60'
  if (score <= 0.66) return '#f39c12'
  return '#c0392b'
}

function divergenceLabel(score: number): string {
  if (score <= 0.25) return 'LOW'
  if (score <= 0.50) return 'MODERATE'
  if (score <= 0.75) return 'HIGH'
  return 'EXTREME'
}

function formatSecondsAgo(seconds: number): string {
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60)
    return `${mins}m ago`
  }
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return mins > 0 ? `${hrs}h ${mins}m ago` : `${hrs}h ago`
}

function formatSecondsIn(seconds: number): string {
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60)
    return `~${mins}m`
  }
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return mins > 0 ? `~${hrs}h ${mins}m` : `~${hrs}h`
}

function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  return `${Math.floor(s / 60)}m ago`
}


const SOURCE_CATEGORIES: SourceCategory[] = ['WESTERN', 'RUSSIAN', 'MIDDLE_EAST', 'OSINT', 'LOCAL']

const MONO: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace',
}

// Imaging satellites for client-side forecast — Planet Dove intentionally omitted
const FORECAST_SATELLITES = [
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

const CELESTRAK_OMM_URL = 'https://celestrak.org/GP/GP.php?GROUP=active&FORMAT=json'
let panelOmmCache: { data: any[]; ts: number } | null = null

async function fetchPanelOmm(): Promise<any[]> {
  const SIX_HOURS = 6 * 3600_000
  if (panelOmmCache && Date.now() - panelOmmCache.ts < SIX_HOURS) {
    return panelOmmCache.data
  }
  try {
    const res = await fetch(CELESTRAK_OMM_URL)
    if (!res.ok) return panelOmmCache?.data ?? []
    const all = await res.json()
    const noradSet = new Set(FORECAST_SATELLITES.map(s => s.norad))
    const filtered = all.filter((r: any) => noradSet.has(Number(r.NORAD_CAT_ID)))
    panelOmmCache = { data: filtered, ts: Date.now() }
    return filtered
  } catch {
    return panelOmmCache?.data ?? []
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default function NarrativePanel({ event, onClose, satVisible }: NarrativePanelProps) {
  const [signals, setSignals]   = useState<Signal[] | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [sigError, setSigError] = useState(false)
  const [anError, setAnError]   = useState(false)

  // Client-side forecast state (fallback when backend next_opportunities is null)
  const [forecastRows, setForecastRows] = useState<NextOpportunity[] | null>(null)
  const forecastCacheRef = useRef<Map<string, NextOpportunity[]>>(new Map())
  const lastForecastTimeRef = useRef<number>(0)
  const [, forceUpdate] = useState(0)

  // Auto Brief state
  const [brief, setBrief] = useState<string | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefGeneratedAt, setBriefGeneratedAt] = useState<string | null>(null)

  // Source Threads state
  const [threads, setThreads]               = useState<SourceThread[]>([])
  const [threadsLoading, setThreadsLoading] = useState(false)

  useEffect(() => {
    setSignals(null)
    setAnalysis(null)
    setSigError(false)
    setAnError(false)

    fetchSignals(event.id)
      .then(setSignals)
      .catch(() => setSigError(true))

    fetchAnalysis(event.id)
      .then(setAnalysis)
      .catch(() => setAnError(true))
  }, [event.id])

  // Client-side revisit forecast — only when SAT layer is on and backend data is absent
  useEffect(() => {
    if (!satVisible) return

    async function computeForecast() {
      // Backend data takes priority — only compute client-side fallback when absent
      if (analysis?.next_opportunities && analysis.next_opportunities.length > 0) return

      if (forecastCacheRef.current.has(event.id)) {
        setForecastRows(forecastCacheRef.current.get(event.id)!)
        lastForecastTimeRef.current = Date.now()
        return
      }

      try {
        // Lazy import to avoid SSR issues
        const satellite = await import('satellite.js')
        const ommRecords = await fetchPanelOmm()
        if (!ommRecords.length) return

        const opportunities: NextOpportunity[] = []
        const STEP_MS = 3 * 60 * 1000  // 3-minute steps
        const HORIZON_MS = 12 * 3600 * 1000  // 12 hours
        const now = new Date()

        for (const omm of ommRecords) {
          const meta = FORECAST_SATELLITES.find(s => s.norad === Number(omm.NORAD_CAT_ID))
          if (!meta) continue

          let satrec: any
          try {
            satrec = (satellite as any).json2satrec(omm)
          } catch {
            continue
          }

          // Scan forward in 3-minute steps over 12h
          let foundAt: number | null = null
          for (let offsetMs = STEP_MS; offsetMs <= HORIZON_MS; offsetMs += STEP_MS) {
            const t = new Date(now.getTime() + offsetMs)
            const posVel = (satellite as any).propagate(satrec, t)
            if (!posVel.position || typeof posVel.position === 'boolean') continue

            const gmst = (satellite as any).gstime(t)
            const geo = (satellite as any).eciToGeodetic(posVel.position, gmst)
            const lat = (satellite as any).degreesLat(geo.latitude)
            const lng = (satellite as any).degreesLong(geo.longitude)

            const dist = haversineKm(lat, lng, event.lat, event.lng)
            if (dist < meta.swath_km / 2 * 1.1) {
              foundAt = offsetMs / 1000  // convert to seconds
              break
            }
          }

          if (foundAt !== null) {
            opportunities.push({
              satellite_name: meta.name,
              pass_type: meta.type,
              in_seconds: foundAt,
            })
          }
        }

        // Sort by soonest
        opportunities.sort((a, b) => a.in_seconds - b.in_seconds)
        forecastCacheRef.current.set(event.id, opportunities)
        setForecastRows(opportunities)
        lastForecastTimeRef.current = Date.now()
      } catch {
        // Silently fail — section stays hidden
      }
    }

    computeForecast()
    const forecastTimer = setInterval(computeForecast, 120_000)
    const displayTimer = setInterval(() => forceUpdate(n => n + 1), 60_000)
    return () => {
      clearInterval(forecastTimer)
      clearInterval(displayTimer)
    }
  }, [event.id, satVisible, analysis])  // eslint-disable-line react-hooks/exhaustive-deps

  // Escape key to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Auto Brief fetch — event.id dependency only, never re-fetches on every render
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

  // Source Threads fetch — event.id dependency only
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

  // Group signals by source category
  const signalsByCategory = SOURCE_CATEGORIES.reduce<Record<SourceCategory, Signal[]>>(
    (acc, cat) => {
      acc[cat] = (signals ?? []).filter(s => s.source_category === cat)
      return acc
    },
    { WESTERN: [], RUSSIAN: [], MIDDLE_EAST: [], OSINT: [], LOCAL: [] }
  )

  const totalSignals = signals?.length ?? 0

  // Resolved satellite coverage and opportunities (backend takes priority over client-side)
  const resolvedCoverage: SatelliteCoverage[] | undefined = analysis?.satellite_coverage
  const resolvedOpportunities: NextOpportunity[] | null =
    (analysis?.next_opportunities && analysis.next_opportunities.length > 0)
      ? analysis.next_opportunities
      : forecastRows

  return (
    <motion.div
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 400, opacity: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        width: '400px',
        height: '100vh',
        background: 'rgba(10, 10, 14, 0.96)',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        overflowY: 'auto',
        padding: '32px 24px',
        zIndex: 200,
        boxSizing: 'border-box',
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          ...MONO,
          fontSize: '18px',
          color: '#8a8a8a',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          lineHeight: 1,
          padding: '4px 8px',
          transition: 'color 300ms ease',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#e8e6e0' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#8a8a8a' }}
      >
        &times;
      </button>

      {/* Event header */}
      <div style={{ marginBottom: '24px', paddingRight: '24px' }}>
        <div style={{ ...MONO, fontSize: '13px', letterSpacing: '0.12em', color: '#e8e6e0', marginBottom: '4px' }}>
          <span>{event.event_type}</span>
          <span style={{ color: '#8a8a8a', margin: '0 8px' }}>&middot;</span>
          <span>{mapConfidence(event.confidence)}</span>
        </div>
        <div style={{ ...MONO, fontSize: '12px', letterSpacing: '0.06em', color: '#64b5f6', marginBottom: '2px' }}>
          {formatCoords(event.lat, event.lng)}
        </div>
        <div style={{ ...MONO, fontSize: '10px', letterSpacing: '0.08em', color: '#8a8a8a' }}>
          {formatDateTime(event.first_detection_time)}
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginBottom: '20px' }} />

      {/* Signals section */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ ...MONO, fontSize: '9px', letterSpacing: '0.18em', color: '#8a8a8a', marginBottom: '12px' }}>
          SIGNALS
        </div>

        {signals === null && !sigError && (
          <div style={{ ...MONO, fontSize: '10px', color: '#8a8a8a', letterSpacing: '0.1em' }}>
            LOADING...
          </div>
        )}

        {sigError && (
          <div style={{ ...MONO, fontSize: '10px', color: '#8a8a8a', letterSpacing: '0.1em' }}>
            SIGNAL FETCH FAILED
          </div>
        )}

        {signals !== null && totalSignals === 0 && (
          <div style={{ ...MONO, fontSize: '10px', color: '#8a8a8a', letterSpacing: '0.1em' }}>
            NO SIGNALS RECEIVED
          </div>
        )}

        {signals !== null && totalSignals > 0 && SOURCE_CATEGORIES.map(cat => {
          const catSignals = signalsByCategory[cat]
          if (catSignals.length === 0) return null
          return (
            <div key={cat} style={{ marginBottom: '14px' }}>
              <div style={{ ...MONO, fontSize: '9px', letterSpacing: '0.16em', color: '#64b5f6', marginBottom: '6px' }}>
                {cat}
              </div>
              {catSignals.map(sig => (
                <div key={sig.id} style={{ marginBottom: '8px', paddingLeft: '8px', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ ...MONO, fontSize: '10px', color: '#e8e6e0', marginBottom: '2px', letterSpacing: '0.06em' }}>
                    {sig.source}
                  </div>
                  {sig.description && (
                    <div style={{
                      ...MONO,
                      fontSize: '10px',
                      color: '#8a8a8a',
                      letterSpacing: '0.04em',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}>
                      {sig.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>

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

      {/* SATELLITE COVERAGE section — shown only when SAT layer is on */}
      {satVisible && (
        <>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginBottom: '20px' }} />

          <div style={{ marginBottom: '24px' }}>
            <div style={{ ...MONO, fontSize: '9px', letterSpacing: '0.18em', color: '#8a8a8a', marginBottom: '12px' }}>
              SATELLITE COVERAGE
            </div>

            {/* Past passes from backend */}
            {resolvedCoverage && resolvedCoverage.length > 0 ? (
              <>
                {resolvedCoverage.map((cov, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'baseline' }}>
                    <span style={{ ...MONO, fontSize: '10px', color: '#e8e6e0', flex: '0 0 auto', marginRight: '8px' }}>
                      {cov.satellite_name}
                    </span>
                    <span style={{
                      ...MONO, fontSize: '10px', flex: '1',
                      color: cov.last_pass_ago_seconds !== null ? '#64b5f6' : '#8a8a8a',
                    }}>
                      {cov.last_pass_ago_seconds !== null
                        ? `possible pass  ${formatSecondsAgo(cov.last_pass_ago_seconds)}`
                        : 'no recent pass'}
                    </span>
                    <span style={{ ...MONO, fontSize: '9px', color: '#8a8a8a', flex: '0 0 auto' }}>
                      {cov.pass_type}
                    </span>
                  </div>
                ))}
                {/* Planet Dove — always shown in panel */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'baseline' }}>
                  <span style={{ ...MONO, fontSize: '10px', color: '#e8e6e0', flex: '0 0 auto', marginRight: '8px' }}>
                    Planet Dove
                  </span>
                  <span style={{ ...MONO, fontSize: '10px', color: '#64b5f6', flex: '1' }}>
                    constellation pass likely
                  </span>
                  <span style={{ ...MONO, fontSize: '9px', color: '#8a8a8a', flex: '0 0 auto' }}>
                    OPTICAL
                  </span>
                </div>
              </>
            ) : (
              <>
                {/* Placeholder when no backend coverage data */}
                <div style={{ ...MONO, fontSize: '10px', color: '#8a8a8a', letterSpacing: '0.1em', marginBottom: '6px' }}>
                  COVERAGE DATA PENDING
                </div>
                {/* Planet Dove always shown */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'baseline' }}>
                  <span style={{ ...MONO, fontSize: '10px', color: '#e8e6e0', flex: '0 0 auto', marginRight: '8px' }}>
                    Planet Dove
                  </span>
                  <span style={{ ...MONO, fontSize: '10px', color: '#64b5f6', flex: '1' }}>
                    constellation pass likely
                  </span>
                  <span style={{ ...MONO, fontSize: '9px', color: '#8a8a8a', flex: '0 0 auto' }}>
                    OPTICAL
                  </span>
                </div>
              </>
            )}

            {/* NEXT OPPORTUNITIES */}
            {resolvedOpportunities && resolvedOpportunities.length > 0 && (
              <>
                <div style={{ ...MONO, fontSize: '9px', letterSpacing: '0.18em', color: '#8a8a8a', marginTop: '14px', marginBottom: '8px' }}>
                  NEXT OPPORTUNITIES
                </div>
                {resolvedOpportunities.slice(0, 5).map((opp, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', alignItems: 'baseline' }}>
                    <span style={{ ...MONO, fontSize: '10px', color: '#e8e6e0', flex: '0 0 auto', marginRight: '8px' }}>
                      {opp.satellite_name}
                    </span>
                    <span style={{ ...MONO, fontSize: '10px', color: '#64b5f6', flex: '1' }}>
                      in {formatSecondsIn(opp.in_seconds)}
                    </span>
                    <span style={{ ...MONO, fontSize: '9px', color: '#8a8a8a', flex: '0 0 auto' }}>
                      {opp.pass_type}
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* Last updated timestamp */}
            {lastForecastTimeRef.current > 0 && (
              <div
                style={{
                  ...MONO,
                  color: 'var(--text-secondary, #8a8a8a)',
                  fontSize: '0.7rem',
                  marginTop: '4px',
                  fontFamily: 'IBM Plex Mono, monospace',
                }}
              >
                {'Last updated: ' + fmtAgo(Date.now() - lastForecastTimeRef.current)}
              </div>
            )}

            {/* Computing indicator */}
            {(!resolvedOpportunities || resolvedOpportunities.length === 0) && (
              <div style={{ ...MONO, fontSize: '10px', color: '#8a8a8a', letterSpacing: '0.1em', marginTop: '8px' }}>
                COMPUTING OPPORTUNITIES...
              </div>
            )}
          </div>
        </>
      )}

      {/* AUTO BRIEF */}
      <div style={{ marginTop: '20px' }}>
        <div
          style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '11px',
            letterSpacing: '0.14em',
            color: 'var(--text-primary, #e8e6e0)',
            marginBottom: '10px',
          }}
        >
          AUTO BRIEF
        </div>

        <div
          style={{
            borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
            paddingTop: '12px',
          }}
        >
          {briefLoading && (
            <div
              style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: '12px',
                color: 'var(--text-secondary, #8a8a8a)',
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
                  color: 'var(--text-primary, #e8e6e0)',
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
                  color: 'var(--text-secondary, #8a8a8a)',
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
                    color: 'var(--text-secondary, #8a8a8a)',
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
                color: 'var(--text-secondary, #8a8a8a)',
              }}
            >
              BRIEF UNAVAILABLE
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginBottom: '20px', marginTop: '20px' }} />

      {/* AI Analysis section */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ ...MONO, fontSize: '9px', letterSpacing: '0.18em', color: '#8a8a8a', marginBottom: '12px' }}>
          AI ANALYSIS
        </div>

        {analysis === null && !anError && (
          <div style={{ ...MONO, fontSize: '10px', color: '#8a8a8a', letterSpacing: '0.1em' }}>
            ANALYSIS PENDING...
          </div>
        )}

        {anError && (
          <div style={{ ...MONO, fontSize: '10px', color: '#8a8a8a', letterSpacing: '0.1em' }}>
            ANALYSIS PENDING...
          </div>
        )}

        {analysis !== null && (() => {
          const sections: { key: string; label: string; value: string }[] = [
            { key: 'confirmed',  label: 'WHAT IS CONFIRMED',              value: analysis.what_is_confirmed },
            { key: 'disputed',   label: 'WHAT IS DISPUTED',               value: analysis.what_is_disputed },
            { key: 'dark',       label: 'WHERE INFORMATION GOES DARK',    value: analysis.where_information_goes_dark },
            { key: 'core',       label: 'CORE DISAGREEMENT',              value: analysis.core_disagreement },
          ]
          return (
            <>
              {sections.map(({ key, label, value }) => (
                <div key={key} style={{ marginBottom: '16px' }}>
                  <div style={{ ...MONO, fontSize: '9px', letterSpacing: '0.14em', color: '#e8e6e0', marginBottom: '6px' }}>
                    {label}
                  </div>
                  <div style={{
                    fontFamily: 'Instrument Serif, Georgia, serif',
                    fontSize: '13px',
                    color: '#e8e6e0',
                    lineHeight: '1.6',
                    letterSpacing: '0.01em',
                  }}>
                    {value || <span style={{ color: '#8a8a8a', fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px' }}>NO DATA</span>}
                  </div>
                </div>
              ))}
            </>
          )
        })()}
      </div>

      {/* Divergence bar — only shown when analysis is available */}
      {analysis !== null && (
        <>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginBottom: '20px' }} />
          <div>
            <div style={{ ...MONO, fontSize: '9px', letterSpacing: '0.18em', color: '#8a8a8a', marginBottom: '10px' }}>
              NARRATIVE DIVERGENCE
            </div>

            {/* Axis labels */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ ...MONO, fontSize: '9px', color: '#8a8a8a', letterSpacing: '0.1em' }}>Consensus</span>
              <span style={{ ...MONO, fontSize: '9px', color: '#8a8a8a', letterSpacing: '0.1em' }}>Contested</span>
            </div>

            {/* Bar track */}
            <div style={{
              width: '100%',
              height: '8px',
              background: 'rgba(255,255,255,0.08)',
              position: 'relative',
              marginBottom: '8px',
            }}>
              <div style={{
                width: `${Math.round(analysis.divergence_score * 100)}%`,
                height: '100%',
                background: divergenceColor(analysis.divergence_score),
                transition: 'width 400ms ease',
              }} />
            </div>

            {/* Score + label */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{
                ...MONO,
                fontSize: '10px',
                color: divergenceColor(analysis.divergence_score),
                letterSpacing: '0.1em',
              }}>
                {divergenceLabel(analysis.divergence_score)}
              </span>
              <span style={{ ...MONO, fontSize: '10px', color: '#64b5f6', letterSpacing: '0.06em' }}>
                {Math.round(analysis.divergence_score * 100)}%
              </span>
            </div>
          </div>
        </>
      )}
    </motion.div>
  )
}
