"""
Celery application configuration for PARALLAX background workers.
"""
from celery import Celery
from .config import settings

celery_app = Celery(
    "parallax",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.beat_schedule = {
    # "ingest-acled-every-5-minutes" disabled — no ACLED_KEY, generates mock data
    # Re-enable once ACLED_KEY is set in environment
    "ingest-news-every-10-minutes": {
        "task": "backend.workers.news_worker.ingest_news_task",
        "schedule": 600.0,
    },
    "satellite-coverage-every-10-minutes": {
        "task": "backend.workers.satellite_worker.run_satellite_coverage_task",
        "schedule": 600.0,
    },
    "ingest-gdelt-every-15-minutes": {
        "task": "backend.workers.gdelt_worker.ingest_gdelt_task",
        "schedule": 900.0,
    },
    "ingest-reliefweb-every-6-hours": {
        "task": "backend.workers.reliefweb_worker.ingest_reliefweb_task",
        "schedule": 21600.0,
    },
    "ingest-hdx-every-24-hours": {
        "task": "backend.workers.hdx_worker.ingest_hdx_task",
        "schedule": 86400.0,
    },
    "ingest-media-every-20-minutes": {
        "task": "backend.workers.media_worker.ingest_media_task",
        "schedule": 1200.0,
    },
}
