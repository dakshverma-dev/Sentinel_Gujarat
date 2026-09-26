"""Download OpenCV Zoo face models into a shared volume when explicitly enabled."""
import hashlib
import logging
import urllib.request
from pathlib import Path

MODELS = {
    "face_detection_yunet_2023mar.onnx": ("face_detection_yunet", 100_000),
    "face_recognition_sface_2021dec.onnx": ("face_recognition_sface", 30_000_000),
}
VEHICLE_URL = "https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11n.pt"
VEHICLE_SHA256 = "0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1"


def download_vehicle(target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != VEHICLE_SHA256:
            raise RuntimeError("Existing vehicle weight checksum mismatch")
        return
    temporary = target.with_suffix(".part")
    logging.info("Downloading pinned YOLO11n vehicle weights")
    try:
        urllib.request.urlretrieve(VEHICLE_URL, temporary)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != VEHICLE_SHA256:
            raise RuntimeError("Vehicle weight checksum mismatch")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def download(model_dir: Path):
    model_dir.mkdir(parents=True, exist_ok=True)
    for filename, (folder, minimum_size) in MODELS.items():
        target = model_dir / filename
        if target.exists() and target.stat().st_size >= minimum_size:
            continue
        url = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/{folder}/{filename}"
        temporary = target.with_suffix(".part")
        logging.info("Downloading OpenCV Zoo model %s", filename)
        urllib.request.urlretrieve(url, temporary)
        if temporary.stat().st_size < minimum_size:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"Model download failed integrity size check: {filename}")
        temporary.replace(target)


if __name__ == "__main__":
    download(Path("data/models"))
