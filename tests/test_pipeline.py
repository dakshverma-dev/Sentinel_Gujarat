import os
import tempfile
from datetime import timedelta
from pathlib import Path

os.environ["DATABASE_URL"] = f"sqlite:///{Path(tempfile.mkdtemp()) / 'sentinel-test.db'}"
os.environ["MEDIA_DIR"] = str(Path(tempfile.mkdtemp()) / "uploads")
os.environ.pop("MEDIAMTX_API", None)

from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.core import camera_health, plate_candidates, verify_audit
from app.db import SessionLocal
from app.models import Audit, Camera, Watchlist, now
from app.triage import build_input, triage


def _camera(**overrides):
    defaults = dict(name="Test cam", lat=23.0, lon=72.5, status="active", is_demo=False,
                     last_seen=now(), fps=25.0, codec="h264")
    defaults.update(overrides)
    return Camera(**defaults)


def test_camera_health_penalizes_stale_heartbeat():
    fresh_score, fresh_reasons = camera_health(_camera())
    stale_score, stale_reasons = camera_health(_camera(last_seen=now() - timedelta(minutes=30)))
    assert stale_score < fresh_score
    assert not fresh_reasons
    assert any("heartbeat" in r for r in stale_reasons)


def test_camera_health_penalizes_missing_passport_and_inactive_status():
    score, reasons = camera_health(_camera(fps=None, codec=None, status="registered"))
    assert score < 1.0
    assert any("passport" in r for r in reasons)
    assert any("status" in r for r in reasons)


def test_camera_health_demo_cameras_get_fixed_score():
    score, reasons = camera_health(_camera(is_demo=True, last_seen=None, fps=None, codec=None))
    assert score == 0.95
    assert reasons == ["synthetic demo camera: fixed health score"]


def test_triage_intercepts_high_confidence_stolen_exact_match():
    inp = build_input(match_type="exact", category="stolen", event_type="plate", plate_confidence=0.92,
                       vote_share=0.9, gate="first sighting", implied_kmh=None, camera_health=1.0, hour=13)
    verdict = triage(inp)
    assert verdict.priority == "P1"
    assert verdict.action == "intercept"
    assert verdict.evidence_sufficient >= 0.8
    assert verdict.source == "deterministic"
    assert verdict.reasons


def test_triage_routes_rejected_gate_to_human_review():
    inp = build_input(match_type="exact", category="stolen", event_type="plate", plate_confidence=0.9,
                       vote_share=0.9, gate="rejected", implied_kmh=612.0, camera_health=1.0, hour=13)
    verdict = triage(inp)
    assert verdict.action == "human review"
    assert verdict.evidence_sufficient < 0.8


def test_triage_face_events_always_need_human_confirmation():
    inp = build_input(match_type="face", category="missing", event_type="face", plate_confidence=0.95,
                       vote_share=None, gate="first sighting", implied_kmh=None, camera_health=1.0, hour=13)
    verdict = triage(inp)
    assert verdict.action == "human review"


def test_track_consensus_respects_ocr_quality():
    plate, confidence, top = plate_candidates([
        {"plate": "GJ01AB1234", "confidence": 0.2},
        {"plate": "GJ01AB1234", "confidence": 0.2},
        {"plate": "GJ01AB1234", "confidence": 0.2},
    ])
    assert plate == "GJ01AB1234"
    assert confidence < 0.3
    assert top[0]["vote_share"] == 1


