from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from .base import Base

class NarrativeHistory(Base):
    __tablename__ = "narrative_history"

    id = Column(String, primary_key=True)
    claim_id = Column(String, ForeignKey("claims.id"), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    status_before = Column(String, nullable=False)
    status_after = Column(String, nullable=False)
    trigger = Column(Text)
    notes = Column(Text)

    claim = relationship("Claim", back_populates="history")
