'use client'

import { useRef, useEffect, useState } from 'react'
import type { ConflictEvent, ConfidenceLevel } from '@/types'

interface HoverCardProps {
  event: ConflictEvent
  x: number
  y: number
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
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
  return `${Math.abs(lat).toFixed(3)}°${latDir}  ${Math.abs(lng).toFixed(3)}°${lngDir}`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const hours   = d.getUTCHours().toString().padStart(2, '0')
  const minutes = d.getUTCMinutes().toString().padStart(2, '0')
  const months  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${hours}:${minutes} UTC  ·  ${months[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`
}

const CARD_WIDTH  = 240
const CARD_HEIGHT = 130

export default function HoverCard({ event, x, y, onClick, onMouseEnter, onMouseLeave }: HoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: CARD_WIDTH, h: CARD_HEIGHT })

  useEffect(() => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setDims({ w: rect.width || CARD_WIDTH, h: rect.height || CARD_HEIGHT })
    }
  }, [event])

  const left = Math.max(10, Math.min(x + 16, window.innerWidth  - dims.w - 10))
  const top  = Math.max(10, Math.min(y + 16, window.innerHeight - dims.h - 10))

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'absolute',
        left,
        top,
        width: CARD_WIDTH,
        background: 'rgba(10, 10, 14, 0.92)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
        padding: '12px 14px',
        pointerEvents: 'auto',
        cursor: onClick ? 'pointer' : 'default',
        opacity: 1,
        transition: 'opacity 300ms ease',
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: '11px',
        letterSpacing: '0.08em',
        lineHeight: '1.7',
      }}
    >
      {/* Header row: type · confidence */}
      <div style={{ color: '#e8e6e0', marginBottom: '6px' }}>
        <span>{event.event_type}</span>
        <span style={{ color: '#8a8a8a', margin: '0 6px' }}>·</span>
        <span>{mapConfidence(event.confidence)}</span>
      </div>

      {/* Coordinates */}
      <div style={{ color: '#64b5f6', marginBottom: '2px' }}>
        {formatCoords(event.lat, event.lng)}
      </div>

      {/* Timestamp */}
      <div style={{ color: '#8a8a8a', marginBottom: '8px', fontSize: '10px' }}>
        {formatDateTime(event.first_detection_time)}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#8a8a8a' }}>Signals received:</span>
          <span style={{ color: '#64b5f6' }}>{event.signal_count}</span>
        </div>
        {onClick && (
          <div style={{ color: '#8a8a8a', fontSize: '9px', letterSpacing: '0.14em', marginTop: '6px', textAlign: 'right' }}>
            CLICK TO OPEN →
          </div>
        )}
      </div>
    </div>
  )
}
