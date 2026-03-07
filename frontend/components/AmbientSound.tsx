'use client'

import { useEffect, useRef } from 'react'
import type { ConflictEvent } from '@/types'

interface AmbientSoundProps {
  events: ConflictEvent[]
  enabled: boolean
}

export default function AmbientSound({ events, enabled }: AmbientSoundProps) {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const prevEventIdsRef = useRef<Set<string>>(new Set())
  const userInteractedRef = useRef(false)

  // Track user interaction to comply with browser autoplay policy
  useEffect(() => {
    const handleInteraction = () => {
      userInteractedRef.current = true
    }
    window.addEventListener('click', handleInteraction, { once: true })
    window.addEventListener('keydown', handleInteraction, { once: true })
    return () => {
      window.removeEventListener('click', handleInteraction)
      window.removeEventListener('keydown', handleInteraction)
    }
  }, [])

  function playTone() {
    if (!userInteractedRef.current) return

    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext()
      }
      const ctx = audioCtxRef.current

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {/* ignore */})
      }

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 440
      osc.type = 'sine'
      gain.gain.setValueAtTime(0, ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.5)
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 3.0)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 3.0)
    } catch {
      // AudioContext unavailable in this environment — silent fail
    }
  }

  // Detect new significant events
  useEffect(() => {
    if (!enabled) return

    const currentIds = new Set(events.map(e => e.id))
    const newSignificant = events.filter(
      e =>
        !prevEventIdsRef.current.has(e.id) &&
        (e.confidence === 'VERIFIED' || e.confidence === 'LIKELY')
    )

    if (newSignificant.length > 0 && prevEventIdsRef.current.size > 0) {
      // Only play if we already had a baseline (skip on initial load)
      playTone()
    }

    prevEventIdsRef.current = currentIds
  }, [events, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {/* ignore */})
      }
    }
  }, [])

  return null
}
