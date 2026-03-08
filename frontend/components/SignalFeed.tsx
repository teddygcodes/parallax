'use client'

import { useEffect, useState, useCallback } from 'react'
import type { EventSummaryCard } from '@/types'

interface SignalFeedProps {
  onEventClick: (payload: {
    event_id:         string
    event_type:       string
    event_lat:        number
    event_lng:        number
    newest_signal_at: string | null
  }) => void
}

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

export default function SignalFeed({ onEventClick }: SignalFeedProps) {
  const [cards, setCards]             = useState<EventSummaryCard[]>([])
  const [loading, setLoading]         = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchCards = useCallback(async () => {
    try {
      const res = await fetch('/api/events/recent-summaries?limit=20')
      if (!res.ok) return
      const data: EventSummaryCard[] = await res.json()
      setCards(data)
      setLastRefresh(new Date())
    } catch {
      // silent fail — stale data is acceptable
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCards()
    const interval = setInterval(fetchCards, 30_000)
    return () => clearInterval(interval)
  }, [fetchCards])

  return (
    <div style={{
      position:      'absolute',
      inset:         0,
      background:    '#0a0a0e',
      zIndex:        2,
      display:       'flex',
      flexDirection: 'column',
    }}>
      {/* Top bar — padding-top clears the tab nav (zIndex 300, ~top 24px) */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '68px 32px 14px',
        borderBottom:   '1px solid rgba(255,255,255,0.06)',
        flexShrink:     0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{
            fontFamily:    'IBM Plex Mono, monospace',
            fontSize:      '11px',
            letterSpacing: '0.18em',
            color:         '#e8e6e0',
          }}>
            SIGNAL FEED
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width:        '6px',
              height:       '6px',
              borderRadius: '50%',
              background:   '#27ae60',
              boxShadow:    '0 0 6px #27ae60',
              animation:    'sigfeed-pulse 2s ease-in-out infinite',
            }} />
            <span style={{
              fontFamily:    'IBM Plex Mono, monospace',
              fontSize:      '10px',
              letterSpacing: '0.12em',
              color:         '#27ae60',
            }}>
              LIVE
            </span>
          </div>
        </div>
        {lastRefresh && (
          <span style={{
            fontFamily:    'IBM Plex Mono, monospace',
            fontSize:      '10px',
            letterSpacing: '0.1em',
            color:         '#8a8a8a',
          }}>
            {relativeTime(lastRefresh.toISOString())}
          </span>
        )}
      </div>

      {/* Scrollable event cards */}
      <div style={{
        flex:           1,
        overflowY:      'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.08) transparent',
      }}>
        {loading && <SkeletonCards />}

        {!loading && cards.length === 0 && (
          <div style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            height:         '200px',
            fontFamily:     'IBM Plex Mono, monospace',
            fontSize:       '11px',
            color:          '#2a2a2a',
            letterSpacing:  '0.1em',
          }}>
            NO EVENTS
          </div>
        )}

        {!loading && cards.map((card, idx) => (
          <EventCard
            key={card.event_id}
            card={card}
            onEventClick={onEventClick}
            isLast={idx === cards.length - 1}
          />
        ))}
      </div>

      <style>{`
        @keyframes sigfeed-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
        @keyframes sigfeed-shimmer {
          0%, 100% { opacity: 0.25; }
          50%       { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

// ── Event card ─────────────────────────────────────────────────────────────────

function EventCard({
  card,
  onEventClick,
  isLast,
}: {
  card:         EventSummaryCard
  onEventClick: SignalFeedProps['onEventClick']
  isLast:       boolean
}) {
  const [hovered, setHovered] = useState(false)
  const typeColor = EVENT_TYPE_COLORS[card.event_type] ?? '#8a8a8a'

  return (
    <div
      onClick={() => onEventClick({
        event_id:         card.event_id,
        event_type:       card.event_type,
        event_lat:        card.event_lat,
        event_lng:        card.event_lng,
        newest_signal_at: card.newest_signal_at,
      })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding:      '20px 24px',
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)',
        background:   hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        cursor:       'pointer',
        transition:   'background 200ms ease',
      }}
    >
      {/* Header row */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          '10px',
        marginBottom: '12px',
      }}>
        {/* Event type badge */}
        <span style={{
          fontFamily:    'IBM Plex Mono, monospace',
          fontSize:      '9px',
          letterSpacing: '0.1em',
          color:         typeColor,
          border:        `1px solid ${typeColor}50`,
          borderRadius:  '2px',
          padding:       '2px 5px',
          flexShrink:    0,
        }}>
          {card.event_type}
        </span>

        {/* headline_hint — muted subtitle */}
        <span style={{
          fontFamily:   'Instrument Serif, serif',
          fontSize:     '13px',
          color:        '#8a8a8a',
          flex:         1,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>
          {card.headline_hint}
        </span>

        {/* Relative time */}
        <span style={{
          fontFamily:    'IBM Plex Mono, monospace',
          fontSize:      '10px',
          color:         '#8a8a8a',
          flexShrink:    0,
          letterSpacing: '0.06em',
        }}>
          · {relativeTime(card.newest_signal_at)}
        </span>
      </div>

      {/* AI summary */}
      <div style={{
        fontFamily:      'Instrument Serif, serif',
        fontSize:        '14px',
        lineHeight:      '1.6',
        color:           '#b0aea8',
        display:         '-webkit-box',
        WebkitLineClamp: 4,
        WebkitBoxOrient: 'vertical',
        overflow:        'hidden',
        marginBottom:    '14px',
      }}>
        {card.ai_summary}
      </div>

      {/* Coverage strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {CATEGORIES.map(cat => {
          const count = card.coverage_counts[cat] ?? 0
          const color = count > 0 ? CATEGORY_COLORS[cat] : '#3a3a3a'
          return (
            <span key={cat} style={{
              fontFamily:    'IBM Plex Mono, monospace',
              fontSize:      '9px',
              letterSpacing: '0.1em',
              color,
            }}>
              {CATEGORY_LABELS[cat]} {count}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function SkeletonCards() {
  return (
    <>
      {[0, 1, 2, 3].map(i => (
        <div
          key={i}
          style={{
            padding:        '20px 24px',
            borderBottom:   '1px solid rgba(255,255,255,0.05)',
            animation:      'sigfeed-shimmer 1.8s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        >
          {/* Skeleton header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ width: '48px', height: '16px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px' }} />
            <div style={{ flex: 1, height: '14px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }} />
            <div style={{ width: '50px', height: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '2px' }} />
          </div>
          {/* Skeleton AI summary block */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ height: '12px', width: '95%', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', marginBottom: '6px' }} />
            <div style={{ height: '12px', width: '85%', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', marginBottom: '6px' }} />
            <div style={{ height: '12px', width: '70%', background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
          </div>
          {/* Skeleton coverage strip */}
          <div style={{ display: 'flex', gap: '16px' }}>
            {[0, 1, 2, 3].map(j => (
              <div key={j} style={{ width: '56px', height: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
