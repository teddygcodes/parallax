# PARALLAX

**Real-time global conflict intelligence. Where reality and narrative diverge.**

PARALLAX ingests live conflict event data, maps it to a 3D globe, and runs cross-source narrative analysis to surface where different actors disagree about what happened. It is not a news aggregator — it is an instrument for detecting divergence between what is reported, where it is reported from, and what can be verified.

---

## What it does

Each conflict event on the globe represents a cluster of signals: news articles, GDELT entries, humanitarian situation reports, satellite passes. PARALLAX compares those signals across source categories (Western press, state-aligned media, NGO reporting) and produces a divergence score — a numeric measure of how much the narrative has fractured around that event.

Three layers:
- **Physical war** — geolocated events on the globe, updated every 15 minutes
- **Information war** — the same events as seen across source categories
- **Truth war** — where the narratives diverge, and where information goes dark

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 · React 18 · TypeScript |
| 3D Globe | globe.gl 2.31 · three.js · three-globe |
| Heatmaps | deck.gl 9 (aggregation layers) |
| Animation | Framer Motion 11 |
| Styling | Tailwind CSS |
| Backend | FastAPI 0.111 · Python 3.11+ |
| Task queue | Celery 5.4 · Redis 7 |
| Database | PostgreSQL 16 · SQLAlchemy 2 · Alembic |
| AI analysis | Anthropic API (claude-sonnet-4-20250514) |
| Satellite TLE | satellite.js |
| Infrastructure | Docker Compose |

---

## Data sources

