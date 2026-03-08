"""
Media extraction worker — scrapes article pages linked to existing signals
and stores photo/video references as MediaItem records.

All extracted media is labeled UNVERIFIED — attached to source coverage, not
ground-truth evidence. The purpose is richer coverage previews on event detail
pages, not truth verification.

Known limitations (v1):
- processed-once: signals with existing MediaItems are never retried
  (failed fetches, logic improvements, or page changes won't backfill).
- MAX_SIGNALS window: oldest signals beyond 500 are never scraped without
  a future reprocess mode.
- Photo extraction is heuristic — expect some junk (headers, promo images).
  Labeling as UNVERIFIED is the product mitigation.
- Up to 500 outbound HTTP requests per run; expect timeouts and bot-blocking.
"""
import hashlib
import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from ..models import Signal, MediaItem

_YT_RE = re.compile(
    r'(?:youtu\.be/|youtube\.com/(?:watch\?v=|shorts/|embed/))([A-Za-z0-9_-]{11})'
)

_REJECT_URL_FRAGMENTS = (
    "pixel", "blank", "spacer", "icon", "logo", "button",
    "badge", "sprite", "tracking", "avatar", "ad.", "/ads/",
)

FETCH_TIMEOUT = 10    # seconds per page
MAX_SIGNALS   = 500   # signals scanned per run — newest-first
MAX_IMGS_PER  = 8     # max photo items stored per signal
MAX_VIDS_PER  = 3     # max video items stored per signal


# ── ID helpers ────────────────────────────────────────────────────────────────

def _make_media_id(event_id: str, signal_id: str, media_type: str, url_key: str) -> str:
    raw = f"media:v1:{event_id}:{signal_id}:{media_type}:{url_key[:120]}"
    return "MED-" + hashlib.md5(raw.encode()).hexdigest()[:12].upper()


# ── URL normalization ─────────────────────────────────────────────────────────

def _normalize_url(base_url: str, maybe_relative: str) -> str | None:
    """Resolve relative URLs against base_url. Return None if clearly invalid."""
    if not maybe_relative:
        return None
    if maybe_relative.startswith("data:"):
        return None
    if maybe_relative.startswith("//"):
        scheme = base_url.split(":")[0] if ":" in base_url else "https"
        return f"{scheme}:{maybe_relative}"
    if maybe_relative.startswith("http"):
        return maybe_relative
    return urljoin(base_url, maybe_relative)


# ── Image quality filter ──────────────────────────────────────────────────────

def _is_probably_content_image(url: str, width: int | None, height: int | None, alt: str | None) -> bool:
    """Return False for obvious logos, icons, tracking pixels."""
    if not url:
        return False
    url_lower = url.lower()
    for frag in _REJECT_URL_FRAGMENTS:
        if frag in url_lower:
            return False
    if width is not None and width < 100:
        return False
    if height is not None and height < 100:
        return False
    return True


def _safe_int(val) -> int | None:
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


# ── Image extraction ──────────────────────────────────────────────────────────

