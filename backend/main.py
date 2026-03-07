from fastapi import FastAPI
from .routers import health, events, ingest

app = FastAPI(title="PARALLAX API", version="0.1.0")
app.include_router(health.router)
app.include_router(events.router)
app.include_router(ingest.router)
