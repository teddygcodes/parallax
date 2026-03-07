'use client'

import type { ConflictEvent } from '@/types'

type EventType = ConflictEvent['event_type']

const TIME_PRESETS: { label: string; hours: number | undefined }[] = [
  { label: '12H', hours: 12 },
  { label: '24H', hours: 24 },
  { label: '72H', hours: 72 },
  { label: '1W',  hours: 168 },
]

const EVENT_TYPES: EventType[] = ['STRIKE', 'MISSILE', 'DRONE', 'NAVAL', 'TROOP']

interface GlobeControlsProps {
  timeWindowHours?: number
  onTimeWindowChange: (hours: number | undefined) => void
  visibleTypes: Set<EventType>
  onVisibleTypesChange: (types: Set<EventType>) => void
  onLivingEarthToggle: () => void
  satVisible: boolean
  onSatToggle: () => void
}

export default function GlobeControls({
  timeWindowHours,
  onTimeWindowChange,
  visibleTypes,
  onVisibleTypesChange,
  onLivingEarthToggle,
  satVisible,
  onSatToggle,
}: GlobeControlsProps) {
  function handleTimePreset(hours: number) {
    // Clicking the active preset deactivates it (show all)
    if (timeWindowHours === hours) {
      onTimeWindowChange(undefined)
    } else {
      onTimeWindowChange(hours)
    }
  }

  function handleTypeToggle(type: EventType) {
    const next = new Set(visibleTypes)
    if (next.has(type)) {
      next.delete(type)
    } else {
      next.add(type)
    }
    onVisibleTypesChange(next)
  }

  const baseButtonStyle: React.CSSProperties = {
    fontFamily: 'IBM Plex Mono, monospace',
    fontSize: '10px',
    letterSpacing: '0.12em',
    background: 'none',
    border: '1px solid rgba(255,255,255,0.06)',
    cursor: 'pointer',
    padding: '5px 10px',
    transition: 'color 300ms ease, border-color 300ms ease',
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        background: 'rgba(10, 10, 14, 0.6)',
        border: '1px solid rgba(255,255,255,0.12)',
        padding: '10px 20px',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      {/* Time Rewind presets */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '9px',
          letterSpacing: '0.14em',
          color: '#e8e6e0',
          marginRight: '4px',
        }}>
          REWIND
        </span>
        {TIME_PRESETS.map(({ label, hours }) => {
          const isActive = timeWindowHours === hours
          return (
            <button
              key={label}
              onClick={() => handleTimePreset(hours!)}
              style={{
                ...baseButtonStyle,
                color: '#e8e6e0',
                borderColor: isActive ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.08)' }} />

      {/* Event type toggles */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        {EVENT_TYPES.map((type) => {
          const isActive = visibleTypes.has(type)
          return (
            <button
              key={type}
              onClick={() => handleTypeToggle(type)}
              style={{
                ...baseButtonStyle,
                color: '#e8e6e0',
                borderColor: isActive ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)',
              }}
            >
              {type}
            </button>
          )
        })}
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.08)' }} />

      {/* Living Earth Mode */}
      <button
        onClick={onLivingEarthToggle}
        style={{
          ...baseButtonStyle,
          color: '#e8e6e0',
          letterSpacing: '0.14em',
        }}
      >
        LIVING EARTH
      </button>

      {/* SAT — imaging satellite pass overlay */}
      <button
        onClick={onSatToggle}
        title="Show imaging satellite passes (estimated)"
        style={{
          ...baseButtonStyle,
          color: '#e8e6e0',
          letterSpacing: '0.14em',
          borderColor: satVisible ? 'rgba(100,181,246,0.4)' : 'rgba(255,255,255,0.06)',
        }}
      >
        SAT
      </button>
    </div>
  )
}