def _extract_images(html: str, base_url: str) -> list[dict]:
    """Extract candidate content images from parsed HTML.

    Priority:
      1. figure > img  (editorial photos with optional figcaption)
      2. article/main body img  (deduped against figure images)
      3. og:image fallback  (only if no body images found)
    """
    soup = BeautifulSoup(html, "html.parser")
    candidates = []
    position = 0

    # 1. figure > img (highest signal — editorial photos)
    for fig in soup.find_all("figure"):
        img = fig.find("img")
        if not img:
            continue
        src = _normalize_url(base_url, img.get("src") or img.get("data-src") or "")
        if not src:
            continue
        w = _safe_int(img.get("width"))
        h = _safe_int(img.get("height"))
        alt = (img.get("alt") or "").strip() or None
        cap_tag = fig.find(["figcaption", "caption"])
        caption = cap_tag.get_text(strip=True) if cap_tag else None
        if _is_probably_content_image(src, w, h, alt):
            candidates.append({
                "origin_url":    src,
                "alt_text":      alt,
                "caption":       caption,
                "width":         w,
                "height":        h,
                "position_index": position,
                "provider":      "FIGURE_IMG",
            })
            position += 1

    # 2. article/main body img
    # Note: BS4 find() does not interpret CSS attribute selectors like "[role=main]".
    # Use soup.find(attrs=...) for attribute matching — not CSS selector strings.
    body = (
        soup.find("article") or
        soup.find("main") or
        soup.find(attrs={"role": "main"}) or
        soup.find("body")
    )
    if body:
        for img in body.find_all("img"):
            src = _normalize_url(base_url, img.get("src") or img.get("data-src") or "")
            if not src:
                continue
            w = _safe_int(img.get("width"))
            h = _safe_int(img.get("height"))
            alt = (img.get("alt") or "").strip() or None
            if _is_probably_content_image(src, w, h, alt):
                # dedup against figure images already captured
                if not any(c["origin_url"] == src for c in candidates):
                    candidates.append({
                        "origin_url":    src,
                        "alt_text":      alt,
                        "caption":       None,
                        "width":         w,
                        "height":        h,
                        "position_index": position,
                        "provider":      "ARTICLE_IMG",
                    })
                    position += 1

    # 3. og:image fallback — only if no body images found
    if not candidates:
        og = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "og:image"})
        if og:
            src = og.get("content", "")
            if src and src.startswith("http"):
                candidates.append({
                    "origin_url":    src,
                    "alt_text":      None,
                    "caption":       None,
                    "width":         None,
                    "height":        None,
                    "position_index": 0,
                    "provider":      "OG_IMAGE",
                })

    return candidates[:MAX_IMGS_PER]


# ── YouTube detection ─────────────────────────────────────────────────────────

def _yt_item(vid_id: str, page_url: str) -> dict:
    return {
        "origin_url":    f"https://www.youtube.com/watch?v={vid_id}",
        "thumbnail_url": f"https://img.youtube.com/vi/{vid_id}/hqdefault.jpg",
        "provider":      "YOUTUBE",
        "caption":       None,
    }


def _extract_youtube_videos(html: str, page_url: str) -> list[dict]:
    """Detect YouTube video references in page HTML.

    Checks iframe src, anchor hrefs, and raw HTML text (catches JS-rendered
    or data- attribute references). Deduplicates by video ID.
    """
    found: dict[str, dict] = {}  # vid_id → item

    soup = BeautifulSoup(html, "html.parser")

    # iframe embeds
    for iframe in soup.find_all("iframe"):
        src = iframe.get("src") or ""
        m = _YT_RE.search(src)
        if m:
            vid_id = m.group(1)
            found[vid_id] = _yt_item(vid_id, page_url)

    # anchor hrefs
    for a in soup.find_all("a", href=True):
        m = _YT_RE.search(a["href"])
        if m:
            vid_id = m.group(1)
            found[vid_id] = _yt_item(vid_id, page_url)

    # raw HTML scan (catches JS-rendered or data- attributes)
    for m in _YT_RE.finditer(html):
        vid_id = m.group(1)
        if vid_id not in found:
            found[vid_id] = _yt_item(vid_id, page_url)

    return list(found.values())[:MAX_VIDS_PER]


# ── Core ingest ───────────────────────────────────────────────────────────────

