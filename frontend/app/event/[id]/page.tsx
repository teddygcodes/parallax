'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { EventDetailPayload, PhotoItem, VideoItem, EventSummaryCard } from '@/types'

const CATEGORIES = ['WESTERN', 'RUSSIAN', 'MIDDLE_EAST', 'OSINT'] as const
type PerspectiveCat = typeof CATEGORIES[number]

const CATEGORY_LABELS: Record<PerspectiveCat, string> = {
  WESTERN:     'WESTERN',
  RUSSIAN:     'RUSSIAN',
  MIDDLE_EAST: 'MIDDLE EAST',
  OSINT:       'OSINT',
}

const CATEGORY_COLORS: Record<PerspectiveCat, string> = {
  WESTERN:     '#e8e6e0',
  RUSSIAN:     '#c0392b',
  MIDDLE_EAST: '#d4a017',
  OSINT:       '#64b5f6',
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  STRIKE:  '#c0392b',
  MISSILE: '#e74c3c',
  DRONE:   '#8e44ad',
  NAVAL:   '#d4a017',
  TROOP:   '#a0a09a',
}

function relativeTime(isoStr: string | null): string {
  if (!isoStr) return '—'
  const diff = Date.now() - new Date(isoStr).getTime()
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatAbsoluteTime(isoStr: string | null): string {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  return d.toUTCString().replace('GMT', 'UTC')
}

type PageState =
  | { status: 'loading' }
  | { status: 'ok'; data: EventDetailPayload }
  | { status: '404' }
  | { status: 'error' }

export default function EventDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [recentEvents, setRecentEvents] = useState<EventSummaryCard[]>([])

  useEffect(() => {
    if (!id) return
    setState({ status: 'loading' })
    fetch(`/api/events/${id}/detail`)
      .then(async res => {
        if (res.status === 404) { setState({ status: '404' }); return }
        if (!res.ok) { setState({ status: 'error' }); return }
        const data: EventDetailPayload = await res.json()
        setState({ status: 'ok', data })
      })
      .catch(() => setState({ status: 'error' }))
  }, [id])

  useEffect(() => {
    fetch('/api/events/recent-summaries?limit=30')
      .then(r => r.json())
      .then((data: EventSummaryCard[]) => setRecentEvents(data))
      .catch(() => {})
  }, [])

  if (state.status === 'loading') return <LoadingPage />
  if (state.status === '404')    return <ErrorPage message="EVENT NOT FOUND" />
  if (state.status === 'error')  return <ErrorPage message="FAILED TO LOAD" />

  const { event, ai_analysis, signals_by_category, photos, videos } = state.data
  const typeColor = EVENT_TYPE_COLORS[event.event_type] ?? '#8a8a8a'

  return (
    <div style={{
      height:          '100vh',
      overflowY:       'auto',
      background:      '#0a0a0e',
      color:           '#e8e6e0',
      fontFamily:      'IBM Plex Mono, monospace',
    }}>

      {/* Top bar */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '18px 32px',
        borderBottom:   '1px solid rgba(255,255,255,0.06)',
      }}>
        <button
          onClick={() => router.back()}
          style={{
            fontFamily:    'IBM Plex Mono, monospace',
            fontSize:      '11px',
            letterSpacing: '0.14em',
            color:         '#8a8a8a',
            background:    'none',
            border:        'none',
            cursor:        'pointer',
            padding:       0,
            transition:    'color 200ms ease',
          }}
        >
          ← PARALLAX
        </button>
        <span style={{
          fontFamily:    'Bebas Neue, sans-serif',
          fontSize:      '18px',
          letterSpacing: '0.2em',
          color:         '#e8e6e0',
        }}>
          PARALLAX
        </span>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 32px' }}>

        {/* ── Event header ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
            <span style={{
              fontFamily:    'IBM Plex Mono, monospace',
              fontSize:      '11px',
              letterSpacing: '0.12em',
              color:         typeColor,
              border:        `1px solid ${typeColor}50`,
              borderRadius:  '2px',
              padding:       '3px 7px',
            }}>
              {event.event_type}
            </span>
          </div>

          {/* headline_hint — contextual subtitle only; may be noisy */}
          <div style={{
            fontFamily: 'Instrument Serif, serif',
            fontSize:   '16px',
            color:      '#8a8a8a',
            marginBottom: '12px',
          }}>
            {event.headline_hint}
          </div>

          {/* Metadata row */}
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {[
              { label: 'DETECTED',  value: formatAbsoluteTime(event.first_detection_time) },
              { label: 'UPDATED',   value: relativeTime(event.newest_signal_at) },
              { label: 'SIGNALS',   value: `${event.signal_count}` },
            ].map(({ label, value }) => (
              <span key={label} style={{
                fontFamily:    'IBM Plex Mono, monospace',
                fontSize:      '10px',
                color:         '#8a8a8a',
                letterSpacing: '0.08em',
              }}>
                {label} · {value}
              </span>
            ))}
          </div>
        </div>

        {/* ── AI analysis block ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: '48px' }}>
          <div style={{
            fontFamily:    'IBM Plex Mono, monospace',
            fontSize:      '9px',
            letterSpacing: '0.18em',
            color:         '#4a4a4a',
            marginBottom:  '16px',
          }}>
            AI ANALYSIS
          </div>

          {/* Summary */}
          <div style={{
            fontFamily:   'Instrument Serif, serif',
            fontSize:     '15px',
            lineHeight:   '1.7',
            color:        '#b0aea8',
            marginBottom: '28px',
          }}>
            {ai_analysis.summary}
          </div>

          {/* Sub-fields */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', marginBottom: '24px' }}>
            {[
              { key: 'WHAT IS CONFIRMED',             value: ai_analysis.what_is_confirmed },
              { key: 'WHAT IS DISPUTED',              value: ai_analysis.what_is_disputed },
              { key: 'WHERE INFORMATION GOES DARK',   value: ai_analysis.where_information_goes_dark },
              { key: 'CORE DISAGREEMENT',             value: ai_analysis.core_disagreement },
            ].map(({ key, value }) => (
              <div key={key}>
                <div style={{
                  fontFamily:    'IBM Plex Mono, monospace',
                  fontSize:      '9px',
                  letterSpacing: '0.14em',
                  color:         '#4a4a4a',
                  marginBottom:  '6px',
                }}>
                  {key}
                </div>
                <div style={{
                  fontFamily: 'Instrument Serif, serif',
                  fontSize:   '13px',
                  lineHeight: '1.5',
                  color:      value ? '#b0aea8' : '#3a3a3a',
                }}>
                  {value || '—'}
                </div>
              </div>
            ))}
          </div>

          {/* Narrative divergence bar */}
          <DivergenceBar score={ai_analysis.divergence_score} />
        </section>

        {/* ── Perspective article board ─────────────────────────────────────── */}
        <section style={{ marginBottom: '48px' }}>
          <div style={{
            fontFamily:    'IBM Plex Mono, monospace',
            fontSize:      '9px',
            letterSpacing: '0.18em',
            color:         '#4a4a4a',
            marginBottom:  '16px',
          }}>
            PERSPECTIVE BOARD
          </div>

          <div style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap:                 '12px',
          }}>
            {CATEGORIES.map(cat => {
              const color   = CATEGORY_COLORS[cat]
              const label   = CATEGORY_LABELS[cat]
              const signals = signals_by_category[cat] ?? []

              return (
                <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {/* Column header */}
                  <div style={{
                    fontFamily:    'IBM Plex Mono, monospace',
                    fontSize:      '9px',
                    letterSpacing: '0.14em',
                    color,
                    paddingBottom: '8px',
                    borderBottom:  `1px solid ${color}18`,
                    marginBottom:  '2px',
                  }}>
                    {label}
                  </div>

                  {signals.length === 0 ? (
                    <div style={{
                      color:      '#2a2a2a',
                      fontFamily: 'IBM Plex Mono, monospace',
                      fontSize:   '12px',
                      textAlign:  'center',
                      paddingTop: '10px',
                    }}>
                      —
                    </div>
                  ) : (
                    signals.map(sig => (
                      <SignalCard
                        key={sig.id}
                        signal={sig}
                        accentColor={color}
                      />
                    ))
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Photo evidence ─────────────────────────────────────────────────── */}
        <section style={{ marginBottom: '36px' }}>
          <div style={{
            fontFamily:    'IBM Plex Mono, monospace',
            fontSize:      '9px',
            letterSpacing: '0.18em',
            color:         '#4a4a4a',
            marginBottom:  '10px',
          }}>
            PHOTO EVIDENCE
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
            {/* Provenance note */}
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#3a3a3a', letterSpacing: '0.12em', marginBottom: '12px' }}>
              UNVERIFIED MEDIA · ATTACHED TO SOURCE COVERAGE
            </div>
            {photos.length === 0 ? (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#2a2a2a', textAlign: 'center', padding: '20px 0' }}>
                No photo evidence linked yet.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '8px' }}>
                {photos.map((photo: PhotoItem) => (
                  <div
                    key={photo.id}
                    onClick={() => {
                      const target = photo.source_page_url || photo.url
                      if (target) window.open(target, '_blank')
                    }}
                    style={{ flexShrink: 0, width: '180px', cursor: 'pointer' }}
                  >
                    <img
                      src={photo.url}
                      alt={photo.caption ?? photo.source}
                      loading="lazy"
                      style={{ width: '180px', height: '110px', objectFit: 'cover', display: 'block', background: 'rgba(255,255,255,0.04)' }}
                    />
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#4a4a4a', marginTop: '5px', letterSpacing: '0.08em' }}>
                      {photo.source.toUpperCase()} ↗
                    </div>
                    {photo.caption && (
                      <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: '10px', color: '#3a3a3a', marginTop: '3px', lineHeight: 1.4 }}>
                        {photo.caption}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Video evidence ─────────────────────────────────────────────────── */}
        <section style={{ marginBottom: '36px' }}>
          <div style={{
            fontFamily:    'IBM Plex Mono, monospace',
            fontSize:      '9px',
            letterSpacing: '0.18em',
            color:         '#4a4a4a',
            marginBottom:  '10px',
          }}>
            VIDEO EVIDENCE
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
            {/* Provenance note */}
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#3a3a3a', letterSpacing: '0.12em', marginBottom: '12px' }}>
              UNVERIFIED MEDIA · ATTACHED TO SOURCE COVERAGE
            </div>
            {videos.length === 0 ? (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#2a2a2a', textAlign: 'center', padding: '20px 0' }}>
                No video evidence linked yet.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '8px' }}>
                {videos.map((video: VideoItem) => (
                  <div
                    key={video.id}
                    onClick={() => {
                      const target = video.source_page_url || video.url
                      if (target) window.open(target, '_blank')
                    }}
                    style={{ flexShrink: 0, width: '180px', cursor: 'pointer', position: 'relative' }}
                  >
                    {video.thumbnail_url ? (
                      <img
                        src={video.thumbnail_url}
                        alt={video.source}
                        loading="lazy"
                        style={{ width: '180px', height: '110px', objectFit: 'cover', display: 'block', background: 'rgba(255,255,255,0.04)' }}
                      />
                    ) : (
                      <div style={{ width: '180px', height: '110px', background: 'rgba(255,255,255,0.04)' }} />
                    )}
                    <div style={{
                      position: 'absolute', top: 0, left: 0, width: '180px', height: '110px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(0,0,0,0.35)',
                    }}>
                      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '18px', color: 'rgba(255,255,255,0.7)' }}>▶</div>
                    </div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: '#4a4a4a', marginTop: '5px', letterSpacing: '0.08em' }}>
                      {video.source.toUpperCase()} ↗
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

      </div>

      {/* ── Events sidebar ──────────────────────────────────────────────────── */}
      <div style={{
        position:   'fixed',
        top:        0,
        right:      0,
        height:     '100vh',
        width:      '252px',
        transform:  sidebarOpen ? 'translateX(0)' : 'translateX(224px)',
        transition: 'transform 350ms ease',
        display:    'flex',
        zIndex:     200,
        pointerEvents: 'auto',
      }}>
        {/* Toggle tab */}
        <div
          onClick={() => setSidebarOpen(o => !o)}
          style={{
            width:          '28px',
            flexShrink:     0,
            background:     'rgba(10,10,14,0.97)',
            borderLeft:     '1px solid rgba(255,255,255,0.08)',
            borderTop:      '1px solid rgba(255,255,255,0.06)',
            borderBottom:   '1px solid rgba(255,255,255,0.06)',
            cursor:         'pointer',
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            '10px',
            userSelect:     'none',
          }}
        >
          <span style={{
            fontFamily:      'IBM Plex Mono, monospace',
            fontSize:        '8px',
            letterSpacing:   '0.18em',
            color:           '#3a3a3a',
            writingMode:     'vertical-rl',
            textOrientation: 'mixed',
            transform:       'rotate(180deg)',
          }}>
            EVENTS
          </span>
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize:   '11px',
            color:      '#3a3a3a',
          }}>
            {sidebarOpen ? '›' : '‹'}
          </span>
        </div>

        {/* Panel */}
        <div style={{
          flex:       1,
          background: 'rgba(10,10,14,0.97)',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          overflowY:  'auto',
          paddingTop: '16px',
        }}>
          <div style={{
            fontFamily:    'IBM Plex Mono, monospace',
            fontSize:      '9px',
            letterSpacing: '0.18em',
            color:         '#3a3a3a',
            padding:       '0 14px 10px',
            borderBottom:  '1px solid rgba(255,255,255,0.04)',
            marginBottom:  '6px',
          }}>
            RECENT EVENTS
          </div>

          {recentEvents.map(ev => {
            const isActive = ev.event_id === id
            const evColor  = EVENT_TYPE_COLORS[ev.event_type] ?? '#8a8a8a'
            return (
              <div
                key={ev.event_id}
                onClick={() => {
                  if (!isActive) window.location.href = `/event/${ev.event_id}`
                }}
                style={{
                  padding:     '8px 14px 8px 12px',
                  cursor:      isActive ? 'default' : 'pointer',
                  background:  isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
                  borderLeft:  isActive ? `2px solid ${evColor}` : '2px solid transparent',
                  transition:  'background 180ms ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <span style={{
                    fontFamily:    'IBM Plex Mono, monospace',
                    fontSize:      '8px',
                    letterSpacing: '0.1em',
                    color:         evColor,
                    border:        `1px solid ${evColor}40`,
                    borderRadius:  '2px',
                    padding:       '1px 4px',
                    flexShrink:    0,
                  }}>
                    {ev.event_type}
                  </span>
                  <span style={{
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize:   '8px',
                    color:      '#2e2e2e',
                    marginLeft: 'auto',
                    flexShrink: 0,
                  }}>
                    {relativeTime(ev.newest_signal_at)}
                  </span>
                </div>
                <div style={{
                  fontFamily:           'Instrument Serif, serif',
                  fontSize:             '11px',
                  color:                isActive ? '#6a6a6a' : '#4a4a4a',
                  lineHeight:           1.35,
                  overflow:             'hidden',
                  display:              '-webkit-box',
                  WebkitLineClamp:      2,
                  WebkitBoxOrient:      'vertical',
                }}>
                  {ev.headline_hint || ev.event_type}
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}

// ── Divergence bar ─────────────────────────────────────────────────────────────

function DivergenceBar({ score }: { score: number }) {
  const pct   = Math.min(1, Math.max(0, score)) * 100
  const color = score < 0.33 ? '#27ae60' : score < 0.66 ? '#d4a017' : '#c0392b'

  return (
    <div>
      <div style={{
        display:       'flex',
        alignItems:    'center',
        justifyContent: 'space-between',
        marginBottom:  '6px',
      }}>
        <span style={{
          fontFamily:    'IBM Plex Mono, monospace',
          fontSize:      '9px',
          letterSpacing: '0.14em',
          color:         '#4a4a4a',
        }}>
          NARRATIVE DIVERGENCE
        </span>
        <span style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize:   '9px',
          color,
        }}>
          {score.toFixed(2)}
        </span>
      </div>
      <div style={{
        height:       '2px',
        background:   'rgba(255,255,255,0.06)',
        borderRadius: '1px',
        overflow:     'hidden',
      }}>
        <div style={{
          height:      '100%',
          width:       `${pct}%`,
          background:  color,
          transition:  'width 600ms ease',
        }} />
      </div>
    </div>
  )
}

// ── Signal card ────────────────────────────────────────────────────────────────

function SignalCard({
  signal,
  accentColor,
}: {
  signal:      { id: string; source: string; article_url: string | null; published_at: string | null; description: string | null }
  accentColor: string
}) {
  const [hovered, setHovered] = useState(false)

  function handleClick() {
    if (signal.article_url) window.open(signal.article_url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding:      '8px 8px 6px',
        borderRadius: '2px',
        background:   hovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)',
        border:       '1px solid rgba(255,255,255,0.05)',
        cursor:       signal.article_url ? 'pointer' : 'default',
        transition:   'background 200ms ease',
      }}
    >
      {/* Source name */}
      <div style={{
        fontFamily:    'IBM Plex Mono, monospace',
        fontSize:      '9px',
        letterSpacing: '0.1em',
        fontWeight:    600,
        color:         accentColor,
        marginBottom:  '4px',
        textTransform: 'uppercase',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
        whiteSpace:    'nowrap',
      }}>
        {signal.source}
      </div>

      {/* Description — 3-line clamp */}
      <div style={{
        fontFamily:      'Instrument Serif, serif',
        fontSize:        '12px',
        lineHeight:      '1.45',
        color:           '#b0aea8',
        display:         '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
        overflow:        'hidden',
        marginBottom:    '6px',
      }}>
        {signal.description || '—'}
      </div>

      {/* Bottom row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize:   '9px',
          color:      '#8a8a8a',
          flex:       1,
        }}>
          {relativeTime(signal.published_at)}
        </span>

        {signal.article_url && (
          <span style={{
            color:    '#64b5f6',
            fontSize: '10px',
            opacity:  hovered ? 0.9 : 0.35,
            transition: 'opacity 200ms ease',
            lineHeight: 1,
          }}>
            ↗
          </span>
        )}
      </div>
    </div>
  )
}

// ── Error page ─────────────────────────────────────────────────────────────────

function ErrorPage({ message }: { message: string }) {
  const router = useRouter()
  return (
    <div style={{
      height:         '100vh',
      overflowY:      'auto',
      background:     '#0a0a0e',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            '20px',
    }}>
      <div style={{
        fontFamily:    'IBM Plex Mono, monospace',
        fontSize:      '13px',
        letterSpacing: '0.16em',
        color:         '#4a4a4a',
      }}>
        {message}
      </div>
      <button
        onClick={() => router.back()}
        style={{
          fontFamily:    'IBM Plex Mono, monospace',
          fontSize:      '10px',
          letterSpacing: '0.12em',
          color:         '#8a8a8a',
          background:    'none',
          border:        'none',
          cursor:        'pointer',
          padding:       0,
        }}
      >
        ← PARALLAX
      </button>
    </div>
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function LoadingPage() {
  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: '#0a0a0e' }}>
      {/* Skeleton top bar */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        padding:      '18px 32px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ width: '80px', height: '12px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }} />
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 32px' }}>
        {/* Skeleton event header */}
        <div style={{ marginBottom: '40px' }}>
          <div style={{ width: '60px', height: '20px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginBottom: '12px' }} />
          <div style={{ width: '320px', height: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', marginBottom: '12px' }} />
          <div style={{ width: '240px', height: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '2px' }} />
        </div>

        {/* Skeleton AI analysis */}
        <div style={{ marginBottom: '48px' }}>
          <div style={{ width: '80px', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', marginBottom: '16px' }} />
          <div style={{ height: '12px', width: '95%', background: 'rgba(255,255,255,0.04)', borderRadius: '2px', marginBottom: '8px' }} />
          <div style={{ height: '12px', width: '88%', background: 'rgba(255,255,255,0.04)', borderRadius: '2px', marginBottom: '8px' }} />
          <div style={{ height: '12px', width: '75%', background: 'rgba(255,255,255,0.03)', borderRadius: '2px' }} />
        </div>

        {/* Skeleton 4-column grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i}>
              <div style={{ height: '8px', width: '60%', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginBottom: '10px' }} />
              <div style={{ height: '60px', background: 'rgba(255,255,255,0.03)', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.04)' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
