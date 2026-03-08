'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import type { ConflictEvent, EventType, SatellitePosition } from '@/types'
import HoverCard from '../components/HoverCard'
import GlobeControls from '../components/GlobeControls'
import LivingEarthMode from '../components/LivingEarthMode'
import RecordButton from '../components/RecordButton'
import AmbientSound from '../components/AmbientSound'
import SatelliteLayer from '../components/SatelliteLayer'
import SatelliteHoverCard from '../components/SatelliteHoverCard'
import type { GlobeHandle } from '../components/Globe'  // type only — not passed via ref
import SignalFeed from '../components/SignalFeed'

// Dynamic imports with ssr: false — must never run on server
const GlobeComponent = dynamic(() => import('../components/Globe'), { ssr: false })
const NarrativePanel = dynamic(() => import('../components/NarrativePanel'), { ssr: false })

type Tab = 'GLOBE' | 'SIGNAL'

type HoveredSatelliteState = {
  sat: SatellitePosition
  x: number
  y: number
} | null

export default function Home() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('GLOBE')

  // Sync tab to/from URL so back-button from event pages returns to the correct tab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (tab === 'SIGNAL' || tab === 'GLOBE') setActiveTab(tab as Tab)
  }, [])

  function switchTab(tab: Tab) {
    setActiveTab(tab)
    window.history.replaceState({}, '', tab === 'GLOBE' ? '/' : '/?tab=SIGNAL')
  }

  // Interaction state
  const [selectedEvent, setSelectedEvent] = useState<ConflictEvent | null>(null)
  const [hoveredEvent, setHoveredEvent] = useState<{ event: ConflictEvent; x: number; y: number } | null>(null)
  const [timeWindowHours, setTimeWindowHours] = useState<number | undefined>(undefined)
  const [visibleTypes, setVisibleTypes] = useState<Set<ConflictEvent['event_type']>>(
    new Set<EventType>(['STRIKE', 'MISSILE', 'DRONE', 'NAVAL', 'TROOP'])
  )

  // Living Earth Mode state
  const [isLivingEarth, setIsLivingEarth] = useState(false)
  const [currentEvents, setCurrentEvents] = useState<ConflictEvent[]>([])

  // Satellite state
  const [satVisible, setSatVisible] = useState<boolean>(false)
  const [satellitePositions, setSatellitePositions] = useState<SatellitePosition[]>([])
  const [hoveredSatellite, setHoveredSatellite] = useState<HoveredSatelliteState>(null)

  // Globe handle ref — exposes getGlobe(), pauseRefresh(), resumeRefresh()
  const globeHandleRef = useRef<GlobeHandle | null>(null)

  // Hover dismiss debounce — prevents card flash when cursor briefly leaves hitbox
  const hoverDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Globe dims when panel is open
  const globeDim = selectedEvent !== null

  // When entering Living Earth Mode, close any open NarrativePanel
  useEffect(() => {
    if (isLivingEarth) setSelectedEvent(null)
  }, [isLivingEarth])

  // Escape key exits Living Earth Mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isLivingEarth) setIsLivingEarth(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isLivingEarth])

  // Handle event hover — 200ms dismiss debounce so card stays reachable
  function handleEventHover(event: ConflictEvent | null, x: number, y: number) {
    if (hoverDismissRef.current) {
      clearTimeout(hoverDismissRef.current)
      hoverDismissRef.current = null
    }
    if (event) {
      setHoveredEvent({ event, x, y })
    } else {
      hoverDismissRef.current = setTimeout(() => {
        setHoveredEvent(null)
        hoverDismissRef.current = null
      }, 200)
    }
  }

  // Handle satellite hover
  function handleSatelliteHover(sat: SatellitePosition | null, x: number, y: number) {
    if (sat) {
      setHoveredSatellite({ sat, x, y })
    } else {
      setHoveredSatellite(null)
    }
  }

  // Handle event click — pin selected event, hide hover card
  function handleEventClick(event: ConflictEvent) {
    setSelectedEvent(event)
    setHoveredEvent(null)
    setHoveredSatellite(null)
  }

  // Close panel — clear selected event, globe returns to full brightness
  function handlePanelClose() {
    setSelectedEvent(null)
  }

  // Handle event click from the SIGNAL tab — navigate to the event detail page.
  function handleEventFromFeed(event: {
    event_id:         string
    event_type:       string
    event_lat:        number
    event_lng:        number
    newest_signal_at: string | null
  }) {
    router.push(`/event/${event.event_id}`)
  }

  // Receive current events from Globe for LivingEarthMode camera drift
  function handleEventsUpdate(events: ConflictEvent[]) {
    setCurrentEvents(events)
  }

  // Build a globeRef proxy for LivingEarthMode that wraps the handle
  const livingEarthGlobeRef = useRef<any>(null)

  // Keep livingEarthGlobeRef.current in sync with the actual globe instance
  useEffect(() => {
    // This ref is used by LivingEarthMode for pointOfView calls
    // We create a proxy object that delegates to globeHandleRef
    livingEarthGlobeRef.current = {
      pointOfView: (pov: { lat: number; lng: number; altitude: number }, duration: number) => {
        const globe = globeHandleRef.current?.getGlobe()
        if (globe) globe.pointOfView(pov, duration)
      },
      controls: () => globeHandleRef.current?.getGlobe()?.controls(),
    }
  }, [])

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: 'radial-gradient(ellipse at 40% 50%, #0d1520 0%, #0a0a0e 70%)',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* SatelliteLayer — always mounted, returns null (no UI) */}
      <SatelliteLayer
        events={currentEvents}
        satVisible={satVisible}
        isLivingEarth={isLivingEarth}
        onPositionsUpdate={setSatellitePositions}
      />

      {/* Globe is always mounted — rendered regardless of tab or mode */}
      <motion.div
        animate={{
          filter: globeDim && !isLivingEarth ? 'brightness(0.6)' : 'brightness(1)',
          x: '8%',
        }}
        transition={{ duration: 0.4 }}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      >
        <GlobeComponent
          onReady={(handle) => { globeHandleRef.current = handle }}
          onEventClick={handleEventClick}
          onEventHover={handleEventHover}
          timeWindowHours={timeWindowHours}
          visibleTypes={visibleTypes}
          onEventsUpdate={handleEventsUpdate}
          satellitePositions={satVisible ? satellitePositions : []}
          onSatelliteHover={handleSatelliteHover}
          isLivingEarth={isLivingEarth}
        />
      </motion.div>

      {/* Tab nav — hidden in Living Earth Mode */}
      {!isLivingEarth && (
        <nav style={{
          position: 'absolute',
          top: '24px',
          left: '32px',
          zIndex: 300,
          display: 'flex',
          gap: '36px',
        }}>
          {(['GLOBE', 'SIGNAL'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: '12px',
                letterSpacing: '0.16em',
                fontWeight: activeTab === tab ? 500 : 400,
                color: activeTab === tab ? '#e8e6e0' : '#8a8a8a',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                transition: 'color 600ms ease',
              }}
            >
              {tab}
            </button>
          ))}
        </nav>
      )}

      {/* Wordmark — hidden in Living Earth Mode */}
      {!isLivingEarth && (
        <div style={{
          position: 'absolute',
          top: '22px',
          right: '32px',
          zIndex: 300,
          fontFamily: 'Bebas Neue, sans-serif',
          fontSize: '18px',
          letterSpacing: '0.2em',
          color: '#e8e6e0',
          pointerEvents: 'none',
        }}>
          PARALLAX
        </div>
      )}

      {/* Globe tab chrome — hidden in Living Earth Mode */}
      {!isLivingEarth && activeTab === 'GLOBE' && (
        <>
          {/* HoverCard — above the dimmed globe, below narrative panel */}
          {hoveredEvent && !selectedEvent && (
            <div style={{
              position: 'absolute',
              inset: 0,
              zIndex: 50,
              pointerEvents: 'none',
            }}>
              <HoverCard
                event={hoveredEvent.event}
                x={hoveredEvent.x}
                y={hoveredEvent.y}
                onClick={() => handleEventClick(hoveredEvent.event)}
                onMouseEnter={() => {
                  if (hoverDismissRef.current) {
                    clearTimeout(hoverDismissRef.current)
                    hoverDismissRef.current = null
                  }
                }}
                onMouseLeave={() => setHoveredEvent(null)}
              />
            </div>
          )}

          {/* SatelliteHoverCard — mutually exclusive with event HoverCard */}
          {hoveredSatellite && !selectedEvent && !hoveredEvent && (
            <div style={{
              position: 'absolute',
              inset: 0,
              zIndex: 50,
              pointerEvents: 'none',
            }}>
              <SatelliteHoverCard
                satellite={hoveredSatellite.sat}
                x={hoveredSatellite.x}
                y={hoveredSatellite.y}
              />
            </div>
          )}

          {/* Click-outside backdrop — sits behind panel, closes it on globe click */}
          {selectedEvent && (
            <div
              onClick={handlePanelClose}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 199,
                cursor: 'default',
              }}
            />
          )}

          {/* NarrativePanel — slides in from right */}
          <AnimatePresence>
            {selectedEvent && (
              <NarrativePanel
                key={selectedEvent.id}
                event={selectedEvent}
                onClose={handlePanelClose}
                satVisible={satVisible}
              />
            )}
          </AnimatePresence>
        </>
      )}

      {/* GlobeControls — hidden in Living Earth Mode */}
      {!isLivingEarth && activeTab === 'GLOBE' && (
        <GlobeControls
          timeWindowHours={timeWindowHours}
          onTimeWindowChange={setTimeWindowHours}
          visibleTypes={visibleTypes}
          onVisibleTypesChange={setVisibleTypes}
          onLivingEarthToggle={() => setIsLivingEarth(prev => !prev)}
          satVisible={satVisible}
          onSatToggle={() => setSatVisible(prev => !prev)}
        />
      )}

      {/* SIGNAL tab — event discovery feed */}
      {!isLivingEarth && activeTab === 'SIGNAL' && (
        <SignalFeed onEventClick={handleEventFromFeed} />
      )}

      {/* Living Earth Mode orchestrator */}
      {isLivingEarth && (
        <LivingEarthMode
          events={currentEvents}
          globeRef={livingEarthGlobeRef}
          onExit={() => setIsLivingEarth(false)}
        />
      )}

      {/* Ambient Sound — active only in Living Earth Mode */}
      {isLivingEarth && (
        <AmbientSound
          events={currentEvents}
          enabled={isLivingEarth}
        />
      )}

      {/* RecordButton — visible only in Living Earth Mode */}
      {isLivingEarth && (
        <RecordButton globeHandle={globeHandleRef} />
      )}

      {/* Footer disclaimer — hidden in Living Earth Mode */}
      {!isLivingEarth && (
        <div style={{
          position: 'absolute',
          bottom: '8px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '0.7rem',
          color: '#8a8a8a',
          letterSpacing: '0.08em',
          pointerEvents: 'none',
          zIndex: 10,
          whiteSpace: 'nowrap',
        }}>
          Orbital positions approximate · Not official intelligence
        </div>
      )}
    </div>
  )
}
