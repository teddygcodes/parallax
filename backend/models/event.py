import enum
from datetime import datetime
from sqlalchemy import Column, String, Float, DateTime, Enum, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from .base import Base

class EventType(str, enum.Enum):
    STRIKE = "STRIKE"
    MISSILE = "MISSILE"
    DRONE = "DRONE"
    NAVAL = "NAVAL"
    TROOP = "TROOP"

class ConfidenceLevel(str, enum.Enum):
    VERIFIED = "VERIFIED"
    LIKELY = "LIKELY"
    REPORTED = "REPORTED"
    UNCONFIRMED = "UNCONFIRMED"
    DISPUTED = "DISPUTED"

class Event(Base):
    __tablename__ = "event"

    id = Column(String, primary_key=True)  # EVT-2026-000001 format
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    first_detection_time = Column(DateTime(timezone=True), nullable=False)
    event_type = Column(Enum(EventType), nullable=False)
    confidence = Column(Enum(ConfidenceLevel), default=ConfidenceLevel.UNCONFIRMED)
    cluster_radius_km = Column(Float, default=5.0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    satellite_coverage  = Column(JSONB, nullable=True)
    next_opportunities  = Column(JSONB, nullable=True)

    brief_text           = Column(Text, nullable=True)
    brief_generated_at   = Column(DateTime(timezone=True), nullable=True)

    signals = relationship("Signal", back_populates="event")
    claims = relationship("Claim", back_populates="event")