def ingest_media(db: Session) -> None:
    inserted = 0
    skipped  = 0

    # Signals to process: non-GDELT, have non-null non-empty article_url, newest first, cap 500.
    # Use .isnot(None) — SQLAlchemy-idiomatic NULL check; also filter empty strings.
    signals = (
        db.query(Signal)
        .filter(
            Signal.article_url.isnot(None),
            Signal.article_url != "",
            Signal.source != "GDELT",
        )
        .order_by(Signal.published_at.desc())
        .limit(MAX_SIGNALS)
        .all()
    )

    # processed-once skip: any signal with an existing MediaItem row is never retried.
    # Consequence: failed fetches, logic improvements, and page changes don't backfill.
    # Documented limitation — acceptable for v1.
    existing_sids = {
        row[0] for row in
        db.query(MediaItem.signal_id).filter(
            MediaItem.signal_id.in_([s.id for s in signals])
        ).all()
    }

    # In-session dedup set — prevents duplicate db.add() calls within the same run.
    # Necessary because multiple signals can share the same article_url; both would
    # pass the existing_sids check and both would try to insert the same media_id.
    # Using a Python set is cheaper than per-item DB queries and collision-safe.
    session_ids: set[str] = set()

    for sig in signals:
        if sig.id in existing_sids:
            skipped += 1
            continue

        page_url = sig.article_url

        # Direct YouTube URL → treat as a video signal, skip page scraping
        yt_direct = _YT_RE.search(page_url or "")
        if yt_direct:
            vid_id   = yt_direct.group(1)
            item     = _yt_item(vid_id, page_url)
            media_id = _make_media_id(sig.event_id, sig.id, "VIDEO", vid_id)
            if media_id not in session_ids:
                session_ids.add(media_id)
                db.add(MediaItem(
                    id=media_id,
                    event_id=sig.event_id,
                    signal_id=sig.id,
                    media_type="VIDEO",
                    source=sig.source,
                    source_category=sig.source_category.value,
                    origin_url=item["origin_url"],
                    source_page_url=page_url,
                    thumbnail_url=item["thumbnail_url"],
                    caption=item["caption"],
                    alt_text=None,
                    provider="YOUTUBE",
                    verification_status="UNVERIFIED",
                    position_index=0,
                ))
                inserted += 1
            continue  # don't also scrape the YouTube page for images

        # Fetch article page
        try:
            resp = requests.get(page_url, timeout=FETCH_TIMEOUT, headers={
                "User-Agent": "Mozilla/5.0 (compatible; PARALLAX-media/1.0)"
            })
            if resp.status_code != 200:
                skipped += 1
                continue
            html = resp.text
        except Exception as exc:
            print(f"[media_worker] Fetch failed {page_url}: {exc}")
            skipped += 1
            continue

        # Extract images
        try:
            imgs = _extract_images(html, page_url)
        except Exception as exc:
            print(f"[media_worker] Image extract error {page_url}: {exc}")
            imgs = []

        for idx, img in enumerate(imgs):
            url_key  = img["origin_url"]
            media_id = _make_media_id(sig.event_id, sig.id, "PHOTO", url_key)
            if media_id in session_ids:
                continue
            session_ids.add(media_id)
            db.add(MediaItem(
                id=media_id,
                event_id=sig.event_id,
                signal_id=sig.id,
                media_type="PHOTO",
                source=sig.source,
                source_category=sig.source_category.value,
                origin_url=img["origin_url"],
                source_page_url=page_url,
                thumbnail_url=None,
                caption=img.get("caption"),
                alt_text=img.get("alt_text"),
                provider=img["provider"],
                verification_status="UNVERIFIED",
                position_index=img.get("position_index", idx),
                width=img.get("width"),
                height=img.get("height"),
            ))
            inserted += 1

        # Extract YouTube video references from page HTML
        try:
            vids = _extract_youtube_videos(html, page_url)
        except Exception as exc:
            print(f"[media_worker] Video extract error {page_url}: {exc}")
            vids = []

        for vid in vids:
            vid_id   = _YT_RE.search(vid["origin_url"]).group(1)
            media_id = _make_media_id(sig.event_id, sig.id, "VIDEO", vid_id)
            if media_id in session_ids:
                continue
            session_ids.add(media_id)
            db.add(MediaItem(
                id=media_id,
                event_id=sig.event_id,
                signal_id=sig.id,
                media_type="VIDEO",
                source=sig.source,
                source_category=sig.source_category.value,
                origin_url=vid["origin_url"],
                source_page_url=page_url,
                thumbnail_url=vid["thumbnail_url"],
                caption=vid.get("caption"),
                alt_text=None,
                provider="YOUTUBE",
                verification_status="UNVERIFIED",
                position_index=0,
            ))
            inserted += 1

    # Single commit at end — matches existing worker pattern (news_worker.py)
    db.commit()
    print(f"[media_worker] Done — {inserted} inserted, {skipped} skipped.")


# ── Celery entry point ────────────────────────────────────────────────────────

def ingest_media_task():
    """Celery-compatible entry point.

    Plain function — no @celery_app.task decorator. Registered in celery_app.py
    beat_schedule by dotted string path. This matches all existing workers
    (news_worker, gdelt_worker, reliefweb_worker, etc.) — confirmed pattern.
    """
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        ingest_media(db)
    finally:
        db.close()
