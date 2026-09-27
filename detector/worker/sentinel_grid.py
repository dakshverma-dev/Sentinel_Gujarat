"""Integration client for the external Sentinel Camera Grid (cctv.corp8.cloud).

This is a real, third-party, credentialed live-video service -- distinct from
this project's own API -- documented in its integrator's guide as RTSP,
WebRTC/WHEP and HLS endpoints per camera id (cam01..camNN). This module builds
correctly authenticated URLs from environment-provided credentials, fetches
the live camera catalogue, and wraps cv2.VideoCapture with the behaviour the
guide requires: forced RTSP-over-TCP, PTS-driven timing instead of
CAP_PROP_FPS or wall-clock arrival time, and reconnect-with-backoff across
supervised restarts and loop-point scene discontinuities.

Nothing here downloads or stores footage: every camera is a live feed with no
seek and no ability to run ahead of real time, exactly as the guide states.
Credentials come only from SENTINEL_GRID_EMAIL / SENTINEL_GRID_PASSWORD -- do
not hardcode them, and do not log the constructed URL (it embeds the password).
"""
import logging
import os
import time
import urllib.parse
from dataclasses import dataclass

import cv2
import httpx

GRID_HTTP_BASE = os.getenv("SENTINEL_GRID_HTTP_BASE", "https://cctv.corp8.cloud").rstrip("/")
GRID_HOST = os.getenv("SENTINEL_GRID_HOST", "103.250.160.189")
GRID_RTSP_PORT = int(os.getenv("SENTINEL_GRID_RTSP_PORT", "8554"))
GRID_WHEP_PORT = int(os.getenv("SENTINEL_GRID_WHEP_PORT", "8889"))
GRID_EMAIL = os.getenv("SENTINEL_GRID_EMAIL", "").strip()
GRID_PASSWORD = os.getenv("SENTINEL_GRID_PASSWORD", "").strip()
GRID_ACCESS_PASSWORD = os.getenv("SENTINEL_GRID_ACCESS_PASSWORD", "").strip()  # HLS-side password, if separate from RTSP auth

RECONNECT_MIN_S = 2.0
RECONNECT_MAX_S = 30.0

# The guide is explicit that RTSP/WebRTC carry media over TCP/UDP a CDN cannot
# proxy, so they go direct to the public IP; HLS stays on the CDN host behind
# the access password. Pick the transport that matches where this worker runs.
TRANSPORT = os.getenv("SENTINEL_GRID_TRANSPORT", "rtsp").strip().lower()  # "rtsp" or "hls"


def configured() -> bool:
    """True once credentials are present. Callers should skip grid onboarding otherwise."""
    if TRANSPORT == "hls":
        return bool(GRID_ACCESS_PASSWORD or GRID_PASSWORD)
    return bool(GRID_EMAIL and GRID_PASSWORD)


def _encoded_credentials() -> str:
    # The guide requires the @ in the email to be percent-encoded (%40); using
    # urllib's quote on the whole email does exactly that, plus anything else
    # in either field that would otherwise break the URL's authority component.
    user = urllib.parse.quote(GRID_EMAIL, safe="")
    password = urllib.parse.quote(GRID_PASSWORD, safe="")
    return f"{user}:{password}"


def rtsp_url(camera_id: str) -> str:
    if not GRID_EMAIL or not GRID_PASSWORD:
        raise RuntimeError("SENTINEL_GRID_EMAIL / SENTINEL_GRID_PASSWORD are not set")
    return f"rtsp://{_encoded_credentials()}@{GRID_HOST}:{GRID_RTSP_PORT}/stream/{camera_id}"


def whep_url(camera_id: str) -> str:
    if not GRID_EMAIL or not GRID_PASSWORD:
        raise RuntimeError("SENTINEL_GRID_EMAIL / SENTINEL_GRID_PASSWORD are not set")
    return f"http://{_encoded_credentials()}@{GRID_HOST}:{GRID_WHEP_PORT}/stream/{camera_id}/whep"


def hls_url(camera_id: str) -> str:
    return f"{GRID_HTTP_BASE}/{camera_id}/index.m3u8"


def source_url(camera_id: str) -> str:
    """The URL this worker should actually open, per SENTINEL_GRID_TRANSPORT."""
    return hls_url(camera_id) if TRANSPORT == "hls" else rtsp_url(camera_id)


