import csv
import hashlib
import io
import os
import re
import subprocess
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
import jwt
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Image as RLImage, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .core import append_audit, correlate, normalize_plate, plate_candidates, utc, verify_audit
from .db import Base, SessionLocal, engine, get_db
from .face import embedding_from_image
from .models import Alert, Audit, Camera, Detection, Watchlist, now

APP_SECRET = os.getenv("JWT_SECRET", "local-dev-secret-change-me")
WORKER_KEY = os.getenv("WORKER_KEY", "local-worker-key")
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", "data/uploads"))
MEDIA_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    startup()
    yield


app = FastAPI(title="Sentinel Gujarat", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(","), allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


class LoginIn(BaseModel):
    username: str
    password: str


class CameraIn(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    department: str = "Pilot"
    source_url: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class WatchlistIn(BaseModel):
    kind: str = "plate"
    identifier: str
    category: str
    authority: str
    expires_at: datetime


class ApprovalIn(BaseModel):
    approver: str


class ReadIn(BaseModel):
    plate: str
    confidence: float = Field(ge=0, le=1)


class DetectionIn(BaseModel):
    camera_id: str
    track_id: str
    event_type: str = "plate"
    reads: list[ReadIn] = []
    plate: str | None = None
    confidence: float = Field(default=0, ge=0, le=1)
    vehicle_class: str | None = None
    snapshot_ref: str | None = None
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    source: str = "live"
    model_version: str | None = None
    face_embedding: list[float] | None = None


class ReviewIn(BaseModel):
    status: str
    note: str = Field(min_length=5)


class CameraStatusIn(BaseModel):
    status: str


def token_data(token: str) -> dict:
    try:
        return jwt.decode(token, APP_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired session")


def current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in required")
    return token_data(authorization[7:])


def require_role(*roles: str):
    def check(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "This role cannot perform that action")
        return user
    return check


def camera_out(c: Camera) -> dict:
    overlay = f"annotated-{c.id}.jpg"
    return {"id": c.id, "name": c.name, "department": c.department, "protocol": c.protocol, "lat": c.lat, "lon": c.lon, "codec": c.codec, "fps": c.fps, "width": c.width, "height": c.height, "status": c.status, "is_demo": c.is_demo, "path_name": c.path_name, "media_url": f"/api/media/{Path(c.source_url).name}" if c.protocol == "file" and c.source_url else None, "overlay_url": f"/api/media/{overlay}" if (MEDIA_DIR / overlay).exists() else None, "created_at": utc(c.created_at).isoformat(), "last_seen": utc(c.last_seen).isoformat() if c.last_seen else None}


def detection_out(d: Detection, camera: Camera | None = None) -> dict:
    return {"id": d.id, "camera_id": d.camera_id, "camera_name": camera.name if camera else None, "track_id": d.track_id, "event_type": d.event_type, "plate": d.plate, "confidence": d.confidence, "vehicle_class": d.vehicle_class, "top3": d.top3, "read_status": d.read_status, "snapshot_ref": d.snapshot_ref, "first_seen": utc(d.first_seen).isoformat(), "last_seen": utc(d.last_seen).isoformat(), "source": d.source, "model_version": d.model_version}


def alert_out(a: Alert, d: Detection, c: Camera, w: Watchlist) -> dict:
    return {"id": a.id, "detection_id": d.id, "camera_id": c.id, "camera_name": c.name, "plate": d.plate or w.identifier, "event_type": d.event_type, "category": w.category, "authority": w.authority, "priority": a.priority, "action": a.action, "score": a.score, "match_type": a.match_type, "gate": a.gate, "implied_kmh": a.implied_kmh, "explanation": a.explanation, "status": a.status, "source": a.source, "created_at": utc(a.created_at).isoformat(), "review_note": a.review_note, "lat": c.lat, "lon": c.lon, "evidence_sufficient": a.evidence_sufficient, "misread_or_clone_risk": a.misread_or_clone_risk, "triage_reasons": a.triage_reasons, "triage_source": a.triage_source}


class Connections:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def publish(self, payload: dict):
        for ws in list(self.clients):
            try:
                await ws.send_json(payload)
            except Exception:
                self.clients.discard(ws)


connections = Connections()


def startup():
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        for camera in db.scalars(select(Camera).where(Camera.protocol == "file", Camera.status == "processing")).all():
            camera.status = "queued"
        if not db.scalar(select(func.count(Camera.id))):
            demo = [
                ("Ashram Road Junction", 23.0330, 72.5690),
                ("Paldi Crossroads", 23.0116, 72.5715),
                ("Sarkhej Junction", 22.9924, 72.5010),
            ]
            for name, lat, lon in demo:
                db.add(Camera(name=name, department="Ahmedabad pilot", protocol="demo", lat=lat, lon=lon, status="demo", is_demo=True))
            db.commit()
        for camera in db.scalars(select(Camera).where(Camera.path_name.is_not(None))).all():
            if camera.source_url and register_gateway_path(camera.path_name, camera.source_url):
                camera.status = "active"
        db.commit()


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.scalar(select(func.count(Camera.id)))
    return {"status": "ok", "time": now().isoformat()}


@app.get("/api/media/{filename}")
def protected_media(filename: str, token: str):
    token_data(token)
    if Path(filename).name != filename:
        raise HTTPException(400, "Invalid file name")
    file = MEDIA_DIR / filename
    if not file.exists():
        raise HTTPException(404, "Media not found")
    return FileResponse(file)


@app.post("/api/auth/login")
def login(body: LoginIn):
    accounts = {
        os.getenv("DEMO_USER", "operator"): (os.getenv("DEMO_PASSWORD", "sentinel-demo"), "operator"),
        os.getenv("ADMIN_USER", "admin"): (os.getenv("ADMIN_PASSWORD", "sentinel-admin"), "admin"),
        os.getenv("REVIEWER_USER", "reviewer"): (os.getenv("REVIEWER_PASSWORD", "sentinel-review"), "reviewer"),
    }
    stored = accounts.get(body.username)
    if not stored or stored[0] != body.password:
        raise HTTPException(401, "Incorrect username or password")
    role = stored[1]
    token = jwt.encode({"sub": body.username, "role": role, "exp": now() + timedelta(hours=8)}, APP_SECRET, algorithm="HS256")
    return {"token": token, "user": {"name": body.username, "role": role}}


@app.get("/api/overview")
def overview(_: dict = Depends(current_user), db: Session = Depends(get_db)):
    return {"cameras": db.scalar(select(func.count(Camera.id))) or 0, "live_cameras": db.scalar(select(func.count(Camera.id)).where(Camera.status == "active")) or 0, "detections": db.scalar(select(func.count(Detection.id))) or 0, "alerts": db.scalar(select(func.count(Alert.id))) or 0, "needs_review": db.scalar(select(func.count(Alert.id)).where(Alert.status == "review")) or 0, "latest_event": (utc(db.scalar(select(Detection.first_seen).order_by(Detection.first_seen.desc()).limit(1))).isoformat() if db.scalar(select(func.count(Detection.id))) else None)}


@app.get("/api/cameras")
def cameras(_: dict = Depends(current_user), db: Session = Depends(get_db)):
    return [camera_out(c) for c in db.scalars(select(Camera).order_by(Camera.created_at)).all()]


@app.get("/api/internal/cameras")
def worker_cameras(x_worker_key: str | None = Header(default=None), db: Session = Depends(get_db)):
    if x_worker_key != WORKER_KEY:
        raise HTTPException(401, "Worker key required")
    statement = select(Camera).where(Camera.is_demo == False, or_(Camera.protocol != "file", Camera.status.in_(["queued", "processing"])))
    return [{**camera_out(c), "source_url": c.source_url} for c in db.scalars(statement).all()]


@app.post("/api/internal/cameras/{camera_id}/status")
def worker_camera_status(camera_id: str, body: CameraStatusIn, x_worker_key: str | None = Header(default=None), db: Session = Depends(get_db)):
    if x_worker_key != WORKER_KEY:
        raise HTTPException(401, "Worker key required")
    if body.status not in {"processing", "processed", "error"}:
        raise HTTPException(422, "Invalid file processing status")
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(404, "Camera not found")
    if camera.protocol != "file":
        raise HTTPException(422, "Only recorded files have processing status")
    camera.status = body.status
    if body.status in {"processed", "error"}:
        camera.last_seen = now()
        append_audit(db, "detector", "camera.processing_finished", {"camera_id": camera.id, "status": body.status})
    db.commit()
    return camera_out(camera)


@app.get("/api/internal/face-watchlist")
def worker_face_watchlist(x_worker_key: str | None = Header(default=None), db: Session = Depends(get_db)):
    if x_worker_key != WORKER_KEY:
        raise HTTPException(401, "Worker key required")
    return [{"id": w.id, "embedding": w.embedding} for w in db.scalars(select(Watchlist).where(Watchlist.kind == "face", Watchlist.second_approver.is_not(None))).all() if utc(w.expires_at) > now()]


def probe_source(source: str) -> dict:
    try:
        process = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,avg_frame_rate", "-of", "json", source], capture_output=True, text=True, timeout=12)
        import json
        stream = json.loads(process.stdout).get("streams", [{}])[0]
        rate = stream.get("avg_frame_rate", "0/1").split("/")
        fps = round(int(rate[0]) / max(1, int(rate[1])), 2)
        return {"codec": stream.get("codec_name"), "width": stream.get("width"), "height": stream.get("height"), "fps": fps}
    except Exception:
        return {"codec": None, "width": None, "height": None, "fps": None}


def register_gateway_path(path_name: str, source_url: str) -> bool:
    gateway = os.getenv("MEDIAMTX_API")
    if not gateway:
        return False
    try:
        with httpx.Client(timeout=5) as client:
            response = client.post(f"{gateway}/v3/config/paths/add/{path_name}", json={"source": source_url, "sourceOnDemand": True})
            return response.is_success or response.status_code == 400 and client.get(f"{gateway}/v3/config/paths/get/{path_name}").is_success
    except Exception:
        return False


@app.post("/api/cameras")
async def add_camera(body: CameraIn, user: dict = Depends(require_role("admin", "operator")), db: Session = Depends(get_db)):
    protocol = body.source_url.split(":", 1)[0].lower()
    if protocol not in {"rtsp", "rtsps", "rtmp", "http", "https"}:
        raise HTTPException(422, "Use an RTSP, RTMP, HLS, or HTTP video URL; upload files separately")
    path_name = f"cam-{uuid4().hex[:12]}"
    camera = Camera(name=body.name, department=body.department, protocol="hls" if body.source_url.lower().split("?")[0].endswith(".m3u8") else protocol, source_url=body.source_url, path_name=path_name, lat=body.lat, lon=body.lon, status="registered", **probe_source(body.source_url))
    db.add(camera)
    db.flush()
    if os.getenv("MEDIAMTX_API"):
        camera.status = "active" if register_gateway_path(path_name, body.source_url) else "gateway unavailable"
    append_audit(db, user["sub"], "camera.registered", {"camera_id": camera.id, "protocol": camera.protocol})
    db.commit()
    return camera_out(camera)


@app.post("/api/cameras/upload")
async def upload_camera(name: str = Form(...), department: str = Form("Pilot"), lat: float = Form(...), lon: float = Form(...), file: UploadFile = File(...), user: dict = Depends(require_role("admin", "operator")), db: Session = Depends(get_db)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".mov", ".mkv", ".avi"}:
        raise HTTPException(422, "Upload MP4, MOV, MKV, or AVI footage")
    destination = MEDIA_DIR / f"{uuid4().hex}{suffix}"
    with destination.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)
            if out.tell() > 1024 * 1024 * 1024:
                destination.unlink(missing_ok=True)
                raise HTTPException(413, "Maximum file size is 1 GB")
    camera = Camera(name=name, department=department, protocol="file", source_url=str(destination), lat=lat, lon=lon, status="queued", **probe_source(str(destination)))
    db.add(camera)
    db.flush()
    append_audit(db, user["sub"], "camera.uploaded", {"camera_id": camera.id, "filename": destination.name})
    db.commit()
    return camera_out(camera)


@app.get("/api/watchlist")
def watchlist(_: dict = Depends(current_user), db: Session = Depends(get_db)):
    return [{"id": w.id, "kind": w.kind, "identifier": w.identifier, "category": w.category, "authority": w.authority, "expires_at": utc(w.expires_at).isoformat(), "approved_by": w.approved_by, "second_approver": w.second_approver} for w in db.scalars(select(Watchlist).order_by(Watchlist.created_at.desc())).all()]


@app.post("/api/watchlist")
def add_watchlist(body: WatchlistIn, user: dict = Depends(require_role("admin", "operator")), db: Session = Depends(get_db)):
    if body.kind != "plate":
        raise HTTPException(422, "Use face enrollment for face entries")
    plate = normalize_plate(body.identifier)
    if not plate:
        raise HTTPException(422, "Plate is required")
    if utc(body.expires_at) <= now():
        raise HTTPException(422, "Expiry must be in the future")
    entry = Watchlist(kind="plate", identifier=plate, category=body.category, authority=body.authority, expires_at=utc(body.expires_at), approved_by=user["sub"])
    db.add(entry)
    db.flush()
    append_audit(db, user["sub"], "watchlist.plate_added", {"entry_id": entry.id, "category": entry.category})
    db.commit()
    return {"id": entry.id}


@app.post("/api/watchlist/face")
async def enroll_face(identifier: str = Form(...), category: str = Form("missing"), authority: str = Form(...), expires_at: datetime = Form(...), image: UploadFile = File(...), user: dict = Depends(require_role("admin")), db: Session = Depends(get_db)):
    if utc(expires_at) <= now():
        raise HTTPException(422, "Expiry must be in the future")
    vector = embedding_from_image(await image.read())
    entry = Watchlist(kind="face", identifier=identifier, category=category, authority=authority, expires_at=utc(expires_at), approved_by=user["sub"], embedding=vector)
    db.add(entry)
    db.flush()
    append_audit(db, user["sub"], "watchlist.face_pending", {"entry_id": entry.id, "authority": authority})
    db.commit()
    return {"id": entry.id, "status": "awaiting second approver"}


@app.post("/api/watchlist/{entry_id}/approve")
def approve_face(entry_id: str, body: ApprovalIn, user: dict = Depends(require_role("admin", "reviewer")), db: Session = Depends(get_db)):
    entry = db.get(Watchlist, entry_id)
    if not entry or entry.kind != "face":
        raise HTTPException(404, "Face entry not found")
    if user["sub"] == entry.approved_by or body.approver != user["sub"]:
        raise HTTPException(403, "A different signed-in approver is required")
    entry.second_approver = user["sub"]
    append_audit(db, user["sub"], "watchlist.face_approved", {"entry_id": entry.id})
    db.commit()
    return {"status": "approved"}


@app.post("/api/detections")
async def add_detection(body: DetectionIn, x_worker_key: str | None = Header(default=None), authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    if x_worker_key != WORKER_KEY:
        if not authorization or token_data(authorization.removeprefix("Bearer ")).get("role") not in {"admin", "operator"}:
            raise HTTPException(401, "Worker or operator authorization required")
    camera = db.get(Camera, body.camera_id)
    if not camera:
        raise HTTPException(404, "Camera not found")
    best, vote_conf, top3 = plate_candidates([r.model_dump() for r in body.reads]) if body.reads else (normalize_plate(body.plate), body.confidence, [])
    confidence = vote_conf if body.reads else body.confidence
    first_seen = utc(body.first_seen) if body.first_seen else now()
    detection = Detection(camera_id=camera.id, track_id=body.track_id, event_type=body.event_type, plate=best if body.event_type == "plate" else None, confidence=confidence, vehicle_class=body.vehicle_class, top3=top3, read_status="confirmed" if best and confidence >= 0.6 else "low-confidence" if best else "unreadable", snapshot_ref=body.snapshot_ref, first_seen=first_seen, last_seen=utc(body.last_seen) if body.last_seen else first_seen, source=body.source, model_version=body.model_version, face_embedding=body.face_embedding)
    db.add(detection)
    db.flush()
    camera.last_seen = now()
    if camera.status in {"registered", "queued", "processing"}:
        camera.status = "active" if camera.protocol != "file" else "processing"
    alerts = correlate(db, detection, camera)
    db.commit()
    result = {"detection": detection_out(detection, camera), "alerts": [alert_out(a, detection, camera, db.get(Watchlist, a.watchlist_id)) for a in alerts]}
    await connections.publish({"type": "detection", "data": result["detection"]})
    for alert in result["alerts"]:
        await connections.publish({"type": "alert", "data": alert})
    return result


@app.get("/api/detections")
def detections(limit: int = Query(50, ge=1, le=500), _: dict = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Detection).order_by(Detection.first_seen.desc()).limit(limit)).all()
    return [detection_out(d, db.get(Camera, d.camera_id)) for d in rows]


@app.get("/api/alerts")
def alerts(status: str | None = None, _: dict = Depends(current_user), db: Session = Depends(get_db)):
    statement = select(Alert).order_by(Alert.created_at.desc()).limit(200)
    if status:
        statement = statement.where(Alert.status == status)
    return [alert_out(a, db.get(Detection, a.detection_id), db.get(Camera, a.camera_id), db.get(Watchlist, a.watchlist_id)) for a in db.scalars(statement).all()]


@app.patch("/api/alerts/{alert_id}")
async def review_alert(alert_id: str, body: ReviewIn, user: dict = Depends(require_role("admin", "operator", "reviewer")), db: Session = Depends(get_db)):
    if body.status not in {"confirmed", "dismissed", "escalated"}:
        raise HTTPException(422, "Choose confirmed, dismissed, or escalated")
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    alert.status, alert.review_note, alert.reviewed_by = body.status, body.note, user["sub"]
    append_audit(db, user["sub"], "alert.reviewed", {"alert_id": alert_id, "status": body.status, "note": body.note})
    db.commit()
    output = alert_out(alert, db.get(Detection, alert.detection_id), db.get(Camera, alert.camera_id), db.get(Watchlist, alert.watchlist_id))
    await connections.publish({"type": "alert", "data": output})
    return output


@app.get("/api/search")
def search(plate: str, _: dict = Depends(current_user), db: Session = Depends(get_db)):
    normalized = normalize_plate(plate)
    if not normalized:
        raise HTTPException(422, "Enter a plate")
    rows = db.scalars(select(Detection).where(Detection.plate == normalized).order_by(Detection.first_seen)).all()
    return {"plate": normalized, "sightings": [{**detection_out(d, c := db.get(Camera, d.camera_id)), "lat": c.lat, "lon": c.lon} for d in rows]}


def report_rows(db: Session, camera_id: str | None, start: datetime | None, end: datetime | None, source: str | None = None) -> list[dict]:
    stmt = select(Detection).where(Detection.event_type.in_(["plate", "vehicle"]))
    if source:
        stmt = stmt.where(Detection.source == source)
    if camera_id:
        stmt = stmt.where(Detection.camera_id == camera_id)
    if start:
        stmt = stmt.where(Detection.first_seen >= utc(start))
    if end:
        stmt = stmt.where(Detection.first_seen <= utc(end))
    detections = db.scalars(stmt.order_by(Detection.first_seen)).all()
    output = []
    for d in detections:
        camera = db.get(Camera, d.camera_id)
        alert = db.scalar(select(Alert).where(Alert.detection_id == d.id).order_by(Alert.created_at).limit(1))
        hit = db.get(Watchlist, alert.watchlist_id).category if alert else None
        output.append({"camera_id": camera.id, "camera_name": camera.name, "first_seen": utc(d.first_seen).astimezone(ZoneInfo("Asia/Kolkata")).isoformat(), "last_seen": utc(d.last_seen).astimezone(ZoneInfo("Asia/Kolkata")).isoformat(), "track_id": d.track_id, "vehicle_class": d.vehicle_class or "unknown", "plate_best": d.plate or "", "plate_confidence": d.confidence, "plate_top3": " / ".join(x["plate"] for x in d.top3), "read_status": d.read_status, "snapshot_ref": d.snapshot_ref or "", "watchlist_hit": hit or "none", "source": d.source})
    return output


@app.get("/api/reports/summary")
def report_summary(source: str | None = None, _: dict = Depends(current_user), db: Session = Depends(get_db)):
    if source and source not in {"demo", "recorded", "live"}:
        raise HTTPException(422, "Source must be demo, recorded or live")
    rows = report_rows(db, None, None, None, source)
    read = sum(bool(row["plate_best"]) for row in rows)
    return {"tracks": len(rows), "plates_read": read, "confirmed": sum(row["read_status"] == "confirmed" for row in rows), "read_rate": round(read / len(rows) * 100) if rows else 0}


@app.get("/api/reports/{format}")
def export_report(format: str, camera_id: str | None = None, start: datetime | None = None, end: datetime | None = None, source: str | None = None, _: dict = Depends(current_user), db: Session = Depends(get_db)):
    if source and source not in {"demo", "recorded", "live"}:
        raise HTTPException(422, "Source must be demo, recorded or live")
    rows = report_rows(db, camera_id, start, end, source)
    fields = ["camera_id", "camera_name", "first_seen", "last_seen", "track_id", "vehicle_class", "plate_best", "plate_confidence", "plate_top3", "read_status", "snapshot_ref", "watchlist_hit", "source"]
    if format == "csv":
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
        return Response(buffer.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=sentinel-vehicle-report.csv"})
    if format != "pdf":
        raise HTTPException(404, "Use csv or pdf")
    data = io.BytesIO()
    document = SimpleDocTemplate(data, pagesize=landscape(A3), leftMargin=30, rightMargin=30, topMargin=32, bottomMargin=30)
    styles = getSampleStyleSheet()
    summary = f"{len(rows)} vehicle tracks | {sum(bool(r['plate_best']) for r in rows)} plates read | {sum(r['read_status'] == 'confirmed' for r in rows)} confirmed"
    cells = [["Camera ID", "Camera", "First seen (IST)", "Last seen (IST)", "Track", "Class", "Plate", "Conf.", "Top 3 candidates", "Read status", "Snapshot ref", "Watchlist", "Source"]]
    for row in rows:
        cells.append([row["camera_id"][:8], row["camera_name"][:19], row["first_seen"][:19], row["last_seen"][:19], row["track_id"][-12:], row["vehicle_class"], row["plate_best"], f"{row['plate_confidence']:.2f}", row["plate_top3"][:42], row["read_status"], row["snapshot_ref"][-22:], row["watchlist_hit"], row["source"]])
    table = Table(cells, repeatRows=1, colWidths=[52, 105, 105, 105, 65, 53, 78, 40, 160, 75, 105, 60, 45])
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123345")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 7), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f6f7")]), ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 6)]))
    document.build([Paragraph("Sentinel Gujarat | Vehicle observation report", styles["Title"]), Spacer(1, 12), Paragraph(summary, styles["Normal"]), Spacer(1, 16), table, Spacer(1, 16), Paragraph("Generated by Sentinel Gujarat. Demo rows are marked in the Source column. Unverified OCR reads are retained.", styles["Normal"])])
    return Response(data.getvalue(), media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=sentinel-vehicle-report.pdf"})


@app.get("/api/audit/verify")
def audit_verify(_: dict = Depends(require_role("admin", "reviewer", "operator")), db: Session = Depends(get_db)):
    rows = db.scalars(select(Audit).order_by(Audit.id)).all()
    valid, failed_at = verify_audit(rows)
    return {"valid": valid, "records": len(rows), "failed_at": failed_at, "latest_hash": rows[-1].digest if rows else None}


@app.get("/api/alerts/{alert_id}/evidence")
def evidence(alert_id: str, _: dict = Depends(current_user), db: Session = Depends(get_db)):
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    detection = db.get(Detection, alert.detection_id)
    camera = db.get(Camera, alert.camera_id)
    entry = db.get(Watchlist, alert.watchlist_id)
    rows = db.scalars(select(Audit).order_by(Audit.id)).all()
    valid, failed_at = verify_audit(rows)
    snapshot_file = MEDIA_DIR / Path(detection.snapshot_ref).name if detection.snapshot_ref else None
    snapshot_hash = hashlib.sha256(snapshot_file.read_bytes()).hexdigest() if snapshot_file and snapshot_file.exists() else None
    event_record = next((row for row in rows if row.action == "alert.created" and row.payload.get("alert_id") == alert_id), None)
    return {"alert": alert_out(alert, detection, camera, entry), "detection": detection_out(detection, camera), "chain_valid": valid, "chain_failed_at": failed_at, "latest_hash": rows[-1].digest if rows else None, "event_hash": event_record.digest if event_record else None, "snapshot_sha256": snapshot_hash, "model_version": detection.model_version}


@app.get("/api/alerts/{alert_id}/evidence.pdf")
def evidence_pdf(alert_id: str, user: dict = Depends(current_user), db: Session = Depends(get_db)):
    packet = evidence(alert_id, user, db)
    alert = packet["alert"]
    detection = packet["detection"]
    styles = getSampleStyleSheet()
    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A3, leftMargin=45, rightMargin=45, topMargin=45, bottomMargin=45)
    details = [
        ("Alert ID", alert["id"]), ("Observed at", detection["first_seen"]), ("Camera", f"{alert['camera_name']} ({alert['camera_id']})"),
        ("Plate or person", alert["plate"]), ("Category", alert["category"]), ("Authority", alert["authority"]),
        ("Priority / action", f"{alert['priority']} / {alert['action']}"), ("Match", alert["match_type"]), ("Confidence", f"{alert['score']:.2f}"),
        ("Physics gate", alert["gate"]), ("Implied speed", f"{alert['implied_kmh']} km/h" if alert["implied_kmh"] is not None else "n/a"),
        ("Triage source", alert["triage_source"]), ("Evidence sufficient", f"{alert['evidence_sufficient']:.2f}"),
        ("Misread/clone risk", f"{alert['misread_or_clone_risk']:.2f}"), ("Triage reasoning", "; ".join(alert["triage_reasons"]) or "n/a"),
        ("Operator status", alert["status"]), ("Source", alert["source"]), ("Model", packet["model_version"] or "not recorded"),
        ("Snapshot SHA-256", packet["snapshot_sha256"] or "no snapshot"), ("Event audit SHA-256", packet["event_hash"] or "not recorded"),
        ("Audit chain", "VALID" if packet["chain_valid"] else f"BROKEN at #{packet['chain_failed_at']}"),
    ]
    cells = [["Field", "Value"]] + [[Paragraph(label, styles["Normal"]), Paragraph(str(value), styles["Normal"])] for label, value in details]
    table = Table(cells, colWidths=[150, 550])
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123345")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f6f7")]), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 7)]))
    story = [Paragraph("Sentinel Gujarat | Evidence packet", styles["Title"]), Spacer(1, 14), Paragraph("This packet records a system observation and operator state. It is not an independent forensic seal. Synthetic demo events are labelled in the Source row.", styles["Normal"]), Spacer(1, 16), table]
    snapshot_file = MEDIA_DIR / Path(detection["snapshot_ref"]).name if detection["snapshot_ref"] else None
    if snapshot_file and snapshot_file.exists() and snapshot_file.suffix.lower() in {".jpg", ".jpeg", ".png"}:
        story += [Spacer(1, 18), Paragraph("Observation crop", styles["Heading2"]), RLImage(str(snapshot_file), width=360, height=230, kind="proportional")]
    document.build(story)
    return Response(buffer.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename=sentinel-evidence-{alert_id[:8]}.pdf"})


@app.post("/api/demo/run")
async def run_demo(user: dict = Depends(require_role("admin", "operator")), db: Session = Depends(get_db)):
    cameras = db.scalars(select(Camera).where(Camera.is_demo == True).order_by(Camera.name)).all()
    if len(cameras) < 3:
        raise HTTPException(409, "Demo cameras unavailable")
    by_name = {c.name: c for c in cameras}
    a, b, c = (by_name[n] for n in ["Ashram Road Junction", "Paldi Crossroads", "Sarkhej Junction"])
    demo_entries = [
        ("GJ01AB1234", "stolen"),
        ("GJ05CD4821", "wanted"),
        ("GJ27EF7788", "blacklisted"),
    ]
    for identifier, category in demo_entries:
        entry = db.scalar(select(Watchlist).where(Watchlist.kind == "plate", Watchlist.identifier == identifier, Watchlist.authority == "Synthetic demo case"))
        if not entry:
            db.add(Watchlist(kind="plate", identifier=identifier, category=category, authority="Synthetic demo case", expires_at=now() + timedelta(days=30), approved_by="demo"))
        else:
            entry.expires_at = now() + timedelta(days=30)
    db.commit()
    sequence = [
        (a, -540, "GJ05CD4821", 0.90, "car"),
        (b, -390, "GJ05CD4821", 0.87, "car"),
        (b, -360, "GJ27EF7788", 0.92, "van"),
        (a, -240, "GJ01AB1234", 0.92, "car"),
        (c, -180, "GJ27EF7788", 0.84, "van"),
        (b, -120, "GJ01AB1234", 0.88, "car"),
        (c, -112, "GJ01AB1234", 0.91, "car"),
        (c, -90, "GJ18QX8901", 0.46, "car"),
        (a, -60, None, 0, "motorcycle"),
    ]
    results = []
    run_id = uuid4().hex[:8]
    for index, (camera, seconds, plate, confidence, vehicle_class) in enumerate(sequence):
        body = DetectionIn(camera_id=camera.id, track_id=f"DEMO-{run_id}-{index}", event_type="plate" if plate else "vehicle", plate=plate, confidence=confidence, vehicle_class=vehicle_class, first_seen=now() + timedelta(seconds=seconds), source="demo", model_version="synthetic-demo-v2")
        results.append(await add_detection(body, x_worker_key=WORKER_KEY, db=db))
    append_audit(db, user["sub"], "demo.scenario_run", {"detections": len(results)})
    db.commit()
    return {"label": "synthetic demonstration data", "detections": len(results), "alerts": sum(len(r["alerts"]) for r in results)}


@app.websocket("/api/ws")
async def websocket(ws: WebSocket, token: str):
    try:
        token_data(token)
    except HTTPException:
        await ws.close(code=4401)
        return
    await ws.accept()
    connections.clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        connections.clients.discard(ws)