def test_end_to_end_demo_gate_report_and_audit():
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"username": "operator", "password": "sentinel-demo"})
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        scenario = client.post("/api/demo/run", headers=headers)
        assert scenario.status_code == 200, scenario.text
        assert scenario.json()["detections"] == 9
        assert scenario.json()["alerts"] == 7
        alerts = client.get("/api/alerts", headers=headers).json()
        assert len(alerts) == 7
        assert {a["category"] for a in alerts} == {"stolen", "wanted", "blacklisted"}
        assert any(a["gate"] == "plausible" for a in alerts)
        assert sum(a["gate"] == "rejected" for a in alerts) == 2
        rejected = next(a for a in alerts if a["gate"] == "rejected")
        assert rejected["status"] == "review"
        assert rejected["implied_kmh"] > 160
        assert rejected["triage_source"] == "deterministic"
        assert rejected["evidence_sufficient"] < 0.8
        assert rejected["triage_reasons"]
        intercepted = [a for a in alerts if a["action"] == "intercept"]
        assert intercepted and all(a["priority"] == "P1" for a in intercepted)
        route = client.get("/api/search?plate=GJ01AB1234", headers=headers).json()
        assert len(route["sightings"]) == 3
        csv_result = client.get("/api/reports/csv", headers=headers)
        assert csv_result.status_code == 200
        assert "unreadable" in csv_result.text
        assert "low-confidence" in csv_result.text
        assert "GJ18QX8901" in csv_result.text
        assert "camera_name" in csv_result.text
        demo_summary = client.get("/api/reports/summary?source=demo", headers=headers)
        assert demo_summary.status_code == 200
        assert demo_summary.json()["tracks"] == 9
        assert client.get("/api/reports/csv?source=recorded", headers=headers).text.count("\n") == 1
        pdf_result = client.get("/api/reports/pdf", headers=headers)
        assert pdf_result.status_code == 200
        assert pdf_result.content.startswith(b"%PDF")
        evidence = client.get(f"/api/alerts/{rejected['id']}/evidence", headers=headers).json()
        assert evidence["chain_valid"] is True
        packet = client.get(f"/api/alerts/{rejected['id']}/evidence.pdf", headers=headers)
        assert packet.status_code == 200
        assert packet.content.startswith(b"%PDF")
        review = client.patch(f"/api/alerts/{rejected['id']}", headers=headers, json={"status": "dismissed", "note": "Implausible travel time"})
        assert review.status_code == 200
        repeated = client.post("/api/demo/run", headers=headers)
        assert repeated.status_code == 200
        assert repeated.json()["alerts"] == 7
        with SessionLocal() as db:
            camera = db.scalar(select(Camera).limit(1))
            face_entry = Watchlist(kind="face", identifier="CONSENTING-TEST", category="missing", authority="Test authority", expires_at=now() + timedelta(days=1), approved_by="admin", embedding=[1.0, 0.0])
            db.add(face_entry)
            db.commit()
            camera_id, entry_id = camera.id, face_entry.id
        face_payload = {"camera_id": camera_id, "track_id": "FACE-TEST-1", "event_type": "face", "confidence": 0.95, "face_embedding": [1.0, 0.0], "source": "live"}
        pending = client.post("/api/detections", headers={"X-Worker-Key": "local-worker-key"}, json=face_payload)
        assert pending.status_code == 200
        assert pending.json()["alerts"] == []
        reviewer_token = client.post("/api/auth/login", json={"username": "reviewer", "password": "sentinel-review"}).json()["token"]
        approval = client.post(f"/api/watchlist/{entry_id}/approve", headers={"Authorization": f"Bearer {reviewer_token}"}, json={"approver": "reviewer"})
        assert approval.status_code == 200
        face_payload["track_id"] = "FACE-TEST-2"
        matched = client.post("/api/detections", headers={"X-Worker-Key": "local-worker-key"}, json=face_payload)
        assert matched.status_code == 200
        assert len(matched.json()["alerts"]) == 1
        assert matched.json()["alerts"][0]["status"] == "review"
        assert client.get("/api/audit/verify", headers=headers).json()["valid"] is True
    with SessionLocal() as db:
        first = db.scalar(select(Audit).order_by(Audit.id).limit(1))
        first.payload = {"changed": True}
        db.commit()
        assert verify_audit(db.scalars(select(Audit).order_by(Audit.id)).all())[0] is False


def test_camera_file_onboarding_and_protected_playback():
    clip = Path(__file__).resolve().parents[1] / "web" / "public" / "demo" / "camera-1.mp4"
    with TestClient(app) as client:
        token = client.post("/api/auth/login", json={"username": "operator", "password": "sentinel-demo"}).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        with clip.open("rb") as stream:
            response = client.post("/api/cameras/upload", headers=headers, data={"name": "Test replay camera", "department": "Integration test", "lat": "23.02", "lon": "72.57"}, files={"file": (clip.name, stream, "video/mp4")})
        assert response.status_code == 200, response.text
        camera = response.json()
        assert camera["protocol"] == "file"
        assert camera["status"] == "queued"
        assert camera["codec"] == "h264"
        assert camera["width"] == 640
        assert camera["media_url"]
        worker_headers = {"X-Worker-Key": "local-worker-key"}
        assert camera["id"] in {item["id"] for item in client.get("/api/internal/cameras", headers=worker_headers).json()}
        finished = client.post(f"/api/internal/cameras/{camera['id']}/status", headers=worker_headers, json={"status": "processed"})
        assert finished.status_code == 200
        assert finished.json()["status"] == "processed"
        assert camera["id"] not in {item["id"] for item in client.get("/api/internal/cameras", headers=worker_headers).json()}
        assert client.get(camera["media_url"]).status_code == 422
        media = client.get(f"{camera['media_url']}?token={token}")
        assert media.status_code == 200
        assert media.headers["content-type"] == "video/mp4"
        assert media.content[4:8] == b"ftyp"
