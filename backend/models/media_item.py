from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from .base import Base


class MediaItem(Base):
    __tablename__ = "media_items"

    id                  = Column(String, primary_key=True)
    event_id            = Column(String, ForeignKey("event.id"),   nullable=False, index=True)
    signal_id           = Column(String, ForeignKey("signals.id"), nullable=False, index=True)
    media_type          = Column(String, nullable=False)          # "PHOTO" or "VIDEO"
    source              = Column(String, nullable=False)
    source_category     = Column(String, nullable=False)          # string copy of SourceCategory.value
    origin_url          = Column(String, nullable=False)
    source_page_url     = Column(String, nullable=True)
    thumbnail_url       = Column(String, nullable=True)
    caption             = Column(String, nullable=True)
    alt_text            = Column(String, nullable=True)
    provider            = Column(String, nullable=False)          # ARTICLE_IMG | FIGURE_IMG | OG_IMAGE | YOUTUBE
    verification_status = Column(String, nullable=False, default="UNVERIFIED")
    position_index      = Column(Integer, nullable=True)
    width               = Column(Integer, nullable=True)
    height              = Column(Integer, nullable=True)
    # Use timezone-aware lambda — datetime.utcnow() returns a naive datetime
    created_at          = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    event  = relationship("Event",  backref="media_items")
    signal = relationship("Signal", backref="media_items")
