# EdgeVision

EdgeVision is a real-time video analytics platform that runs entirely on one
machine. A native C++20 engine processes each stream in its own process, a
Bun service orchestrates sessions and owns every database write, a Next.js
layer serves the REST API, and a Persian-first RTL dashboard renders the live
scene, detections, events, and charts. The video source in this build is a
deterministic synthetic scene simulator (STREET / INTERSECTION / PARKING),
and the inference step is a genuine grid-scan detector implemented in the
native engine. Both are honest stand-ins: they exercise the full pipeline
end to end, and both are documented as such everywhere in this repository.

Version 1.0.0. Persian-first UI (English documentation, Persian product).

## The problem it solves

Setting up a local video-analytics stack usually means gluing together a
capture library, an inference runtime, a tracker, a database, a REST API, a
WebSocket layer, and a dashboard, and then debugging the seams between them.
EdgeVision ships that whole path as one repo with clear boundaries:

- a **native engine** that does the per-frame work and reports real,
  measured performance (frame rates, per-frame latency, CPU, RSS);
- a **process boundary** over strict NDJSON on stdout, so the engine can
  crash without taking anything down, and can be replaced without touching
  anything above it;
- a **single writer** to SQLite (the engine service), so there are no
  cross-process write races, while the web layer reads through Prisma;
- a **dashboard that is the product**: live scene rendering, event feed,
  metric cards, analytics charts, all in natural Persian.

The result is a platform you can study, extend, or swap parts of (for
example, replacing the grid-scan detector with an ONNX model) without
re-architecting anything.

## Features

- **Native C++20 engine** (`engine-cpp/`): zero external dependencies,
  compiles with g++ or CMake, zero-warning policy (`-Wall -Wextra
  -Wconversion -Wshadow -Werror -pthread`). One process per stream session,
  producer/consumer threads over a bounded queue with a documented
  drop-oldest policy.
- **Grid-scan detector**: frame occupancy quantized to a cols x rows
  inference grid, multi-scale kernel sweep, connected-component clustering,
  size/aspect classification, deterministic confidence. Real arithmetic,
  honestly measured latency.
- **IoU tracker** (SORT family): minHits 3, maxAge 12, minIoU 0.3; only
  confirmed tracks matched this frame are emitted, with stable monotonic
  track ids.
- **Geometric events**: LINE_CROSS via signed-side flip (direction in the
  payload), ROI_ENTER / ROI_EXIT with a 0.02 hysteresis margin.
- **Real performance monitor**: source/processed FPS from actual timestamps,
  per-frame latency avg/min/max/P50/P95, queue depth and drops, CPU% from
  `/proc/self/stat`, RSS from `/proc/self/status`. DEGRADED state with
  hysteresis (enter after 5 s below 60% of source FPS, recover after 10 s).
- **Engine service** (Bun + TypeScript, port 3003): spawns and supervises
  engine processes, owns all SQLite writes (WAL mode), broadcasts realtime
  events over socket.io, batches detection writes (1 s), retention sweeps
  (metrics 24 h, detections 100k rows, events 20k rows).
- **REST API** (`/api/v1`, port 3000): streams CRUD + start/stop, detections
  with filters and pagination, events, bucketed metrics, model registry,
  sessions, JSON/CSV reports, settings. Zod-validated, Persian error
  messages, canonical error envelope, rate-limited mutations.
- **Persian RTL dashboard**: 9 views, live SVG scene renderer with detection
  boxes, ROI overlay and crossing line, Recharts analytics, socket.io client
  with auto-reconnect and re-subscribe, Jalali dates and Persian digits,
  Vazirmatn font, dark zinc/emerald design.
- **Extras**: a FastAPI reference implementation of the same REST surface
  (`services/api-python/`), and a complete Flutter mobile client (`mobile/`).

## Architecture

Four cooperating layers, one SQLite file:

