"""
NewsAPI Worker — ingests multi-perspective news articles every 10 minutes.
One broad page fetch per run (not per-event regional calls).
Attaches articles as Signal records to existing events via keyword matching.
Covers Western, Middle East, Russian, and OSINT source categories.
Requires NEWSAPI_KEY in environment. No mock fallback — logs and returns if key missing.
"""
import requests
from datetime import datetime, timezone
from urllib.parse import urlparse

from backend.models import Event, Signal, SourceCategory
from backend.workers.ingest_utils import make_signal_id, truncate
from backend.config import settings

NEWSAPI_URL  = "https://newsapi.org/v2/everything"
HEADERS      = {"User-Agent": "PARALLAX/news-ingestion"}

SEARCH_QUERY = (
    "war OR strike OR airstrike OR missile OR drone OR ceasefire OR offensive OR "
    "shelling OR casualties OR conflict OR military OR attack OR explosion"
)

# Outlet domains → SourceCategory string value.
# URL-based mapping is more reliable than source name string matching.
# Unknown domains default to WESTERN — temporary fallback due to enum limitations.
OUTLET_CATEGORY_MAP = {
    # WESTERN
    "reuters.com":          "WESTERN",
    "apnews.com":           "WESTERN",
    "bbc.com":              "WESTERN",
    "bbc.co.uk":            "WESTERN",
    "theguardian.com":      "WESTERN",
    "nytimes.com":          "WESTERN",
    "washingtonpost.com":   "WESTERN",
    "cnn.com":              "WESTERN",
    "nbcnews.com":          "WESTERN",
    "abcnews.go.com":       "WESTERN",
    "france24.com":         "WESTERN",
    "dw.com":               "WESTERN",
    # MIDDLE_EAST
    "aljazeera.com":        "MIDDLE_EAST",
    "middleeasteye.net":    "MIDDLE_EAST",
    "arabnews.com":         "MIDDLE_EAST",
    "timesofisrael.com":    "MIDDLE_EAST",
    "haaretz.com":          "MIDDLE_EAST",
    "daily-star.com.lb":    "MIDDLE_EAST",
    # RUSSIAN
    "tass.com":             "RUSSIAN",
    "rt.com":               "RUSSIAN",
    "sputniknews.com":      "RUSSIAN",
    "ria.ru":               "RUSSIAN",
    # OSINT
    "bellingcat.com":       "OSINT",
    "understandingwar.org": "OSINT",
    "kyivindependent.com":  "OSINT",
    "ukraineworld.org":     "OSINT",
}

# Keyword → location terms to match against existing signal descriptions.
CONFLICT_KEYWORDS = {
    "ukraine":       ["Ukraine", "Kyiv", "Kharkiv", "Donetsk", "Zaporizhzhia"],
    "kyiv":          ["Ukraine", "Kyiv"],
    "kharkiv":       ["Ukraine", "Kharkiv"],
    "donetsk":       ["Ukraine", "Donetsk"],
    "gaza":          ["Gaza", "Palestine"],
    "west bank":     ["West Bank", "Palestine"],
    "israel":        ["Israel"],
    "jerusalem":     ["Israel", "Jerusalem"],
    "syria":         ["Syria", "Damascus"],
    "damascus":      ["Syria", "Damascus"],
    "lebanon":       ["Lebanon", "Beirut"],
    "beirut":        ["Lebanon", "Beirut"],
    "yemen":         ["Yemen"],
    "iraq":          ["Iraq", "Baghdad"],
    "baghdad":       ["Iraq", "Baghdad"],
    "sudan":         ["Sudan"],
    "somalia":       ["Somalia"],
    "mali":          ["Mali"],
    "myanmar":       ["Myanmar"],
    "ethiopia":      ["Ethiopia"],
    "nigeria":       ["Nigeria"],
    "congo":         ["Congo", "DRC"],
    "afghanistan":   ["Afghanistan"],
    "pakistan":      ["Pakistan"],
    "russia":        ["Russia"],
    "haiti":         ["Haiti"],
    "libya":         ["Libya"],
}


def _extract_domain(url: str) -> str | None:
    """Extract bare domain from URL, stripping www. Returns None on failure.
    endswith() loop in _get_source_category handles subdomains (e.g. edition.cnn.com).
    """
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return None


def _get_source_category(url: str | None) -> str:
    """Map article URL domain to a SourceCategory string value.
    Unknown domains default to WESTERN — temporary fallback due to enum limitations.
    """
    if not url:
        return "WESTERN"
    domain = _extract_domain(url)
    if not domain:
        return "WESTERN"
    if domain in OUTLET_CATEGORY_MAP:
        return OUTLET_CATEGORY_MAP[domain]
    for known, category in OUTLET_CATEGORY_MAP.items():
        if domain == known or domain.endswith("." + known):
            return category
    return "WESTERN"  # fallback — may overclassify unknown outlets as Western


