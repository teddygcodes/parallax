'use client'

import { useEffect, useRef } from 'react'
import type { ConflictEvent } from '@/types'

interface LivingEarthModeProps {
  events: ConflictEvent[]
  globeRef: React.RefObject<any>
  onExit: () => void
}

export default function LivingEarthMode({ events, globeRef, onExit }: LivingEarthModeProps) {
  const driftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function performCameraDrift() {
    const globe = globeRef.current
    if (!globe) return
    if (!events || events.length === 0) return

    // Sort by signal_count descending, pick from top 10
    const sorted = [...events].sort((a, b) => b.signal_count - a.signal_count)
    const topN = sorted.slice(0, Math.min(10, sorted.length))
    const target = topN[Math.floor(Math.random() * topN.length)]

    if (!target) return

    globe.pointOfView({ lat: target.lat, lng: target.lng, altitude: 2.5 }, 1500)
  }

  useEffect(() => {
    // Escape key exits Living Earth Mode
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', handleKeyDown)

    // Enable globe rotation on entering Living Earth Mode
    const ctrl = globeRef.current?.controls?.()
    if (ctrl) {
      ctrl.autoRotate = true
      ctrl.autoRotateSpeed = 0.1
    }

    // Camera drift every 90 seconds
    driftTimerRef.current = setInterval(() => {
      performCameraDrift()
    }, 90_000)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (driftTimerRef.current) {
        clearInterval(driftTimerRef.current)
        driftTimerRef.current = null
      }
      // Stop rotation when Living Earth Mode exits
      const ctrl = globeRef.current?.controls?.()
      if (ctrl) ctrl.autoRotate = false
    }
  }, [events, globeRef, onExit]) // eslint-disable-line react-hooks/exhaustive-deps

  // This component manages side effects only — renders nothing visible itself
  return null
}
