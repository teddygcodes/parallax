import type { EventsResponse, Signal, Analysis } from '@/types'

const BASE = '/api'

export async function fetchEvents(limit = 100, offset = 0): Promise<EventsResponse> {
  const res = await fetch(`${BASE}/events?limit=${limit}&offset=${offset}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`fetchEvents failed: ${res.status}`)
  return res.json()
}

export async function fetchSignals(eventId: string): Promise<Signal[]> {
  const res = await fetch(`${BASE}/events/${eventId}/signals`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`fetchSignals failed: ${res.status}`)
  return res.json()
}

export async function fetchAnalysis(eventId: string): Promise<Analysis> {
  const res = await fetch(`${BASE}/events/${eventId}/analysis`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`fetchAnalysis failed: ${res.status}`)
  return res.json()
}