def _find_matching_events(db, article_text: str) -> list:
    """
    Return up to 2 best-matching events for this article.
    Events are scored by number of unique matched location terms.
    Uses two flat queries (events + signals) — no per-event N+1.
    Keyword routing is heuristic — article is skipped if no existing event text matches.
    """
    text_lower = article_text.lower()
    matched_terms = []

    for keyword, location_terms in CONFLICT_KEYWORDS.items():
        if keyword in text_lower:
            matched_terms.extend(location_terms)

    if not matched_terms:
        return []

    # Load all events and all their signals in two queries.
    # .in_(event_ids) is acceptable at current event volume; chunk if events grow materially.
    all_events = db.query(Event).all()
    if not all_events:
        return []

    event_ids = [e.id for e in all_events]
    all_signals = db.query(Signal).filter(Signal.event_id.in_(event_ids)).all()

    # Group signal text by event_id in Python — no further DB calls
    signal_text_by_event: dict[str, str] = {}
    for s in all_signals:
        existing = signal_text_by_event.get(s.event_id, "")
        signal_text_by_event[s.event_id] = (
            existing
            + " " + (s.description or "")
            + " " + (s.coordinates_mentioned or "")
        ).lower()

    # Deduplicate terms before scoring — prevents overcount from overlapping keywords
    unique_terms = {term.lower() for term in matched_terms}

    # Score each event by number of unique matched location terms
    scored = []
    for event in all_events:
        event_text = signal_text_by_event.get(event.id, "")
        hit_count = sum(1 for term in unique_terms if term in event_text)
        if hit_count > 0:
            scored.append((hit_count, event))

    # Sort by match strength descending, return top 2
    scored.sort(key=lambda x: x[0], reverse=True)
    return [ev for _, ev in scored[:2]]


def _fetch_articles() -> list[dict]:
    """Fetch conflict articles from NewsAPI — one broad page per run.
    Returns empty list on any failure, including rate limits.
    """
    if not settings.newsapi_key:
        print("[news_worker] NEWSAPI_KEY not set — skipping.")
        return []

    try:
        resp = requests.get(
            NEWSAPI_URL,
            params={
                "q":        SEARCH_QUERY,
                "language": "en",
                "sortBy":   "publishedAt",
                "pageSize": 100,
                "apiKey":   settings.newsapi_key,
            },
            timeout=20,
            headers=HEADERS,
        )
        if resp.status_code == 429:
            print("[news_worker] Rate limited (429) — skipping.")
            return []
        resp.raise_for_status()
        data = resp.json()

        if data.get("status") != "ok":
            print(f"[news_worker] API error: {data.get('message', 'unknown')} — skipping.")
            return []

        return data.get("articles", [])

    except Exception as exc:
        print(f"[news_worker] Fetch failed: {exc} — skipping.")
        return []


def ingest_news(db) -> None:
    articles = _fetch_articles()
    if not articles:
        return

    inserted = 0
    skipped_no_match = 0

    for article in articles:
        try:
            title        = article.get("title") or ""
            description  = article.get("description") or ""
            url          = article.get("url") or None
            source_name  = (article.get("source") or {}).get("name") or "Unknown"
            published    = article.get("publishedAt") or ""

            if not title or not url:
                continue

            ts = None
            if published:
                try:
                    ts = datetime.fromisoformat(published.replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                except ValueError:
                    pass
            if not ts:
                # Deterministic fallback — avoids published_at instability across reruns
                ts = datetime(1970, 1, 1, tzinfo=timezone.utc)

            article_text   = f"{title} {description}"
            matched_events = _find_matching_events(db, article_text)

            if not matched_events:
                skipped_no_match += 1
                continue

            source_category = _get_source_category(url)

            for event in matched_events:
                composite = f"{url}|{event.id}"
                # Use stable "NewsAPI" label (not source_name) for deterministic ID
                sig_id = make_signal_id(event.id, "NewsAPI", composite)

                if db.query(Signal).filter(Signal.id == sig_id).first():
                    continue

                full_desc = f"{title}. {description}" if description else title

                sig = Signal(
                    id=sig_id,
                    event_id=event.id,
                    source=source_name,
                    source_category=SourceCategory(source_category),
                    article_url=url,
                    published_at=ts,
                    raw_text=truncate(article_text, 400),
                    description=truncate(full_desc, 400),
                    coordinates_mentioned=None,
                )
                db.add(sig)
                inserted += 1

        except Exception as exc:
            print(f"[news_worker] Skipping article: {exc}")
            continue

    db.commit()
    print(
        f"[news_worker] Done — {inserted} signals inserted, "
        f"{skipped_no_match} articles skipped (no event match)."
    )


def ingest_news_task():
    """Celery-compatible entry point."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        ingest_news(db)
    finally:
        db.close()
