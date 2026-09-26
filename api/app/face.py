"""Optional local YuNet/SFace inference. Models are deliberately supplied by the operator."""
import os
from pathlib import Path
import cv2
import numpy as np
from fastapi import HTTPException

YUNET = Path(os.getenv("YUNET_MODEL", "data/models/face_detection_yunet_2023mar.onnx"))
SFACE = Path(os.getenv("SFACE_MODEL", "data/models/face_recognition_sface_2021dec.onnx"))


def embedding_from_image(data: bytes) -> list[float]:
    if not (YUNET.exists() and SFACE.exists()):
        raise HTTPException(503, "Face models unavailable. Run scripts/download_face_models.py first.")
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "Invalid image")
    height, width = image.shape[:2]
    detector = cv2.FaceDetectorYN.create(str(YUNET), "", (width, height), score_threshold=0.9)
    _, faces = detector.detect(image)
    if faces is None or len(faces) != 1:
        raise HTTPException(422, "The image must contain exactly one clear face")
    recognizer = cv2.FaceRecognizerSF.create(str(SFACE), "")
    aligned = recognizer.alignCrop(image, faces[0])
    vector = recognizer.feature(aligned).flatten()
    return [round(float(x), 6) for x in vector]
