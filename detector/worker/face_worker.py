"""Watchlist-only recognition. Unmatched embeddings are never sent or stored."""
import logging
import math
import time
from datetime import datetime, timezone
from pathlib import Path
import cv2
import httpx
import numpy as np


class ApprovedFaceMatcher:
    def __init__(self, model_dir: Path, api: str, worker_key: str):
        yunet = model_dir / "face_detection_yunet_2023mar.onnx"
        sface = model_dir / "face_recognition_sface_2021dec.onnx"
        self.available = yunet.exists() and sface.exists()
        self.api, self.worker_key = api, worker_key
        self.entries: list[dict] = []
        self.refreshed = 0.0
        self.sent: dict[str, float] = {}
        if self.available:
            self.detector = cv2.FaceDetectorYN.create(str(yunet), "", (320, 320), score_threshold=0.9)
            self.recognizer = cv2.FaceRecognizerSF.create(str(sface), "")
        else:
            logging.warning("Face models unavailable; watchlist-only face detection disabled")

    def refresh(self, client: httpx.Client):
        if time.time() - self.refreshed < 60:
            return
        try:
            response = client.get(f"{self.api}/api/internal/face-watchlist", headers={"X-Worker-Key": self.worker_key}, timeout=10)
            response.raise_for_status()
            self.entries = response.json()
            self.refreshed = time.time()
        except Exception as exc:
            logging.warning("Face watchlist refresh failed: %s", exc)

    def matches(self, frame: np.ndarray, client: httpx.Client) -> list[tuple[str, float, list[float], np.ndarray, datetime]]:
        if not self.available:
            return []
        self.refresh(client)
        if not self.entries:
            return []
        height, width = frame.shape[:2]
        self.detector.setInputSize((width, height))
        _, faces = self.detector.detect(frame)
        if faces is None:
            return []
        output = []
        for face in faces:
            aligned = self.recognizer.alignCrop(frame, face)
            vector = self.recognizer.feature(aligned).flatten()
            norm = math.sqrt(float(np.dot(vector, vector)))
            if not norm:
                continue
            for entry in self.entries:
                reference = np.asarray(entry["embedding"], dtype=np.float32)
                ref_norm = math.sqrt(float(np.dot(reference, reference)))
                cosine = float(np.dot(vector, reference) / (norm * ref_norm)) if ref_norm else 0
                key = entry["id"]
                if cosine >= 0.42 and time.time() - self.sent.get(key, 0) > 60:
                    self.sent[key] = time.time()
                    output.append((key, cosine, [round(float(x), 6) for x in vector], aligned, datetime.now(timezone.utc)))
        return output
