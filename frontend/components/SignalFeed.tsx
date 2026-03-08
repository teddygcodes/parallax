'use client'

import { useEffect, useState, useCallback } from 'react'
import type { EventType, RecentSignal, SourceCategory } from '@/types'

interface SignalFeedProps {
  onSignalClick: (signal: RecentSignal) => void
}

const CATEGORIES: SourceCategory[] = ['WESTERN', 'RUSSIAN', 'MIDDLE_EAST', 'OSINT']

const CATEGORY_LABELS: Record<string, string> = {
  WESTERN:     'WESTERN',
  RUSSIAN:     'RUSSIAN',
  MIDDLE_EAST: 'MIDDLE EAST',
  OSINT:       'OSINT',
}

const CATEGORY_COLORS: Record<string, string> = {
  WESTERN:     '#e8e6e0',
  RUSSIAN:     '#c0392b',
  MIDDLE_EAST: '#d4a017',
  OSINT:       '#64b5f6',
}

const EVENT_TYPE_COLORS: Record<EventType, string> = {
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
  const [signals, setSignals]       = useState<RecentSignal[]>([])
  const [loading, setLoading]       = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/signals/recent?limit=200')
      if (!res.ok) return
      const data: RecentSignal[] = await res.json()
      setSignals(data)
      setLastRefresh(new Date())
    } catch {
      // silent fail — stale data is acceptable
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSignals()
    const interval = setInterval(fetchSignals, 30_000)
    return () => clearInterval(interval)
  }, [fetchSignals])

  const byCategory = CATEGORIES.reduce<Record<string, RecentSignal[]>>((acc, cat) => {
    acc[cat] = signals.filter(s => s.source_category === cat)
    return acc
  }, {})

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: '#0a0a0e',
      zIndex: 2,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '18px 32px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '11px',
            letterSpacing: '0.18em',
            color: '#e8e6e0',
          }}>
            SIGNAL FEED
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#27ae60',
              boxShadow: '0 0 6px #27ae60',
              animation: 'sigfeed-pulse 2s ease-in-out infinite',
            }} />
            <span style={{
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: '10px',
              letterSpacing: '0.12em',
              color: '#27ae60',
            }}>
              LIVE
            </span>
          </div>
        </div>
        {lastRefresh && (
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '10px',
            letterSpacing: '0.1em',
            color: '#8a8a8a',
          }}>
            {relativeTime(lastRefresh.toISOString())}
          </span>
        )}
      </div>

      {/* 4-column grid */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        overflow: 'hidden',
      }}>
        {CATEGORIES.map((cat, i) => {
          const color      = CATEGORY_COLORS[cat]
          const label      = CATEGORY_LABELS[cat]
          const catSignals = byCategory[cat] ?? []
          const isLast     = i === CATEGORIES.length - 1

          return (
            <div
              key={cat}
              style={{
                display: 'flex',
                flexDirection: 'column',
                borderRight: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)',
                overflow: 'hidden',
              }}
            >
              {/* Column header */}
              <div style={{
                padding: '12px 16px 10px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <div style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: color,
                  flexShrink: 0,
                }} />
                <span style={{
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontSize: '10px',
                  letterSpacing: '0.16em',
                  color,
                  fontWeight: 500,
                }}>
                  {label}
                </span>
                <span style={{
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontSize: '10px',
                  color: '#8a8a8a',
                  marginLeft: 'auto',
                }}>
                  {loading ? '·' : catSignals.length}
                </span>
              </div>

              {/* Signal list */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px 10px',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.08) transparent',
              }}>
                {loading && <SkeletonCards />}

                {!loading && catSignals.length === 0 && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '120px',
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: '13px',
                    color: '#2a2a2a',
                  }}>
                    —
                  </div>
                )}

                {!loading && catSignals.map(sig => (
                  <SignalCard
                    key={sig.id}
                    signal={sig}
                    accentColor={color}
                    onClick={() => onSignalClick(sig)}
                  />
                ))}
              </div>
            </div>
          )
        })}
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

function SignalCard({
  signal,
  accentColor,
  onClick,
}: {
  signal:      RecentSignal
  accentColor: string
  onClick:     () => void
}) {
  const [hovered, setHovered] = useState(false)
  const typeColor = EVENT_TYPE_COLORS[signal.event_type] ?? '#8a8a8a'

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding:      '10px 10px 8px',
        marginBottom: '5px',
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
        fontSize:      '10px',
        letterSpacing: '0.1em',
        fontWeight:    600,
        color:         accentColor,
        marginBottom:  '5px',
        textTransform: 'uppercase',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
        whiteSpace:    'nowrap',
      }}>
        {signal.source}
      </div>

      {/* Description */}
      <div style={{
        fontFamily:          'Instrument Serif, serif',
        fontSize:            '13px',
        lineHeight:          '1.45',
        color:               '#b0aea8',
        display:             '-webkit-box',
        WebkitLineClamp:     3,
        WebkitBoxOrient:     'vertical',
        overflow:            'hidden',
        marginBottom:        '8px',
      }}>
        {signal.description || '—'}
      </div>

      {/* Bottom row: type badge · time · link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span style={{
          fontFamily:    'IBM Plex Mono, monospace',
          fontSize:      '9px',
          letterSpacing: '0.08em',
          color:         typeColor,
          border:        `1px solid ${typeColor}50`,
          borderRadius:  '2px',
          padding:       '1px 4px',
          flexShrink:    0,
        }}>
          {signal.event_type}
        </span>

        <span style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize:   '10px',
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
              color:      '#64b5f6',
              fontSize:   '11px',
              textDecoration: 'none',
              flexShrink: 0,
              lineHeight: 1,
              opacity:    hovered ? 0.9 : 0.4,
              transition: 'opacity 200ms ease',
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

function SkeletonCards() {
  return (
    <>
      {[60, 85, 50].map((pct, i) => (
        <div
          key={i}
          style={{
            padding:       '10px 10px 8px',
            marginBottom:  '5px',
            borderRadius:  '2px',
            border:        '1px solid rgba(255,255,255,0.05)',
            animation:     `sigfeed-shimmer 1.8s ease-in-out infinite`,
            animationDelay: `${i * 0.25}s`,
          }}
        >
          <div style={{ height: '8px', width: '38%', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginBottom: '8px' }} />
          <div style={{ height: '8px', width: `${pct}%`, background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginBottom: '4px' }} />
          <div style={{ height: '8px', width: '90%',  background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginBottom: '4px' }} />
          <div style={{ height: '8px', width: '70%',  background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginBottom: '8px' }} />
          <div style={{ height: '7px', width: '30%',  background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
        </div>
      ))}
    </>
  )
}
