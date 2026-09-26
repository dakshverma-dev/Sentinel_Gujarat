"""Fetch a public 27-second traffic clip for local ingest checks.

The clip comes from RisAhamed/ANPR. It is not a Gujarat challenge or government feed.
The file is saved under ignored data/uploads and must be credited if shown publicly.
"""
import hashlib
import urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/RisAhamed/ANPR/main/test_video.mp4"
SHA256 = "da100576125346f250c23bc1ffe6604f1f1ab39314de27029d3acaa88aeecf9e"
TARGET = Path(__file__).resolve().parents[1] / "data" / "uploads" / "public-anpr-test.mp4"


def main():
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    if not TARGET.exists():
        urllib.request.urlretrieve(URL, TARGET)
    digest = hashlib.sha256(TARGET.read_bytes()).hexdigest()
    if digest != SHA256:
        TARGET.unlink(missing_ok=True)
        raise RuntimeError("Public sample checksum changed; inspect upstream before using it")
    print(f"Verified sample: {TARGET}")
    print("Source: https://github.com/RisAhamed/ANPR — third-party Delhi traffic sample, not a Gujarat government feed")


if __name__ == "__main__":
    main()
