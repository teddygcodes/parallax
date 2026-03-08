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
