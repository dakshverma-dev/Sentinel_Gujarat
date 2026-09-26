# Sentinel Gujarat

An operational pilot for camera onboarding, vehicle tracking, plate consensus, governed face matching, watchlist correlation, cross-camera plausibility checks, alert review, and timestamped CSV/PDF reports.

The operations console uses an editorial, warm-neutral visual treatment adapted from the supplied design reference, with self-hosted Fraunces display serif headings, Source Sans 3 body text, and IBM Plex Mono for technical labels. The editable [14-slide presentation](docs/Sentinel_Gujarat_Solution_Deck.pptx), its [PDF export](docs/Sentinel_Gujarat_Solution_Deck.pdf), and the [high-level design](docs/hld.md) accompany the code. The deck labels synthetic counts and unmeasured field outcomes explicitly.

The console separates **live/recorded observations** from the **synthetic scenario**. The latter is a deterministic way to examine the matcher, route gate, review flow, and exports before real footage is available. It is labelled `DEMO` throughout the UI and in reports.

## Run locally

1. Start Docker Desktop.
2. Copy `.env.example` to `.env`. Change `JWT_SECRET`, `WORKER_KEY`, and all passwords before exposing this outside your machine.
3. Run `docker compose up --build` from this directory.
4. Open `http://localhost:3000`. Local test accounts are `operator / sentinel-demo`, `admin / sentinel-admin`, and `reviewer / sentinel-review` until you change them in `.env`.

The first detector start downloads pretrained YOLO vehicle weights. With `ENABLE_FACE=1`, it also downloads YuNet and SFace weights from OpenCV Zoo into `data/models`. Give it a few minutes and check `docker compose logs -f detector`. Uploaded clips and snapshots stay under ignored `data/uploads`; PostgreSQL persists in the Compose volume.

The web console is on port 3000, FastAPI and OpenAPI docs on 8000 (`/docs`), MediaMTX RTSP on 8554, HLS on 8888, and WebRTC on 8889. The Compose ports bind to `127.0.0.1` for local evaluation.

For a UI/API preview without Docker, install `api/requirements.txt`, run `$env:PYTHONPATH='api'; python -m uvicorn app.main:app --host 127.0.0.1 --port 8000` from the project root, then run `npm ci` and `npm run dev -- --host 127.0.0.1` in `web/`. Open `http://127.0.0.1:5173`. This uses local SQLite and exercises onboarding, review, exports, and the synthetic scenario. A local detector can run separately with `detector/requirements.txt`; MediaMTX playback requires Compose or an equivalent gateway. Schema changes only add new tables automatically; if `data/sentinel.db` predates a model change, stop the API and delete that file so it is recreated with the current schema.

### Fast demo path

1. Sign in as `operator`.
2. Click **Run synthetic scenario**. It adds nine clearly labelled tracks, seven watchlist alerts across stolen, wanted, and blacklisted test plates, one low-confidence read, and one unreadable track. Two travel-time candidates exceed the route threshold and go to review.
3. Open **Recent alerts**. The eight-second Ashram Road → Paldi → Sarkhej decoy is `GATE REJECTED`. Open its card to see the estimated speed, the triage card (priority · action · confidence with its reason trail), model label, and audit digest. A clean single-camera stolen-plate hit shows `P1 · intercept`; the decoy is routed to human review instead.
4. Search `GJ01AB1234` under **Plate search**, then use the source tabs in **Reports** to separate recorded footage from synthetic rows and export both formats.
5. Open **Audit trail** and verify the SHA-256 chain.

### Real footage

Use **Add camera → Stream URL** for RTSP, RTMP, HLS, or an HTTP video source. MediaMTX pulls the source once and exposes a browser view; the detector reads the same source in this pilot. Use **Upload footage** for MP4/MOV/MKV/AVI. The passport displays codec, frame rate, and resolution when `ffprobe` can read them. Recorded files are timestamped at processing time; source capture time cannot be inferred from an arbitrary file.

