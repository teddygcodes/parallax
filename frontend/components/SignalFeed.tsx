'use client'

import { useEffect, useState, useCallback } from 'react'
import type { RecentSignal, SignalEventGroup } from '@/types'

interface SignalFeedProps {
  onSignalClick: (payload: {
    event_id: string
    event_type: string
    event_lat: number
    event_lng: number
    published_at: string | null
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

export default function SignalFeed({ onSignalClick }: SignalFeedProps) {
  const [groups, setGroups]           = useState<SignalEventGroup[]>([])
  const [loading, setLoading]         = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/signals/recent-grouped?limit=20')
      if (!res.ok) return
      const data: SignalEventGroup[] = await res.json()
      setGroups(data)
      setLastRefresh(new Date())
    } catch {
      // silent fail — stale data is acceptable
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchGroups()
    const interval = setInterval(fetchGroups, 30_000)
    return () => clearInterval(interval)
  }, [fetchGroups])

  return (
    <div style={{
      position:      'absolute',
      inset:         0,
      background:    '#0a0a0e',
      zIndex:        2,
      display:       'flex',
      flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '18px 32px 14px',
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

      {/* Scrollable event rows */}
      <div style={{
        flex:          1,
        overflowY:     'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.08) transparent',
      }}>
        {loading && <SkeletonRows />}

        {!loading && groups.length === 0 && (
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
            NO SIGNALS
          </div>
        )}

        {!loading && groups.map((group, idx) => (
          <EventRow
            key={group.event_id}
            group={group}
            onSignalClick={onSignalClick}
            isLast={idx === groups.length - 1}
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

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({
  group,
  onSignalClick,
  isLast,
}: {
  group:         SignalEventGroup
  onSignalClick: SignalFeedProps['onSignalClick']
  isLast:        boolean
}) {
  const typeColor = EVENT_TYPE_COLORS[group.event_type] ?? '#8a8a8a'

  return (
    <div style={{
      padding:      '20px 24px',
      borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)',
    }}>
      {/* Row header */}
      <div style={{
        display:       'flex',
        alignItems:    'center',
        gap:           '10px',
        marginBottom:  '14px',
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
          {group.event_type}
        </span>

        {/* Headline hint — muted subtitle, not a canonical label */}
        <span style={{
          fontFamily:   'Instrument Serif, serif',
          fontSize:     '13px',
          color:        '#8a8a8a',
          flex:         1,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>
          {group.headline_hint}
        </span>

        {/* Relative time of newest signal */}
        <span style={{
          fontFamily:    'IBM Plex Mono, monospace',
          fontSize:      '10px',
          color:         '#8a8a8a',
          flexShrink:    0,
          letterSpacing: '0.06em',
        }}>
          · {relativeTime(group.newest_signal_at)}
        </span>

        {/* Signal count — very muted */}
        {group.signal_count > 0 && (
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize:   '10px',
            color:      '#3a3a3a',
            flexShrink: 0,
          }}>
            {group.signal_count}
          </span>
        )}
      </div>

      {/* 4-column perspective grid */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap:                 '8px',
      }}>
        {CATEGORIES.map(cat => {
          const color   = CATEGORY_COLORS[cat]
          const label   = CATEGORY_LABELS[cat]
          const signals = group.signals_by_category[cat] ?? []

          return (
            <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {/* Column header */}
              <div style={{
                fontFamily:    'IBM Plex Mono, monospace',
                fontSize:      '9px',
                letterSpacing: '0.14em',
                color,
                paddingBottom: '6px',
                borderBottom:  `1px solid ${color}18`,
                marginBottom:  '2px',
              }}>
                {label}
              </div>

              {/* Cards or empty state */}
              {signals.length === 0 ? (
                <EmptyCell />
              ) : (
                signals.map(sig => (
                  <PerspectiveCard
                    key={sig.id}
                    signal={sig}
                    accentColor={color}
                    eventGroup={group}
                    onSignalClick={onSignalClick}
                  />
                ))
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Signal card ───────────────────────────────────────────────────────────────

function PerspectiveCard({
  signal,
  accentColor,
  eventGroup,
  onSignalClick,
}: {
  signal:        RecentSignal
  accentColor:   string
  eventGroup:    SignalEventGroup
  onSignalClick: SignalFeedProps['onSignalClick']
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={() => onSignalClick({
        event_id:    eventGroup.event_id,
        event_type:  eventGroup.event_type,
        event_lat:   eventGroup.event_lat,
        event_lng:   eventGroup.event_lng,
        published_at: signal.published_at,
      })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding:      '8px 8px 6px',
        borderRadius: '2px',
        background:   hovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)',
        border:       '1px solid rgba(255,255,255,0.05)',
        cursor:       'pointer',
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

      {/* Bottom row: timestamp · ↗ link (no event type badge — already in row header) */}
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
          <a
            href={signal.article_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              color:          '#64b5f6',
              fontSize:       '10px',
              textDecoration: 'none',
              flexShrink:     0,
              lineHeight:     1,
              opacity:        hovered ? 0.9 : 0.35,
              transition:     'opacity 200ms ease',
            }}
            title="Open source"
          >
            ↗
          </a>
        )}
      </div>
    </div>
  )
}

// ── Empty cell ────────────────────────────────────────────────────────────────

function EmptyCell() {
  return (
    <div style={{
      color:      '#2a2a2a',
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize:   '12px',
      textAlign:  'center',
      paddingTop: '10px',
    }}>
      —
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            padding:        '20px 24px',
            borderBottom:   '1px solid rgba(255,255,255,0.05)',
            animation:      `sigfeed-shimmer 1.8s ease-in-out infinite`,
            animationDelay: `${i * 0.2}s`,
          }}
        >
          {/* Skeleton row header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <div style={{ width: '48px', height: '16px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px' }} />
            <div style={{ width: '200px', height: '14px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }} />
            <div style={{ width: '50px', height: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '2px', marginLeft: 'auto' }} />
          </div>

          {/* Skeleton 4-column grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {[0, 1, 2, 3].map(j => (
              <div key={j} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={{ height: '8px', width: '60%', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginBottom: '8px' }} />
                <div style={{ padding: '8px', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '2px' }}>
                  <div style={{ height: '7px', width: '45%', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginBottom: '6px' }} />
                  <div style={{ height: '7px', width: '90%', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', marginBottom: '3px' }} />
                  <div style={{ height: '7px', width: '75%', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', marginBottom: '3px' }} />
                  <div style={{ height: '7px', width: '55%', background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