| Source | Type | Cadence | What it contributes |
|---|---|---|---|
| [GDELT 2.0](https://www.gdeltproject.org/) | Conflict events | Every 15 min | Geolocated violence events (codes 180–209) filtered to active conflict countries |
| [ReliefWeb](https://reliefweb.int/apidoc) | Humanitarian reports | Every 6 h | Situation reports enriched as signals on existing events |
| [UNOCHA HDX](https://data.humdata.org/) | Structured datasets | Every 24 h | Event-level conflict data when available |
| [NewsAPI](https://newsapi.org/) | News articles | Every 10 min | Multi-source article signals for narrative comparison |
| ACLED | Conflict events | Every 5 min | High-fidelity armed conflict data *(requires API key — disabled until key is set)* |
| Satellite TLE | Orbital passes | Every 10 min | Imaging opportunity windows for active events |

GDELT is the primary live feed. All sources are open except ACLED (free academic registration).

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Next.js Frontend                    │
│  Globe.tsx · NarrativePanel.tsx · SatelliteLayer.tsx    │
│  TensionLayer.tsx · HoverCard.tsx · GlobeControls.tsx   │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────────┐
│                    FastAPI Backend                       │
│  /events  /events/{id}/analysis  /events/{id}/signals   │
│  /events/{id}/brief  /health  /ingest/*                 │
└────────┬─────────────────────────────────┬──────────────┘
         │                                 │
┌────────▼────────┐              ┌─────────▼─────────────┐
│   PostgreSQL 16  │              │   Celery Workers       │
│                  │              │                        │
│  event           │◄─────────── │  gdelt_worker (15 min) │
│  signals         │             │  news_worker  (10 min) │
│  claims          │             │  satellite_worker      │
│  narrative_history│            │  reliefweb_worker (6h) │
└──────────────────┘             │  hdx_worker   (24h)    │
                                 │  acled_worker (disabled)│
┌─────────────────┐              └──────────┬─────────────┘
│   Redis 7        │◄─────────────────────── │
│  (Celery broker) │                         │ Anthropic API
└─────────────────┘                          │ (analysis on demand)
```

**Event clustering:** Events within 5 km, 60 minutes, and 0.7 type-similarity are merged into a single cluster. This prevents the globe from fragmenting a single incident into dozens of dots.

**Signal deduplication:** Every signal has a deterministic ID derived from event ID, source, and a composite key (URL + code + location). Rerunning any worker on unchanged data produces zero new rows.

**AI analysis:** When `ANTHROPIC_API_KEY` is set, clicking an event sends its signals to Claude with a structured prompt requesting confirmed facts, disputed claims, narrative dark spots, and a divergence score. Falls back to a data-derived summary when no key is present — no hardcoded strings.

---

## Features

**Globe**
- 3D WebGL globe powered by globe.gl and three.js
- Events rendered as pulsing arc points, color-coded by type
- Click any event to open the narrative panel
- Tension heatmap layer (deck.gl) showing conflict density

**Satellite layer**
- Live orbital pass calculations using TLE data and satellite.js
- Shows imaging opportunity windows for events currently under satellite coverage

**Narrative panel**
- Tabs: AUTO BRIEF · AI ANALYSIS · SOURCE THREADS
- **Auto Brief** — deterministic 90-word summary always available, no API key required
- **AI Analysis** — four structured fields: WHAT IS CONFIRMED · WHAT IS DISPUTED · WHERE INFORMATION GOES DARK · CORE DISAGREEMENT, plus a 0–1 divergence score and coordinated messaging flag
- **Source Threads** — signals grouped by source category with timestamps and article links

**Data pipeline**
- Celery beat scheduler running five workers on independent schedules
- All workers fail gracefully and log clearly — a network outage on one source does not affect others
- GDELT country filter (FIPS allowlist) prevents publisher-location geocoding artifacts from polluting the globe

---

## Setup

### Prerequisites

- Docker and Docker Compose
- Python 3.11+
- Node.js 18+

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL 16 on port 5432 and Redis 7 on port 6379.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your keys:

```env
ANTHROPIC_API_KEY=        # Required for AI analysis panel
NEWSAPI_KEY=              # Required for news signal ingestion
ACLED_EMAIL=              # Required for ACLED (disabled until set)
ACLED_KEY=                # Required for ACLED (disabled until set)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/parallax
REDIS_URL=redis://localhost:6379
```

GDELT, ReliefWeb, and HDX require no keys. The app runs without any keys — GDELT will ingest live data and the AI analysis panel will use a data-derived fallback.

### 3. Install backend dependencies

```bash
pip install -r backend/requirements.txt
```

### 4. Run database migrations

```bash
alembic upgrade head
```

### 5. Start the backend

```bash
uvicorn backend.main:app --reload --port 8000
```

### 6. Start Celery workers

Run worker and beat as separate processes (combined `--beat` flag fails on Python 3.12+ due to billiard):

```bash
celery -A backend.celery_app worker --pool=solo --loglevel=info &
celery -A backend.celery_app beat --loglevel=info &
```

### 7. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Health check

```bash
curl http://localhost:8000/health
# {"status":"healthy","db_connected":true,"redis_connected":true,"tables":4}
```

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | DB and Redis status |
| GET | `/events` | All events (seeds mock data if DB is empty) |
| GET | `/events/{id}/signals` | Raw signals for an event |
| GET | `/events/{id}/analysis` | AI divergence analysis |
| GET | `/events/{id}/brief` | 90-word auto brief |
| POST | `/ingest/test-cluster` | Manually trigger clustering |

---

## Project structure

```
PARALLAX/
├── backend/
│   ├── main.py               # FastAPI app + router registration
│   ├── celery_app.py         # Celery app + beat schedule
│   ├── config.py             # Settings (pydantic-settings)
│   ├── database.py           # SQLAlchemy session factory
│   ├── models/               # ORM models: event, signal, claims, narrative_history
│   ├── routers/              # events.py, health.py, ingest.py
│   ├── services/
│   │   ├── ai_analysis.py    # Anthropic integration + mock fallback
│   │   └── clustering.py     # Event clustering algorithm
│   └── workers/              # gdelt, news, satellite, reliefweb, hdx, acled
├── frontend/
│   ├── app/
│   │   ├── page.tsx          # Main orchestration
│   │   └── layout.tsx
│   └── components/
│       ├── Globe.tsx         # 3D globe
│       ├── NarrativePanel.tsx # Right panel (brief, analysis, threads)
│       ├── SatelliteLayer.tsx
│       ├── TensionLayer.tsx
│       └── HoverCard.tsx
├── docker-compose.yml
└── .env.example
```

---

## Roadmap

| Feature | Status |
|---|---|
| GDELT live ingestion with conflict-country filter | ✅ Complete |
| ReliefWeb humanitarian signal enrichment | ✅ Complete (pending appname approval) |
| AI divergence analysis (Claude) | ✅ Complete |
| Auto brief (deterministic fallback) | ✅ Complete |
| Satellite imaging opportunity layer | ✅ Complete |
| Source threads panel | ✅ Complete |
| ACLED high-fidelity event data | ⏳ Pending API key |
| NewsAPI multi-perspective coverage | ⏳ Pending API key |
| Evidence graph — visual link between claims and source signals | 🔲 Planned |
| Narrative replay — time-scrub through how coverage evolved | 🔲 Planned |
| Mobile layout | 🔲 Planned |

---

## Design

The UI is built to read as a Cold War situation room — dark background (`#0a0a0e`), Bebas Neue headers, IBM Plex Mono for data and timestamps, Instrument Serif for body text. Motion is slow (≥300ms), fade-only. No snappy transitions. The goal is weight, not responsiveness.

---

## License

MIT