A verified public traffic clip can be fetched with `python scripts/fetch_public_sample.py` and uploaded through the UI. Its source is [RisAhamed/ANPR](https://github.com/RisAhamed/ANPR), and the upstream repository is MIT licensed. The clip shows Delhi traffic and is useful for **vehicle ingest testing**; its camera angle is poor for plate OCR. Three short, credited segments are included in `web/public/demo` so every seeded camera has a visible preview. They are labelled **public sample replay** and are not the source of synthetic Ahmedabad event records. They are neither the team's own footage nor a Gujarat government feed. The full clip was also run through the vehicle detector locally; its recorded tracks are visible in the source-filtered report. Tesseract was unavailable on that host, so those tracks have no plate reads.

For an Indian plate detector trained on your permitted data, put YOLO weights in `data/models/` and set `PLATE_MODEL=/app/data/models/your-plate-model.pt` in `.env`. Without those weights, the baseline uses contour proposals plus Tesseract. The code retains unreadable and low-confidence tracks instead of inventing plates. The default vehicle detector is Ultralytics YOLO11n, which has AGPL licensing considerations for non-open deployments. OpenCV Zoo YuNet and SFace model licenses are documented in their upstream folders; verify model and data rights before deployment.

### Governed face flow

Sign in as `admin` and use **Watchlist → Enroll face** with an image of a consenting test participant, authority text, and expiry. Sign out, then sign in as `reviewer` and approve the pending entry. Only approved, unexpired face embeddings are loaded by the detector. It sends and stores an embedding only when it matches that list; unmatched face embeddings are discarded. All face alerts require a human review. This path requires the OpenCV models in `data/models` and `ENABLE_FACE=1`.

## What is implemented

| Capability | Current behavior |
| --- | --- |
| Camera registry | Authenticated URL and file onboarding, `ffprobe` passport, map position, MediaMTX path creation |
| Video analytics | YOLO vehicle tracking, candidate plate crop/OCR, weighted read consensus; optional approved-list face matching |
| Correlation | Exact/fuzzy plate and approved face matching with expiry and authority |
| Route gate | Haversine distance × 1.35 road detour estimate, 160 km/h threshold, explicit rejection/review |
| Camera health | 0–1 score per camera from heartbeat freshness, ingest status, and passport completeness (`api/app/core.py:camera_health`); the lower of the two cameras in a cross-camera match discounts triage confidence, with the reasons shown on the camera passport and in the alert trail |
| Alert triage | Typed priority/action/confidence with a written reason trail (`api/app/triage.py`); deterministic by default, swaps to a Jev-shaped API call when `JEV_API_KEY` is set, with the deterministic score always logged alongside as a cross-check |
| Operator workflow | WebSocket alert updates, confirm/dismiss/escalate with a mandatory note |
| Evidence | Linked SHA-256 audit records, per-alert integrity view, and downloadable PDF evidence packet with snapshot hash |
| Reporting | Track-level CSV and PDF with timestamps in IST, top candidates, read status, source label |

The route gate is a conservative **estimate**, not an OSRM road route. Camera health is built from what the pilot actually measures — heartbeat staleness, ingest status, and whether `ffprobe` could read stream timing — not from real NTP clock-drift telemetry, since no device in this pilot reports that. It has not been calibrated against actual road travel times. The local stack has not been load tested for 80,000 cameras. See [the HLD](docs/hld.md) for the expansion design and the exact gaps.

## Verify

From a Python environment with `api/requirements.txt` and `pytest` installed:

```powershell
$env:PYTHONPATH='api'
python -m pytest tests/test_pipeline.py -q
```

For the web app, run `npm ci` and `npm run build` in `web/`. `docker compose config --quiet` validates the Compose file without starting containers.

## Project boundaries

No challenge login, government camera URL, team footage, or consent image was provided. The public Sentinel portal did not expose usable sandbox feeds during this build. The synthetic scenario and public traffic clip cannot be represented as the required government-feed or own-feed submissions. Do not upload them as such. The plan PDF is a working reference, while the official challenge portal controls eligibility and deadlines.

The public MeitY Startup Hub [hackathon announcement](https://www.linkedin.com/posts/meitystartuphub_meitystartuphub-gujaratpolice-gujaratpolicehackathon-activity-7505208387450777600-RqK5) lists 15 September 2026 as the submission deadline and 22–23 September 2026 for the event. As of this build on 27 September 2026, confirm any extension or next round directly with the organizer before planning a submission.

The API currently uses one process for matching and WebSocket fan-out. This makes the pilot easy to run but is not the planned distributed Redis/NATS production design. The operator UI uses OpenStreetMap online tiles; the video and AI path itself stays local.
