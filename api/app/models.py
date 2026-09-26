from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def uid():
    return str(uuid4())


def now():
    return datetime.now(timezone.utc)


class Camera(Base):
    __tablename__ = "cameras"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    department: Mapped[str] = mapped_column(String(120), default="Pilot")
    protocol: Mapped[str] = mapped_column(String(16), default="file")
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    path_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    codec: Mapped[str | None] = mapped_column(String(40), nullable=True)
    fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="registered")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Detection(Base):
    __tablename__ = "detections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id"), index=True)
    track_id: Mapped[str] = mapped_column(String(100), index=True)
    event_type: Mapped[str] = mapped_column(String(16), default="vehicle")
    plate: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0)
    vehicle_class: Mapped[str | None] = mapped_column(String(32), nullable=True)
    top3: Mapped[list] = mapped_column(JSON, default=list)
    read_status: Mapped[str] = mapped_column(String(20), default="unreadable")
    snapshot_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    source: Mapped[str] = mapped_column(String(16), default="live")
    model_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    face_embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)


class Watchlist(Base):
    __tablename__ = "watchlist"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(16), default="plate")
    identifier: Mapped[str] = mapped_column(String(120), index=True)
    category: Mapped[str] = mapped_column(String(32))
    authority: Mapped[str] = mapped_column(String(160))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    second_approver: Mapped[str | None] = mapped_column(String(100), nullable=True)
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    detection_id: Mapped[str] = mapped_column(ForeignKey("detections.id"), index=True)
    watchlist_id: Mapped[str] = mapped_column(ForeignKey("watchlist.id"))
    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id"))
    status: Mapped[str] = mapped_column(String(20), default="new")
    priority: Mapped[str] = mapped_column(String(4), default="P2")
    action: Mapped[str] = mapped_column(String(40), default="human review")
    score: Mapped[float] = mapped_column(Float, default=0)
    match_type: Mapped[str] = mapped_column(String(20), default="exact")
    gate: Mapped[str] = mapped_column(String(20), default="first sighting")
    implied_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    explanation: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), default="live")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    reviewed_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_sufficient: Mapped[float] = mapped_column(Float, default=0)
    misread_or_clone_risk: Mapped[float] = mapped_column(Float, default=0)
    triage_reasons: Mapped[list] = mapped_column(JSON, default=list)
    triage_source: Mapped[str] = mapped_column(String(40), default="deterministic")


class Audit(Base):
    __tablename__ = "audit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    actor: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict] = mapped_column(JSON)
    previous_hash: Mapped[str] = mapped_column(String(64))
    digest: Mapped[str] = mapped_column(String(64))
