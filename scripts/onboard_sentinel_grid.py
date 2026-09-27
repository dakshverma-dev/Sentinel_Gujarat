"""Onboard cameras from the external Sentinel Camera Grid (cctv.corp8.cloud)
as real, non-demo cameras in this app -- replacing or supplementing the
synthetic scenario with live feeds.

Requires SENTINEL_GRID_EMAIL and SENTINEL_GRID_PASSWORD in the environment
(see .env.example) and access on file with the grid operator: only approved
emails can connect, per their integrator's guide. This script never prints
or logs a credentialed URL.

Usage (from the project root, API running and reachable):
    $env:SENTINEL_GRID_EMAIL='you@example.com'
    $env:SENTINEL_GRID_PASSWORD='...'
    $env:PYTHONPATH='api;detector'
    python scripts/onboard_sentinel_grid.py --token <operator-or-admin-jwt> [--limit 4]
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "detector"))

import httpx
from worker import sentinel_grid  # noqa: E402  (path insert above must run first)

API = os.getenv("API_URL", "http://127.0.0.1:8000")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token", required=True, help="Bearer token from POST /api/auth/login (admin or operator)")
    parser.add_argument("--limit", type=int, default=None, help="Onboard at most this many grid cameras")
    parser.add_argument("--department", default="Sentinel Grid", help="Department label shown in the console")
    args = parser.parse_args()

    if not sentinel_grid.configured():
        raise SystemExit("Set SENTINEL_GRID_EMAIL and SENTINEL_GRID_PASSWORD before running this script")

    with httpx.Client(timeout=15) as client:
        cameras = sentinel_grid.list_cameras(client)
        if args.limit:
            cameras = cameras[: args.limit]
        print(f"Grid catalogue: {len(cameras)} camera(s) to onboard")

        headers = {"Authorization": f"Bearer {args.token}"}
        for grid_camera in cameras:
            url = sentinel_grid.source_url(grid_camera.id)
            body = {
                "name": grid_camera.name or grid_camera.id,
                "department": args.department,
                "source_url": url,
                "lat": grid_camera.lat if grid_camera.lat is not None else 23.0225,
                "lon": grid_camera.lon if grid_camera.lon is not None else 72.5714,
            }
            response = client.post(f"{API}/api/cameras", json=body, headers=headers)
            if response.is_success:
                print(f"  onboarded {grid_camera.id} -> {response.json()['id']} ({sentinel_grid.redacted(url)})")
            else:
                print(f"  FAILED {grid_camera.id}: {response.status_code} {response.text}", file=sys.stderr)


if __name__ == "__main__":
    main()
