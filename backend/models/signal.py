import enum
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Enum
from sqlalchemy.orm import relationship
from .base import Base

class SourceCategory(str, enum.Enum):
    WESTERN = "WESTERN"
    RUSSIAN = "RUSSIAN"
    MIDDLE_EAST = "MIDDLE_EAST"
    OSINT = "OSINT"
    LOCAL = "LOCAL"

class Signal(Base):
    __tablename__ = "signals"

    id = Column(String, primary_key=True)
    event_id = Column(String, ForeignKey("event.id"), nullable=False)
    source = Column(String, nullable=False)
    source_category = Column(Enum(SourceCategory), nullable=False)
    article_url = Column(String)
    published_at = Column(DateTime(timezone=True), nullable=False)
    raw_text = Column(Text)
    coordinates_mentioned = Column(String)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    event = relationship("Event", back_populates="signals")