def camera_id_from_url(url: str) -> str | None:
    """Recover the grid's own camera id (cam01..camNN) from a URL this module
    built, so the worker can key off Camera.source_url alone instead of
    needing a dedicated database column for the grid id."""
    parsed = urllib.parse.urlsplit(url)
    if parsed.hostname == GRID_HOST or (GRID_HTTP_BASE and url.startswith(GRID_HTTP_BASE)):
        parts = [p for p in parsed.path.split("/") if p]
        if not parts:
            return None
        if parts[0] == "stream" and len(parts) >= 2:
            return parts[1]  # rtsp://.../stream/<id> or whep/.../stream/<id>/whep
        return parts[0]  # https://cctv.corp8.cloud/<id>/index.m3u8
    return None


def is_grid_source(url: str | None) -> bool:
    return bool(url) and camera_id_from_url(url) is not None


def redacted(url: str) -> str:
    """Safe-to-log form of a grid URL -- never log the credentialed form."""
    parsed = urllib.parse.urlsplit(url)
    if not parsed.username and not parsed.password:
        return url
    netloc = parsed.hostname or ""
    if parsed.port:
        netloc += f":{parsed.port}"
    return urllib.parse.urlunsplit((parsed.scheme, f"***:***@{netloc}", parsed.path, parsed.query, parsed.fragment))


@dataclass
class GridCamera:
    id: str
    name: str
    lat: float | None = None
    lon: float | None = None


def list_cameras(client: httpx.Client | None = None) -> list[GridCamera]:
    """Read the live catalogue. Callers should re-fetch periodically -- the guide
    warns the camera set can change -- rather than hard-coding cam01..camNN."""
    owns_client = client is None
    client = client or httpx.Client(timeout=15)
    try:
        response = client.get(f"{GRID_HTTP_BASE}/cameras.json")
        response.raise_for_status()
        rows = response.json()
        return [
            GridCamera(id=row["id"], name=row.get("name", row["id"]), lat=row.get("lat"), lon=row.get("lon"))
            for row in rows
        ]
    finally:
        if owns_client:
            client.close()


def open_capture(camera_id: str) -> cv2.VideoCapture:
    """Open one grid camera with the transport settings the guide requires.

    RTSP is forced over TCP (UDP fails across NAT/firewalls and produces frames
    that look like model bugs, per the guide's own troubleshooting note). This
    only sets the option for this call; it does not mutate other captures.
    """
    url = source_url(camera_id)
    options = "rtsp_transport;tcp" if TRANSPORT == "rtsp" else ""
    previous = os.environ.get("OPENCV_FFMPEG_CAPTURE_OPTIONS")
    try:
        if options:
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = options
        capture = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    finally:
        if options:
            if previous is None:
                os.environ.pop("OPENCV_FFMPEG_CAPTURE_OPTIONS", None)
            else:
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = previous
    return capture


def frame_pts_ms(capture: cv2.VideoCapture) -> float:
    """Presentation timestamp for the frame just read, in milliseconds.

    The guide is explicit: drive timing from PTS, never arrival time or
    CAP_PROP_FPS (frequently misreported). Speed/dwell/time metrics -- the
    route-plausibility gate in api/app/core.py chief among them -- must use
    this, not time.time(), for any grid-sourced camera.
    """
    return capture.get(cv2.CAP_PROP_POS_MSEC)


def stream_frames(camera_id: str, stop: "list[bool] | None" = None):
    """Yield (frame, pts_ms) for a grid camera, reconnecting with exponential
    backoff (~2s doubling to a ~30s cap) across supervised restarts and the
    scene-cut that happens at each feed's loop point, exactly as the guide
    describes. Never tight-loops on a dead source.

    `stop` is an optional single-item mutable flag ([True] to ask this
    generator to return after the current attempt) so a caller can shut a
    camera down between reconnect attempts without killing the thread hard.
    """
    backoff = RECONNECT_MIN_S
    while not (stop and stop[0]):
        capture = open_capture(camera_id)
        if not capture.isOpened():
            logging.warning("Grid camera %s: could not open (%s); retrying in %.0fs", camera_id, redacted(source_url(camera_id)), backoff)
            capture.release()
            time.sleep(backoff)
            backoff = min(RECONNECT_MAX_S, backoff * 2)
            continue
        backoff = RECONNECT_MIN_S  # a clean open resets the backoff clock
        try:
            while not (stop and stop[0]):
                ok, frame = capture.read()
                if not ok:
                    # Includes both a genuine drop and the feed's own loop
                    # point (an abrupt scene cut, per the guide) -- either
                    # way the right response is the same: reconnect.
                    logging.info("Grid camera %s: stream ended or cut; reconnecting", camera_id)
                    break
                yield frame, frame_pts_ms(capture)
        finally:
            capture.release()
        if not (stop and stop[0]):
            time.sleep(min(1.0, backoff))
