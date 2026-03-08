# PARALLAX

Real-time global conflict intelligence — tracks kinetic events, cross-source signal coverage, and narrative divergence on an interactive 3D globe.

---

## What it is

PARALLAX ingests conflict data from four live sources, clusters raw reports into discrete events by type (strike, missile, drone, naval, troop), and plots them on a WebGL globe with animated per-type indicators. Each event accumulates signals from outlets across four editorial categories — Western, Russian, Middle East, and OSINT — so the same incident can be read across source perspectives in one view.

An Anthropic-backed analysis layer generates per-event divergence summaries comparing how different source categories frame the same incident. A satellite overlay computes real-time imaging opportunity windows using TLE propagation, showing which SAR and optical satellites are currently in position to observe active events.

---

## Architecture

**Backend** — FastAPI serves a REST API backed by PostgreSQL 16. SQLAlchemy 2 ORM with Alembic migrations. Five Celery tasks run on independent schedules via a Redis broker; a separate beat process drives the schedule. Each worker is a plain function registered by dotted string path in the beat schedule — no decorator required. All workers commit in a single transaction per run and fail gracefully; a network outage on one source does not affect others. The AI analysis service calls `claude-sonnet-4-20250514` via the Anthropic API on demand and caches results in the database. A media extraction worker scrapes photos and YouTube references from linked article pages using BeautifulSoup.

**Clustering** — Incoming signals are grouped into events by proximity (≤5 km), time window (≤60 min), and type similarity (≥0.7). This prevents a single incident from fragmenting into dozens of globe markers. Each event and signal has a deterministic ID derived from its source fields; re-running any worker on unchanged data produces zero new rows.

**Frontend** — Next.js 14 (App Router) with React 18 and TypeScript. The 3D globe is rendered by globe.gl 2.45 (WebGL via Three.js 0.183). Satellite positions are computed client-side using satellite.js TLE propagation against live orbital element data fetched through a backend proxy. deck.gl handles the tension heatmap layer overlaid on the globe. Framer Motion drives panel transitions. Tab state is synced to the URL so event detail pages are directly linkable.

---

## Data sources

| Source | Schedule | What it contributes |
|--------|----------|---------------------|
| **GDELT 2.0** | Every 15 min | Machine-coded conflict events (CAMEO codes 152–209) derived from global news in 100+ languages. Filtered to an allowlist of active conflict countries using FIPS 10-4 codes to suppress publisher-location geocoding artifacts. No API key required. |
| **NewsAPI** | Every 10 min | Article headlines and descriptions from named outlets (Reuters, AP, BBC, Al Jazeera, RT, Bellingcat, and others). Keyword-routed to existing events; outlet domain mapped to source category. |
| **ReliefWeb (UNOCHA)** | Every 6 hours | Humanitarian situation reports attached as signals to nearby existing events. Enrichment only — no new events are created. Proximity-gated to 200 km from an existing event. No API key required. |
| **HDX (Humanitarian Data Exchange)** | Every 24 hours | UNOCHA conflict fatality datasets in CSV format. Creates events and signals from structured tabular data. No API key required. |

---

## Key features

- Interactive 3D globe with animated ring indicators, color-coded per event type (STRIKE, MISSILE, DRONE, NAVAL, TROOP)
- Per-event signal feed grouped by source category — same incident, multiple editorial perspectives in one view
- AI-generated narrative analysis per event: confirmed facts, disputed claims, information dark spots, divergence score, and coordinated messaging flag — with a deterministic fallback when no API key is present
- Real-time satellite position overlay: TLE data fetched via backend proxy, propagated client-side with satellite.js, swath coverage computed against active events; Living Earth Mode highlights SAR/optical satellites currently able to observe active conflict zones
- Tension heatmap layer (deck.gl HeatmapLayer) built from event coordinates and confidence weights
- Media extraction: photos and YouTube references scraped from linked article pages, attached to event detail pages and labeled UNVERIFIED
- Signal deduplication: deterministic IDs derived from source fields; safe to re-run any worker without creating duplicate rows
- Satellite layer visibility and update interval adapt to mobile viewport width

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- PostgreSQL 16
- Redis 7
- Docker (optional, for running Postgres and Redis locally)

### 1. Clone

```bash
git clone https://github.com/teddygcodes/parallax.git
cd parallax
```

### 2. Start infrastructure

