export type EventType = 'STRIKE' | 'MISSILE' | 'DRONE' | 'NAVAL' | 'TROOP'
export type ConfidenceLevel = 'VERIFIED' | 'LIKELY' | 'REPORTED' | 'UNCONFIRMED' | 'DISPUTED'
export type SourceCategory = 'WESTERN' | 'RUSSIAN' | 'MIDDLE_EAST' | 'OSINT' | 'LOCAL'

export interface ConflictEvent {
  id: string
  lat: number
  lng: number
  event_type: EventType
  confidence: ConfidenceLevel
  first_detection_time: string  // ISO UTC
  signal_count: number
}

export interface EventsResponse {
  total: number
  limit: number
  offset: number
  events: ConflictEvent[]
}

export interface Signal {
  id: string
  source: string
  source_category: SourceCategory
  published_at: string
  description: string | null
  article_url: string | null
}

// Used by the SIGNAL tab feed — includes event context for globe navigation
export interface RecentSignal {
  id: string
  event_id: string
  event_type: EventType
  event_lat: number
  event_lng: number
  source: string
  source_category: SourceCategory
  article_url: string | null
  published_at: string | null
  description: string | null
}

// Used by SIGNAL tab v2 — event-grouped perspective board
export interface SignalEventGroup {
  event_id: string
  event_type: string           // backend returns string enum value; cast to EventType at use site
  event_lat: number
  event_lng: number
  first_detection_time: string | null
  newest_signal_at: string | null  // use for relative-time in row header
  headline_hint: string            // muted subtitle from signal description — NOT a location label
  signal_count: number
  signals_by_category: {
    WESTERN:     RecentSignal[]
    RUSSIAN:     RecentSignal[]
    MIDDLE_EAST: RecentSignal[]
    OSINT:       RecentSignal[]
  }
}

// SIGNAL v3 — event discovery card (top-level feed)
export interface EventSummaryCard {
  event_id: string
  event_type: string
  event_lat: number
  event_lng: number
  first_detection_time: string | null
  newest_signal_at: string | null
  headline_hint: string
  ai_summary: string
  signal_count: number
  coverage_counts: {
    WESTERN:     number
    RUSSIAN:     number
    MIDDLE_EAST: number
    OSINT:       number
  }
}

// SIGNAL v3 — event detail investigation page payload
export interface EventDetailPayload {
  event: {
    event_id: string
    event_type: string
    event_lat: number
    event_lng: number
    first_detection_time: string | null
    newest_signal_at: string | null
    headline_hint: string
    signal_count: number
  }
  ai_analysis: {
    summary: string
    what_is_confirmed: string
    what_is_disputed: string
    where_information_goes_dark: string
    core_disagreement: string
    divergence_score: number
    coordinated_messaging_suspected: boolean
    perspective_notes: null
    evidence_gaps: string[]
  }
  signals_by_category: {
    WESTERN:     RecentSignal[]
    RUSSIAN:     RecentSignal[]
    MIDDLE_EAST: RecentSignal[]
    OSINT:       RecentSignal[]
  }
  photos: unknown[]
  videos: unknown[]
}

export interface Analysis {
  what_is_confirmed: string
  what_is_disputed: string
  where_information_goes_dark: string
  core_disagreement: string
  divergence_score: number
  coordinated_messaging_suspected: boolean
  satellite_coverage?: SatelliteCoverage[]
  next_opportunities?: NextOpportunity[]
}

export type SatelliteType = 'SAR' | 'OPTICAL' | 'OPTICAL_CONSTELLATION'

export interface SatellitePosition {
  norad: number | null   // null for constellation entries (Planet Dove) — never rendered on globe
  name: string
  type: SatelliteType
  swath_km: number
  lat: number
  lng: number
  alt_km: number
  velocity_kms: string   // "~7.5 km/s"
  isStale: boolean       // orbital data >24h old
  possibleCoverage: boolean
  pulse: boolean         // Living Earth Mode overlap highlight
  positionHistory: Array<{ lat: number; lng: number; ts: number }>  // last 30 positions
}

export interface SatelliteCoverage {
  satellite_name: string
  pass_type: SatelliteType
  last_pass_ago_seconds: number | null   // null = no recent pass
}

export interface NextOpportunity {
  satellite_name: string
  pass_type: SatelliteType
  in_seconds: number
}

export interface EventBrief {
  event_id: string
  brief: string
  generated_at: string
  cached: boolean
}

export type ThreadItemType =
  | 'article'
  | 'video'
  | 'thread'
  | 'statement'
  | 'image'
  | 'unknown'

export interface ThreadItem {
  type: ThreadItemType
  label: string
  url: string | null
}

export interface SourceThread {
  source: string
  source_category: string
  items: ThreadItem[]
}

export interface EventThreads {
  event_id: string
  source_threads: SourceThread[]
}
