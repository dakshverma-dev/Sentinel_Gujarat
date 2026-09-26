import hashlib
import json
import math
import re
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import Alert, Audit, Camera, Detection, Watchlist, now
from .triage import build_input, triage


PLATE_PATTERN = re.compile(r"^(?:[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$")


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def normalize_plate(value: str | None) -> str | None:
    value = re.sub(r"[^A-Z0-9]", "", (value or "").upper())
    return value or None


def plate_candidates(reads: list[dict]) -> tuple[str | None, float, list[dict]]:
    """Weighted track vote. Invalid strings stay visible, but cannot outrank valid reads."""
    votes: dict[str, float] = {}
    quality: dict[str, list[float]] = {}
    for read in reads:
        plate = normalize_plate(read.get("plate"))
        if not plate:
            continue
        confidence = max(0.01, min(1.0, float(read.get("confidence", 0))))
        votes[plate] = votes.get(plate, 0) + confidence * (1.0 if PLATE_PATTERN.fullmatch(plate) else 0.35)
        quality.setdefault(plate, []).append(confidence)
    ranking = sorted(votes.items(), key=lambda x: x[1], reverse=True)[:3]
    total = sum(votes.values()) or 1
    top = [{"plate": plate, "vote_share": round(weight / total, 3)} for plate, weight in ranking]
    if not ranking:
        return None, 0, []
    best = ranking[0][0]
    vote_share = ranking[0][1] / total
    mean_quality = sum(quality[best]) / len(quality[best])
    support = 0.65 + 0.35 * min(len(quality[best]) / 3, 1)
    return best, round(min(0.99, mean_quality * vote_share * support), 3), top


def edit_distance_one(a: str, b: str) -> bool:
    if len(a) != len(b):
        return False
    return sum(x != y for x, y in zip(a, b)) == 1


def road_distance_km(a: Camera, b: Camera) -> float:
    """Haversine distance with a conservative road detour factor; not a routed road path."""
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp = p2 - p1
    dl = math.radians(b.lon - a.lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h)) * 1.35


def append_audit(db: Session, actor: str, action: str, payload: dict) -> Audit:
    previous = db.scalar(select(Audit).order_by(Audit.id.desc()).limit(1))
    record = Audit(actor=actor, action=action, payload=payload, previous_hash=previous.digest if previous else "0" * 64, created_at=now())
    content = json.dumps({"at": record.created_at.isoformat(), "actor": actor, "action": action, "payload": payload, "previous": record.previous_hash}, sort_keys=True, separators=(",", ":"))
    record.digest = hashlib.sha256(content.encode()).hexdigest()
    db.add(record)
    return record


def verify_audit(rows: list[Audit]) -> tuple[bool, int | None]:
    previous = "0" * 64
    for row in rows:
        content = json.dumps({"at": utc(row.created_at).isoformat(), "actor": row.actor, "action": row.action, "payload": row.payload, "previous": row.previous_hash}, sort_keys=True, separators=(",", ":"))
        if row.previous_hash != previous or hashlib.sha256(content.encode()).hexdigest() != row.digest:
            return False, row.id
        previous = row.digest
    return True, None


def correlate(db: Session, detection: Detection, camera: Camera) -> list[Alert]:
    active = db.scalars(select(Watchlist).where(Watchlist.kind == detection.event_type)).all()
    created: list[Alert] = []
    for entry in active:
        if (entry.authority == "Synthetic demo case") != (detection.source == "demo"):
            continue
        if utc(entry.expires_at) <= now():
            continue
        match_type = "none"
        if detection.event_type == "plate" and detection.plate:
            if detection.plate == entry.identifier:
                match_type = "exact"
            elif detection.confidence >= 0.65 and edit_distance_one(detection.plate, entry.identifier):
                match_type = "fuzzy"
        elif detection.event_type == "face" and detection.face_embedding and entry.embedding and entry.second_approver:
            dot = sum(float(a) * float(b) for a, b in zip(detection.face_embedding, entry.embedding))
            norm1 = math.sqrt(sum(float(a) ** 2 for a in detection.face_embedding))
            norm2 = math.sqrt(sum(float(b) ** 2 for b in entry.embedding))
            if norm1 and norm2 and dot / (norm1 * norm2) >= 0.42:
                match_type = "face"
        if match_type == "none":
            continue
        last_alert = db.scalar(select(Alert).where(Alert.camera_id == camera.id, Alert.watchlist_id == entry.id).order_by(Alert.created_at.desc()).limit(1))
        if last_alert and abs((utc(detection.first_seen) - utc(last_alert.created_at)).total_seconds()) < 45 and detection.source != "demo":
            continue
        gate, speed = "first sighting", None
        if detection.event_type == "plate":
            prior_query = select(Detection).where(Detection.plate == detection.plate, Detection.camera_id != camera.id, Detection.id != detection.id, Detection.first_seen < detection.first_seen)
            if detection.source == "demo":
                run_prefix = "-".join(detection.track_id.split("-")[:2]) + "-"
                prior_query = prior_query.where(Detection.source == "demo", Detection.track_id.like(f"{run_prefix}%"))
            else:
                prior_query = prior_query.where(Detection.source != "demo")
            prior = db.scalars(prior_query.order_by(Detection.first_seen.desc()).limit(1)).first()
            if prior:
                previous_camera = db.get(Camera, prior.camera_id)
                gap_h = abs((utc(detection.first_seen) - utc(prior.first_seen)).total_seconds()) / 3600
                speed = round(road_distance_km(camera, previous_camera) / max(gap_h, 1 / 3600), 1)
                gate = "rejected" if speed > 160 else "plausible"
        camera_health = 0.6 if camera.status != "active" else 1.0
        triage_input = build_input(
            match_type=match_type, category=entry.category, event_type=detection.event_type,
            plate_confidence=detection.confidence, vote_share=(detection.top3[0]["vote_share"] if detection.top3 else None),
            gate=gate, implied_kmh=speed, camera_health=camera_health, hour=utc(detection.first_seen).hour,
        )
        verdict = triage(triage_input)
        requires_review = verdict.action == "human review"
        explanation = f"{match_type.title()} {entry.category} watchlist match. {'; '.join(verdict.reasons)}."
        if speed is not None:
            explanation += f" Estimated travel speed {speed:.1f} km/h; physics gate {gate}."
        if detection.event_type == "face":
            explanation += " Operator confirmation required before action."
        alert = Alert(detection_id=detection.id, watchlist_id=entry.id, camera_id=camera.id, priority=verdict.priority, action=verdict.action, score=verdict.confidence, match_type=match_type, gate=gate, implied_kmh=speed, explanation=explanation, source=detection.source, created_at=now(), status="review" if requires_review else "new", evidence_sufficient=verdict.evidence_sufficient, misread_or_clone_risk=verdict.misread_or_clone_risk, triage_reasons=verdict.reasons, triage_source=verdict.source)
        db.add(alert)
        db.flush()
        append_audit(db, "matcher", "alert.created", {"alert_id": alert.id, "detection_id": detection.id, "gate": gate, "score": verdict.confidence, "priority": verdict.priority, "action": verdict.action, "triage_source": verdict.source})
        created.append(alert)
    return created