```bash
docker run -d --name parallax-pg \
  -e POSTGRES_DB=parallax \
  -e POSTGRES_USER=parallax \
  -e POSTGRES_PASSWORD=parallax \
  -p 5432:5432 postgres:16

docker run -d --name parallax-redis -p 6379:6379 redis:7
```

Or point `DATABASE_URL` and `REDIS_URL` at existing instances.

### 3. Backend environment

```bash
python -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
```

### 4. Set environment variables

Create a `.env` file in the project root (see [Environment variables](#environment-variables) below).

### 5. Apply database migrations

```bash
alembic upgrade head
```

### 6. Start the API server

```bash
uvicorn backend.main:app --reload --port 8000
```

### 7. Start Celery workers

Two separate processes are required — combined `--beat` is unreliable on Python 3.12+ due to billiard:

```bash
# Worker process
python -m celery -A backend.celery_app worker --pool=solo --loglevel=info &

# Beat scheduler
python -m celery -A backend.celery_app beat --loglevel=info &
```

### 8. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The frontend expects the API at `http://localhost:8000`.

---

## Environment variables

Create a `.env` file in the project root. Settings are loaded via `pydantic-settings`.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Required | PostgreSQL connection string. Example: `postgresql://parallax:parallax@localhost:5432/parallax` |
| `REDIS_URL` | Required | Redis connection string used as Celery broker and result backend. Example: `redis://localhost:6379/0` |
| `ANTHROPIC_API_KEY` | Required | API key for Claude. Used by the AI analysis service on event detail load. The analysis endpoint falls back to a deterministic data-derived summary if absent. |
| `NEWSAPI_KEY` | Optional | NewsAPI.org key. The news worker logs and skips silently if absent; GDELT, ReliefWeb, and HDX continue unaffected. |
| `ACLED_KEY` | Optional | ACLED API key. The ACLED worker is disabled in the beat schedule by default. When enabled and `ACLED_KEY` is absent, the worker generates 20 hardcoded mock events for development. |

---

## Project structure

```
parallax/
├── backend/
│   ├── main.py               # FastAPI app, router registration, CORS
│   ├── celery_app.py         # Celery app, worker registration, beat schedule
│   ├── config.py             # pydantic-settings config, reads .env
│   ├── database.py           # SQLAlchemy engine and session factory
│   ├── models/
│   │   ├── event.py          # Event, EventType, ConfidenceLevel
│   │   ├── signal.py         # Signal, SourceCategory
│   │   ├── claim.py          # Claim, ClaimStatus
│   │   ├── narrative.py      # NarrativeHistory
│   │   └── media_item.py     # MediaItem (photos and videos)
│   ├── routers/
│   │   └── events.py         # /events, /events/{id}/detail, /events/{id}/analysis
│   ├── services/
│   │   ├── ai_analysis.py    # Anthropic API call, deterministic fallback
│   │   └── clustering.py     # Event clustering (proximity + time + type)
│   ├── workers/
│   │   ├── gdelt_worker.py   # GDELT 2.0 — every 15 min
│   │   ├── news_worker.py    # NewsAPI — every 10 min
│   │   ├── reliefweb_worker.py # ReliefWeb — every 6 hours
│   │   ├── hdx_worker.py     # HDX — every 24 hours
│   │   ├── acled_worker.py   # ACLED — disabled, falls back to mock
│   │   ├── satellite_worker.py # Satellite coverage windows — every 10 min
│   │   ├── media_worker.py   # Photo/video extraction — every 20 min
│   │   └── ingest_utils.py   # Shared ID generation and parsing helpers
│   └── alembic/              # Migration history
└── frontend/
    ├── app/
    │   ├── page.tsx           # Main page, globe orchestration, tab state
    │   └── event/[id]/page.tsx # Event detail: signals, analysis, media
    ├── components/
    │   ├── Globe.tsx          # globe.gl WebGL globe, event rendering
    │   ├── SatelliteLayer.tsx # TLE fetch, satellite.js propagation, coverage
    │   ├── NarrativePanel.tsx # Right panel: brief, AI analysis, source threads
    │   ├── TensionLayer.tsx   # deck.gl heatmap overlay
    │   ├── GlobeControls.tsx  # Filter controls (type, time window, layers)
    │   ├── SignalFeed.tsx      # Event-grouped signal feed
    │   └── HoverCard.tsx      # Globe hover tooltip
    └── types/
        └── index.ts           # Shared TypeScript interfaces
```