```
Browser (React 19 dashboard)
   │  HTTP/JSON                    WebSocket (socket.io, path "/")
   ▼                                     ▼
Next.js app :3000  ──internal token──►  Engine service :3003
   REST /api/v1                          socket.io rooms · owns ALL writes
   Prisma reads (SQLite)                 spawns & monitors engine processes
   zod-validated mutations                       │ stdin text commands
   forwarded to the service                     ▼ stdout NDJSON
   └────────────► SQLite db/custom.db ◄── Native C++20 engine (per session)
```

The full diagram lives at [docs/assets/architecture.svg](docs/assets/architecture.svg),
with [data-flow](docs/assets/data-flow.svg), [realtime-pipeline](docs/assets/realtime-pipeline.svg)
and [deployment](docs/assets/deployment.svg) views. A detailed write-up is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

| Path | What lives there |
| --- | --- |
| `engine-cpp/` | Native C++20 engine, `tools/engine_smoke.py` smoke harness, `CMakeLists.txt` |
| `mini-services/engine-service/` | Bun + TypeScript orchestration service (port 3003) |
| `src/app/api/v1/` | Next.js route handlers for `/api/v1/*` |
| `src/lib/edgevision-server/` | Shared server helpers (validation, errors, rate limit, internal client) |
| `src/components/edgevision/` | Dashboard views and the LiveScene renderer |
| `src/lib/edgevision/` | Dashboard client library (typed API, socket, formatting) |
| `prisma/schema.prisma` | Database schema (reads only; writes are raw SQL in the service) |
| `scripts/build-engine.sh` | Engine build script (also `--sanitizers`) |
| `docs/` | English documentation |
| `docs/fa/` | Persian documentation |
| `docs/assets/` | SVG diagrams and screenshots |
| `mobile/` | Flutter client (optional) |
| `services/api-python/` | FastAPI reference API (optional) |
| `.github/` | Issue/PR templates and CI workflow |

## Quick start

Tested on Linux (Debian) with g++ 14, Bun 1.3, Node 24. Prerequisites and
troubleshooting: [docs/INSTALLATION.md](docs/INSTALLATION.md).

```bash
# 0. Get the repository
git clone https://github.com/ParsaFathii/EdgeVision.git
cd EdgeVision

# 1. Local environment (SQLite path defaults to db/custom.db)
cp .env.example .env

# 2. Install web dependencies (repo root)
bun install

# 3. Create the SQLite database (prisma/schema.prisma -> db/custom.db)
bun run db:push

# 4. Build the native engine (engine-cpp/build/edgevision-engine)
bash scripts/build-engine.sh

# 5. Start the engine service (port 3003; keep this terminal or use nohup)
cd mini-services/engine-service && bun install && bun run dev

# 6. Start the app (repo root, new terminal; port 3000)
cd ../.. && bun run dev
```

Open <http://localhost:3000>. The overview view has a «راه‌اندازی سریع»
(quick start) button that creates a real STREET stream and starts it. The
engine service logs to `mini-services/engine-service/service.log` when run
with nohup; the app logs to `dev.log`.

## What is real and what is a stand-in

This project is deliberate about honesty. Four things you should know:

1. **Video input is synthetic.** The engine watches a deterministic scene
   simulator (a stand-in for camera/file/network sources). The source
   abstraction exists in the engine, but no real capture backend (OpenCV /
   FFmpeg) is bundled.
2. **The detector is a grid-scan stand-in.** It is genuine, deterministic,
   grid-proportional arithmetic implemented in the native engine, standing
   in for an ONNX model. No ONNX weights are distributed; the model registry
   holds configuration metadata only (see [docs/MODELS.md](docs/MODELS.md)).
3. **Metrics are real measurements of a synthetic pipeline.** Every FPS,
   latency, CPU, and memory value is measured on the actual running
   pipeline, never fabricated. The pipeline itself processes synthetic
   scenes, so treat numbers as measurements of this code, not of a camera.
4. **The FastAPI service is a reference.** `services/api-python/` is a
   runnable reference implementation of the same API against the same
   database. The primary served API in this deployment is the Next.js
   route layer.

