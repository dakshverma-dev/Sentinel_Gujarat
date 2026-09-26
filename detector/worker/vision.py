"""Track-level vehicle/plate reads from an existing pretrained detector."""
import re
import logging
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import cv2
import numpy as np
import pytesseract
from ultralytics import YOLO

PLATE = re.compile(r"^(?:[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$")


@dataclass
class Track:
    id: str
    kind: str
    first_seen: datetime
    last_seen: datetime
    last_frame: int
    reads: list[dict] = field(default_factory=list)
    snapshot: np.ndarray | None = None
    sent: bool = False
    observations: int = 0


def plate_regions(vehicle: np.ndarray) -> list[np.ndarray]:
    height, width = vehicle.shape[:2]
    if height < 45 or width < 65:
        return []
    lower = vehicle[int(height * 0.35):]
    gray = cv2.cvtColor(lower, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 9, 75, 75)
    gradient = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_RECT, (13, 3)))
    _, threshold = cv2.threshold(gradient, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    threshold = cv2.morphologyEx(threshold, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3)))
    contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    proposals = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        ratio = w / max(h, 1)
        if 1.8 <= ratio <= 6.5 and w >= width * 0.18 and 15 <= h <= lower.shape[0] * 0.5:
            proposals.append((w * h, lower[max(0, y-5): min(lower.shape[0], y+h+5), max(0, x-5): min(width, x+w+5)]))
    return [crop for _, crop in sorted(proposals, key=lambda x: x[0], reverse=True)[:3]]


def ocr_plate(crop: np.ndarray) -> list[dict]:
    scale = max(1.0, 400 / max(crop.shape[1], 1))
    image = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    variants = [gray, cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]]
    reads = []
    for variant in variants:
        data = pytesseract.image_to_data(variant, config="--psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", output_type=pytesseract.Output.DICT)
        text = re.sub(r"[^A-Z0-9]", "", "".join(data["text"]).upper())
        confidences = [float(x) for x in data["conf"] if float(x) >= 0]
        if 7 <= len(text) <= 12:
            base = sum(confidences) / len(confidences) / 100 if confidences else 0.2
            reads.append({"plate": text, "confidence": round(base * (1 if PLATE.fullmatch(text) else 0.45), 3)})
    return reads


class VehicleAnalyzer:
    def __init__(self, weights: str = "yolo11n.pt", plate_weights: str | None = None):
        self.model = YOLO(weights)
        self.plate_model = YOLO(plate_weights) if plate_weights and Path(plate_weights).exists() else None
        self.ocr_available = shutil.which(pytesseract.pytesseract.tesseract_cmd) is not None
        if not self.ocr_available:
            logging.warning("Tesseract executable unavailable; vehicle tracks will be retained without plate reads")
        self.tracks: dict[str, Track] = {}
        self.frame_number = 0
        self.annotated_frame: np.ndarray | None = None

    def analyze(self, frame: np.ndarray) -> list[Track]:
        self.frame_number += 1
        timestamp = datetime.now(timezone.utc)
        results = self.model.track(frame, classes=[2, 3, 5, 7], conf=0.35, persist=True, tracker="bytetrack.yaml", verbose=False)[0]
        self.annotated_frame = results.plot()
        if results.boxes is not None:
            ids = results.boxes.id
            for index, box in enumerate(results.boxes):
                track_id = str(int(ids[index].item())) if ids is not None else f"frame-{self.frame_number}-{index}"
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                crop = frame[max(0, y1):max(0, y2), max(0, x1):max(0, x2)]
                if crop.size == 0:
                    continue
                kind = self.model.names[int(box.cls[0])]
                track = self.tracks.setdefault(track_id, Track(track_id, kind, timestamp, timestamp, self.frame_number))
                track.last_seen, track.last_frame, track.snapshot = timestamp, self.frame_number, crop.copy()
                track.observations += 1
                if self.ocr_available and len(track.reads) < 24 and not track.sent:
                    regions = plate_regions(crop)
                    if self.plate_model is not None:
                        regions = []
                        plate_result = self.plate_model.predict(crop, conf=0.28, verbose=False)[0]
                        for candidate in plate_result.boxes:
                            px1, py1, px2, py2 = [int(v) for v in candidate.xyxy[0].tolist()]
                            region = crop[max(0, py1):max(0, py2), max(0, px1):max(0, px2)]
                            if region.size:
                                regions.append(region)
                    for region in regions:
                        track.reads.extend(ocr_plate(region))
        completed = []
        for track_id, track in list(self.tracks.items()):
            age = (timestamp - track.first_seen).total_seconds()
            missing = self.frame_number - track.last_frame
            if (len(track.reads) >= 3 and age >= 1.0) or missing >= 12:
                if not track.sent and (track.observations >= 3 or track.reads):
                    completed.append(track)
                    track.sent = True
            if missing >= 60:
                del self.tracks[track_id]
        return completed

    def flush(self) -> list[Track]:
        return [t for t in self.tracks.values() if not t.sent and (t.observations >= 3 or t.reads)]
