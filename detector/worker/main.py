import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import cv2
import httpx
from .download_models import download, download_vehicle
from .face_worker import ApprovedFaceMatcher
from .vision import VehicleAnalyzer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
API = os.getenv("API_URL", "http://api:8000")
KEY = os.getenv("WORKER_KEY", "local-worker-key")
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", "/app/data/uploads"))
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR = MEDIA_DIR.parent / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
WEIGHTS = os.getenv("VEHICLE_MODEL") or str(MODEL_DIR / "yolo11n.pt")
PLATE_WEIGHTS = os.getenv("PLATE_MODEL", "")
MAX_CAMERAS = int(os.getenv("MAX_CAMERAS", "4"))
ENABLE_FACE = os.getenv("ENABLE_FACE", "0") == "1"


def send_track(client: httpx.Client, camera: dict, track, ocr_available: bool = True):
    snapshot_ref = None
    if track.snapshot is not None:
        filename = f"{camera['id']}-{track.id}-{int(track.first_seen.timestamp())}.jpg"
        filename = filename.replace("/", "_")
        if cv2.imwrite(str(MEDIA_DIR / filename), track.snapshot):
            snapshot_ref = f"/api/media/{filename}"
    payload = {"camera_id": camera["id"], "track_id": track.id, "event_type": "plate" if track.reads else "vehicle", "reads": track.reads, "confidence": 0, "vehicle_class": track.kind, "snapshot_ref": snapshot_ref, "first_seen": track.first_seen.isoformat(), "last_seen": track.last_seen.isoformat(), "source": "recorded" if camera["protocol"] == "file" else "live", "model_version": f"{WEIGHTS}+{'tesseract' if ocr_available else 'ocr-unavailable'}"}
    try:
        response = client.post(f"{API}/api/detections", json=payload, headers={"X-Worker-Key": KEY}, timeout=15)
        response.raise_for_status()
        logging.info("Camera %s track %s: %s", camera["name"], track.id, response.json()["detection"]["plate"] or "unreadable")
    except Exception as exc:
        logging.error("Could not send track %s: %s", track.id, exc)


def send_face(client: httpx.Client, camera: dict, match):
    entry_id, score, embedding, crop, timestamp = match
    filename = f"face-{camera['id']}-{entry_id}-{int(timestamp.timestamp())}.jpg"
    cv2.imwrite(str(MEDIA_DIR / filename), crop)
    payload = {"camera_id": camera["id"], "track_id": f"FACE-{entry_id[:8]}-{int(timestamp.timestamp())}", "event_type": "face", "confidence": score, "face_embedding": embedding, "snapshot_ref": f"/api/media/{filename}", "first_seen": timestamp.isoformat(), "source": "recorded" if camera["protocol"] == "file" else "live", "model_version": "OpenCV-Zoo-YuNet+SFace"}
    try:
        response = client.post(f"{API}/api/detections", json=payload, headers={"X-Worker-Key": KEY}, timeout=15)
        response.raise_for_status()
    except Exception as exc:
        logging.error("Could not send approved face match: %s", exc)


def report_file_status(camera: dict, status: str):
    if camera["protocol"] != "file":
        return
    try:
        response = httpx.post(f"{API}/api/internal/cameras/{camera['id']}/status", json={"status": status}, headers={"X-Worker-Key": KEY}, timeout=15)
        response.raise_for_status()
    except Exception as exc:
        logging.error("Could not set camera %s status to %s: %s", camera["name"], status, exc)


def process_camera(camera: dict):
    logging.info("Opening %s", camera["name"])
    source = camera["source_url"]
    if not source:
        return
    report_file_status(camera, "processing")
    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        logging.warning("Could not open camera %s", camera["name"])
        report_file_status(camera, "error")
        return
    analyzed_frames = 0
    try:
        analyzer = VehicleAnalyzer(WEIGHTS, PLATE_WEIGHTS)
        face_matcher = ApprovedFaceMatcher(MODEL_DIR, API, KEY) if ENABLE_FACE else None
        with httpx.Client() as client:
            frame_count = 0
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                frame_count += 1
                if frame_count % 3 != 0:
                    continue
                try:
                    for track in analyzer.analyze(frame):
                        send_track(client, camera, track, analyzer.ocr_available)
                    analyzed_frames += 1
                    if analyzer.annotated_frame is not None:
                        target = MEDIA_DIR / f"annotated-{camera['id']}.jpg"
                        temporary = target.with_name(f"{target.stem}.tmp.jpg")
                        if cv2.imwrite(str(temporary), analyzer.annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 78]):
                            os.replace(temporary, target)
                    if face_matcher and frame_count % 15 == 0:
                        for match in face_matcher.matches(frame, client):
                            send_face(client, camera, match)
                except Exception:
                    logging.exception("Analysis failed on %s", camera["name"])
                    time.sleep(1)
            for track in analyzer.flush():
                send_track(client, camera, track, analyzer.ocr_available)
    except Exception:
        report_file_status(camera, "error")
        raise
    finally:
        capture.release()
    if camera["protocol"] == "file":
        report_file_status(camera, "processed" if analyzed_frames else "error")
    logging.info("Finished %s", camera["name"])


def main():
    if Path(WEIGHTS).resolve() == (MODEL_DIR / "yolo11n.pt").resolve():
        download_vehicle(Path(WEIGHTS))
    if ENABLE_FACE:
        try:
            download(MODEL_DIR)
        except Exception as exc:
            logging.warning("Face model setup failed: %s", exc)
    active: dict[str, object] = {}
    completed_files: set[str] = set()
    with ThreadPoolExecutor(max_workers=MAX_CAMERAS) as executor, httpx.Client(timeout=15) as client:
        while True:
            try:
                response = client.get(f"{API}/api/internal/cameras", headers={"X-Worker-Key": KEY})
                response.raise_for_status()
                cameras = response.json()
                for camera in cameras:
                    if not camera.get("source_url") or camera["id"] in active or camera["id"] in completed_files:
                        continue
                    if len(active) >= MAX_CAMERAS:
                        break
                    active[camera["id"]] = executor.submit(process_camera, camera)
                for camera in cameras:
                    future = active.get(camera["id"])
                    if future and future.done():
                        try:
                            future.result()
                        except Exception:
                            logging.exception("Camera worker failed")
                        del active[camera["id"]]
                        if camera["protocol"] == "file":
                            completed_files.add(camera["id"])
            except Exception as exc:
                logging.warning("API unavailable: %s", exc)
            time.sleep(5)


if __name__ == "__main__":
    main()
