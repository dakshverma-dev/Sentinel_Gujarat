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
from . import sentinel_grid

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
    payload = {"camera_id": camera["id"], "track_id": track.id, "event_type": "plate" if track.reads else "vehicle", "reads": track.reads, "confidence": 0, "vehicle_class": track.kind, "colour": track.colour, "snapshot_ref": snapshot_ref, "first_seen": track.first_seen.isoformat(), "last_seen": track.last_seen.isoformat(), "source": "recorded" if camera["protocol"] == "file" else "live", "model_version": f"{WEIGHTS}+{'tesseract' if ocr_available else 'ocr-unavailable'}"}
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


def _run_analysis_loop(camera: dict, frames, client: httpx.Client, analyzer: "VehicleAnalyzer", face_matcher):
    """Shared per-frame body: sample, detect, and forward tracks/faces. `frames`
    yields plain frames (local sources) or is unused directly by callers that
    already have their own frame_count -- see process_camera and
    process_grid_camera, which both drive this same analyzer/client pair."""
    analyzed_frames = 0
    frame_count = 0
    for frame in frames:
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
    return analyzed_frames


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
            def frames():
                while True:
                    ok, frame = capture.read()
                    if not ok:
                        return
                    yield frame
            analyzed_frames = _run_analysis_loop(camera, frames(), client, analyzer, face_matcher)
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


def process_grid_camera(camera: dict, stop_flag: list):
    """Ingest one live Sentinel Camera Grid feed. Unlike process_camera, this
    never returns on its own -- a grid feed is always-live, per the
    integrator's guide -- except when `stop_flag[0]` is set, which happens
    when the camera is no longer in the API's active list (see main())."""
    grid_id = sentinel_grid.camera_id_from_url(camera["source_url"])
    logging.info("Opening grid camera %s (%s)", camera["name"], grid_id)
    report_file_status(camera, "processing")
    analyzer = VehicleAnalyzer(WEIGHTS, PLATE_WEIGHTS)
    face_matcher = ApprovedFaceMatcher(MODEL_DIR, API, KEY) if ENABLE_FACE else None
    try:
        with httpx.Client() as client:
            frame_count = 0
            for frame, pts_ms in sentinel_grid.stream_frames(grid_id, stop=stop_flag):
                frame_count += 1
                if frame_count % 3 != 0:
                    continue
                # pts_ms (stream-relative presentation time, per the guide) is
                # available here for any future dwell/speed metric on grid
                # cameras; analyzer.analyze() below still timestamps tracks by
                # wall clock, matching every other camera in this pilot, so the
                # route-plausibility gate stays comparable across sources.
                try:
                    for track in analyzer.analyze(frame):
                        send_track(client, camera, track, analyzer.ocr_available)
                    if analyzer.annotated_frame is not None:
                        target = MEDIA_DIR / f"annotated-{camera['id']}.jpg"
                        temporary = target.with_name(f"{target.stem}.tmp.jpg")
                        if cv2.imwrite(str(temporary), analyzer.annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 78]):
                            os.replace(temporary, target)
                    if face_matcher and frame_count % 15 == 0:
                        for match in face_matcher.matches(frame, client):
                            send_face(client, camera, match)
                except Exception:
                    # A grid feed's loop-point scene cut, or a decode warning
                    # before the first IDR frame, is expected per the guide --
                    # log and keep consuming rather than tearing the stream down.
                    logging.exception("Analysis failed on grid camera %s", camera["name"])
            for track in analyzer.flush():
                send_track(client, camera, track, analyzer.ocr_available)
    except Exception:
        report_file_status(camera, "error")
        raise
    logging.info("Stopped grid camera %s", camera["name"])


def main():
    if Path(WEIGHTS).resolve() == (MODEL_DIR / "yolo11n.pt").resolve():
        download_vehicle(Path(WEIGHTS))
    if ENABLE_FACE:
        try:
            download(MODEL_DIR)
        except Exception as exc:
            logging.warning("Face model setup failed: %s", exc)
    active: dict[str, object] = {}
    stop_flags: dict[str, list] = {}
    completed_files: set[str] = set()
    with ThreadPoolExecutor(max_workers=MAX_CAMERAS) as executor, httpx.Client(timeout=15) as client:
        while True:
            try:
                response = client.get(f"{API}/api/internal/cameras", headers={"X-Worker-Key": KEY})
                response.raise_for_status()
                cameras = response.json()
                seen_ids = {camera["id"] for camera in cameras}
                for camera in cameras:
                    if not camera.get("source_url") or camera["id"] in active or camera["id"] in completed_files:
                        continue
                    if len(active) >= MAX_CAMERAS:
                        break
                    if sentinel_grid.is_grid_source(camera["source_url"]):
                        stop_flag = [False]
                        stop_flags[camera["id"]] = stop_flag
                        active[camera["id"]] = executor.submit(process_grid_camera, camera, stop_flag)
                    else:
                        active[camera["id"]] = executor.submit(process_camera, camera)
                # A grid camera never returns on its own -- ask it to stop once
                # it drops out of the API's active list (deleted or disabled)
                # instead of waiting on a future that only ends via stop_flag.
                for camera_id, stop_flag in list(stop_flags.items()):
                    if camera_id not in seen_ids:
                        stop_flag[0] = True
                for camera in cameras:
                    future = active.get(camera["id"])
                    if future and future.done():
                        try:
                            future.result()
                        except Exception:
                            logging.exception("Camera worker failed")
                        del active[camera["id"]]
                        stop_flags.pop(camera["id"], None)
                        if camera["protocol"] == "file":
                            completed_files.add(camera["id"])
            except Exception as exc:
                logging.warning("API unavailable: %s", exc)
            time.sleep(5)


if __name__ == "__main__":
    main()
