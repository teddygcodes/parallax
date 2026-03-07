import enum
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Enum, Float
from sqlalchemy.orm import relationship
from .base import Base

class ClaimStatus(str, enum.Enum):
    VERIFIED = "VERIFIED"
    UNVERIFIED = "UNVERIFIED"
    DISPUTED = "DISPUTED"
    DISPROVEN = "DISPROVEN"
    COORDINATED_MESSAGING_SUSPECTED = "COORDINATED_MESSAGING_SUSPECTED"

class Claim(Base):
    __tablename__ = "claims"

    id = Column(String, primary_key=True)
    event_id = Column(String, ForeignKey("event.id"), nullable=False)
    claim_text = Column(Text, nullable=False)
    source = Column(String, nullable=False)
    source_category = Column(String, nullable=False)
    first_seen_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(Enum(ClaimStatus), default=ClaimStatus.UNVERIFIED)
    confidence_score = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    event = relationship("Event", back_populates="claims")
    history = relationship("NarrativeHistory", back_populates="claim")
