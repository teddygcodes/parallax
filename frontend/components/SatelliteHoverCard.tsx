'use client'

import { useRef, useEffect, useState } from 'react'
import type { SatellitePosition } from '@/types'

interface SatelliteHoverCardProps {
  satellite: SatellitePosition
  x: number
  y: number
}

function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(3)}°${latDir}  ${Math.abs(lng).toFixed(3)}°${lngDir}`
}

const CARD_WIDTH  = 240
const CARD_HEIGHT = 140

export default function SatelliteHoverCard({ satellite, x, y }: SatelliteHoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: CARD_WIDTH, h: CARD_HEIGHT })

  useEffect(() => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setDims({ w: rect.width || CARD_WIDTH, h: rect.height || CARD_HEIGHT })
    }
  }, [satellite])

  const left = Math.max(10, Math.min(x + 16, window.innerWidth  - dims.w - 10))
  const top  = Math.max(10, Math.min(y + 16, window.innerHeight - dims.h - 10))

  const coverageType = satellite.type === 'SAR' ? 'DAY/NIGHT' : 'DAYLIGHT ONLY'

  return (
    <div
      ref={cardRef}
      style={{
        position: 'absolute',
        left,
        top,
        width: CARD_WIDTH,
        background: 'rgba(10, 10, 14, 0.92)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
        padding: '12px 14px',
        pointerEvents: 'none',
        opacity: 1,
        transition: 'opacity 300ms ease',
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: '11px',
        letterSpacing: '0.08em',
        lineHeight: '1.7',
      }}
    >
      {/* Header row: name · type */}
      <div style={{ color: '#e8e6e0', marginBottom: '6px' }}>
        <span>{satellite.name}</span>
        <span style={{ color: '#8a8a8a', margin: '0 6px' }}>·</span>
        <span style={{ color: satellite.type === 'SAR' ? '#64b5f6' : '#8fcf8f' }}>
          {satellite.type}
        </span>
      </div>

      {/* Stale badge or ESTIMATED POSITION */}
      {satellite.isStale ? (
        <div style={{ color: '#c0392b', marginBottom: '4px', fontSize: '10px', letterSpacing: '0.1em' }}>
          ORBITAL DATA STALE
          <span style={{
            marginLeft: '8px',
            fontSize: '9px',
            background: 'rgba(192,57,43,0.18)',
            border: '1px solid rgba(192,57,43,0.4)',
            padding: '1px 5px',
            letterSpacing: '0.12em',
          }}>
            STALE
          </span>
        </div>
      ) : (
        <div style={{ color: '#8a8a8a', marginBottom: '2px', fontSize: '9px', letterSpacing: '0.14em' }}>
          ESTIMATED POSITION
        </div>
      )}

      {/* Coordinates */}
      {!satellite.isStale && (
        <div style={{ color: '#64b5f6', marginBottom: '2px' }}>
          {formatCoords(satellite.lat, satellite.lng)}
        </div>
      )}

      {/* Altitude + velocity */}
      <div style={{ color: '#8a8a8a', marginBottom: '8px', fontSize: '10px' }}>
        Alt: {Math.round(satellite.alt_km)}km  ·  {satellite.velocity_kms}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ color: '#8a8a8a' }}>Swath width:</span>
          <span style={{ color: '#64b5f6' }}>{satellite.swath_km}km</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#8a8a8a' }}>Coverage type:</span>
          <span style={{ color: '#64b5f6' }}>{coverageType}</span>
        </div>
      </div>
    </div>
  )
}