More limitations (single-user local deployment, Linux-only testing,
Flutter analyze/test to be run by the user or CI) are listed in
[SECURITY.md](SECURITY.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Test status

- **Engine smoke harness** (`python3 engine-cpp/tools/engine_smoke.py`):
  spawns the real binary, validates every NDJSON line against per-type
  schemas, and asserts protocol behavior across seven scenarios
  (version/config errors/lifecycle/filters/SIGTERM/overload). Exit code is
  the failure count; the current status is green (7/7 scenarios, verified
  in this tree). During verification the suite is run three times
  consecutively, plus one run against the ASan+UBSan build
  (`bash scripts/build-engine.sh --sanitizers`).
- **Lint**: `bun run lint` at the repo root reports zero problems.
- **Dashboard**: verified in a real browser against the live stack (quick
  start, live scene with boxes/ROI/line, metric cards, event sentences,
  CSV export, model activation, settings persistence, mobile navigation,
  and graceful degradation when the engine service goes down mid-session).

## Screenshots

Captured from the running application at a 1440x900 viewport:

| Screenshot | Shows |
| --- | --- |
| [docs/assets/screenshots/overview.png](docs/assets/screenshots/overview.png) | KPIs, active sessions, FPS chart, recent events |
| [docs/assets/screenshots/streams.png](docs/assets/screenshots/streams.png) | Stream list with status badges and actions |
| [docs/assets/screenshots/stream-detail-live.png](docs/assets/screenshots/stream-detail-live.png) | Live SVG scene, detection boxes, ROI, crossing line, metric cards |
| [docs/assets/screenshots/detections.png](docs/assets/screenshots/detections.png) | Detections explorer with filters and confidence bars |
| [docs/assets/screenshots/events.png](docs/assets/screenshots/events.png) | Event feed with Persian sentences and payload expansion |
| [docs/assets/screenshots/analytics.png](docs/assets/screenshots/analytics.png) | Recharts analytics over retained data |
| [docs/assets/screenshots/models.png](docs/assets/screenshots/models.png) | Model registry with the single-active switch |
| [docs/assets/screenshots/sessions.png](docs/assets/screenshots/sessions.png) | Session history table |
| [docs/assets/screenshots/settings.png](docs/assets/screenshots/settings.png) | Engine defaults and display preferences |

A ~30s demo GIF (view tour, live scene with detection boxes, real-time
metrics, detections explorer, events) is at
[docs/assets/screenshots/dashboard-live.gif](docs/assets/screenshots/dashboard-live.gif) —
recorded directly from the running app, no staged frames.

## Documentation

| Document | Language |
| --- | --- |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | English |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | English |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | English |
| [docs/API.md](docs/API.md) | English |
| [docs/MODELS.md](docs/MODELS.md) | English |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | English |
| [docs/fa/README_FA.md](docs/fa/README_FA.md) | Persian |
| [docs/fa/INSTALLATION_FA.md](docs/fa/INSTALLATION_FA.md) | Persian |
| [docs/fa/USER_GUIDE_FA.md](docs/fa/USER_GUIDE_FA.md) | Persian |
| [docs/fa/ARCHITECTURE_FA.md](docs/fa/ARCHITECTURE_FA.md) | Persian |
| [docs/fa/API_FA.md](docs/fa/API_FA.md) | Persian |
| [docs/fa/MODELS_FA.md](docs/fa/MODELS_FA.md) | Persian |
| [docs/fa/DEVELOPMENT_FA.md](docs/fa/DEVELOPMENT_FA.md) | Persian |
| [docs/fa/COPYRIGHT_FA.md](docs/fa/COPYRIGHT_FA.md) | Persian |

Also: [COPYRIGHT.md](COPYRIGHT.md), [SECURITY.md](SECURITY.md) (threat model and reporting),
[CONTRIBUTING.md](CONTRIBUTING.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

Copyright © 2026 Parsa Fathi — Apache-2.0
