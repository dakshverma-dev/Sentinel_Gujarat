# Camera-wall sample footage

`camera-1.mp4`, `camera-2.mp4`, and `camera-3.mp4` are three distinct clips from [Pexels](https://www.pexels.com), used under the [Pexels License](https://www.pexels.com/license/) (free for this kind of embedded, non-standalone use; attribution not legally required, credited here anyway). Their JPEG files are poster frames extracted locally. None of the three is Indian footage — see the per-clip locations below — and none is related to the seeded Ahmedabad map positions, camera names, or synthetic watchlist events. They are neither the team's own footage nor a Gujarat government feed.

| File | Source | Videographer | Location / scene |
| --- | --- | --- | --- |
| `camera-1.mp4` | [pexels.com/video/3405804](https://www.pexels.com/video/drone-footage-of-cars-on-the-road-3405804/) | Tom Fisk | Aerial drone shot, daytime city intersection (Indonesia) |
| `camera-2.mp4` | [pexels.com/video/2980829](https://www.pexels.com/video/low-angle-footage-of-vehicle-traffic-on-a-city-street-on-a-drizzly-night-2980829/) | George Morina | Ground-level, night, rain-slicked street (London, UK) |
| `camera-3.mp4` | [pexels.com/video/4791734](https://www.pexels.com/video/traffic-flow-in-an-intersection-4791734/) | German Korb | Ground-level, daytime, urban intersection (Montreal, Canada); trimmed locally from the 64s source to 15s |

Each was re-encoded to a smaller CDN rendition on Pexels and, for `camera-1` and `camera-3`, trimmed to roughly 15 seconds with `ffmpeg -t 15 -c copy` (no re-encoding, just a shorter cut). These clips are illustrative replays only, chosen for genuinely different camera angles and lighting so each map tile is visually distinguishable. They are not a substitute for the required own-feed or government-feed submissions.
