# Architecture

EdgeVision is four cooperating layers and one SQLite file. This document
explains how each layer is actually built, why the boundaries sit where
they do, and where the honest stand-ins are. The component diagram is
[docs/assets/architecture.svg](assets/architecture.svg); the data flow is
[assets/data-flow.svg](assets/data-flow.svg) and the engine internals are
in [assets/realtime-pipeline.svg](assets/realtime-pipeline.svg).

```
┌────────────────────────────────────────────────────────────────────┐
│ Browser: React 19 dashboard (single / route, 9 views, RTL)          │
│   REST /api/v1 (HTTP)         socket.io client (WS, auto-reconnect) │
└──────────────┬───────────────────────────────┬──────────────────────┘
               │                               │
┌──────────────▼───────────────┐   ┌───────────▼─────────────────────┐
│ Next.js app :3000            │   │ Engine service :3003 (Bun)      │
│  /api/v1 route handlers      │   │  socket.io (path "/") rooms     │
│  Prisma READS                │   │  /internal/* API (token)        │
│  zod validation              │──►│  owns ALL SQLite writes         │
│  mutation forwarding         │   │  spawns/supervises engine procs │
└──────────────┬───────────────┘   └───────────┬──────────┬──────────┘
               │ read                          │ write    │ stdin text
┌──────────────▼───────────────────────────────▼──────────▼──────────┐
│ SQLite db/custom.db (WAL)      Native C++20 engine (per session)    │
│                                NDJSON on stdout, commands on stdin  │
└────────────────────────────────────────────────────────────────────┘
```

## Layer 1: the native engine (`engine-cpp/`)

A C++20 program with zero external dependencies (no OpenCV, no ONNX
Runtime, no JSON library; serialization is a hand-written builder in
`json_out.hpp`). Built with
`g++ -std=c++20 -Wall -Wextra -Wconversion -Wshadow -Werror -pthread -O2`
(`scripts/build-engine.sh`) or CMake. One process runs one stream session.

### Process and thread model

- **Producer thread** (`Session::producer_loop`): advances the scene at
  the target FPS using fixed-dt integration (reproducible; the same seed
  replays the same trajectories), wraps the render state into a `Frame`,
  pushes it into the bounded queue, and records a source timestamp for
  FPS. It sleeps in slices of at most 100 ms so shutdown never waits.
- **Consumer loop** (main thread, `Session::consumer_loop`): pops a frame,
  runs detect → track → events → emit, records latency, then polls stdin
  non-blockingly (commands are tiny and must never stall the pipeline),
  then checks the metrics tick.
- **Bounded frame queue** (`frame_queue.cpp`): capacity 5-200 (default
  30). **Drop-oldest** on overflow: when the consumer lags, the oldest
  frame is the least valuable one (live analytics prefers the freshest
  world state), the producer never blocks, and every drop is counted and
  reported (`droppedTotal`), never hidden.

### The NDJSON boundary

The engine speaks strict NDJSON on stdout (one JSON object per line,
single `write()` per line so lines never interleave; `emit.hpp`) and
accepts text commands on stdin: `stop`, `ping`, `set grid CxR`,
`set queue N`, `set emit-stride N`. Line types: `ready`,
`session_started`, `state`, `frame`, `event`, `metrics`,
`settings_applied`, `pong`, `session_stopped`, `error`.

Why stdout/stdin rather than a library or socket: it is a language-neutral
process boundary. The engine can segfault without taking the service down
(crash isolation); it can be replaced by an engine written in any language
that honors the contract; it can be tested by spawning it from a Python
harness (`engine-cpp/tools/engine_smoke.py`) with no test-only hooks.
SIGTERM triggers a graceful stop; exit codes are meaningful (0 graceful,
2 config invalid, 3 internal error). SIGPIPE is ignored: a dead parent
surfaces as a write error we handle, not a kill.

### Detector: the grid-scan stand-in

The honest headline: this is a deterministic stand-in for an ONNX model.
It only ever sees the rendered footprints, never ground-truth ids, and it
does real, grid-proportional arithmetic (which is what the measured
latency actually measures). Stages (`detector.cpp`):

1. **Grid quantization**: the frame is covered by a cols x rows inference
   grid (16-80 x 9-48). A 20-channel multi-scale kernel sweep evaluates
   every (cell, object, channel) response, no distance culling: per-frame
   cost is strictly proportional to grid size.
2. **Occupancy**: cells above a 0.5 mean fine-channel response threshold
   are occupied.
3. **Connected components**: 4-connectivity labeling with union-find;
   components under 2 cells are noise.
4. **Boxes and classification**: component bounds become normalized
   boxes; size/aspect heuristics on the quantized box decide the class
   (wide → VEHICLE, medium and not tall → CYCLIST, else PEDESTRIAN).
   Overlapping objects merge into one component, so heavy occlusion
   genuinely degrades the detection.
5. **Confidence**: `0.46 + 0.34·stability + 0.14·plausibility +
   0.06·sharpness + noise`, clamped to [0.2, 0.99], where stability is
   IoU against the same box one frame ago, plausibility compares area to
   the class's expected area, sharpness is fine vs. coarse channel
   response, and noise is a bounded deterministic random walk per box
   chain.
6. **Output filter**: class filter and confidence threshold are applied
   here, so the tracker only ever sees what the protocol would emit.

### Tracker

IoU nearest-neighbor matching (SORT family, no motion model): greedy
highest-IoU pairs with a minIoU gate. Lifecycle parameters are frozen:
**minHits 3, maxAge 12, minIoU 0.3**. A track becomes CONFIRMED after 3
consecutive hits and is deleted after 12 missed frames; only CONFIRMED
tracks matched *this* frame are emitted. "Matched now" vs. "matched last
frame" are tracked explicitly and separately, which was a real bug lesson
from an earlier build. Track ids are stable and monotonic.

### Event geometry

On confirmed tracks (`events.cpp`):

- **LINE_CROSS**: the signed side (cross product) of the track centroid
  against the directed line; the event fires once per sign flip, with the
  direction (`L2R`/`R2L` for vertical lines, `T2B`/`B2T` for horizontal)
  in the payload. A track born on one side fires nothing until it
  actually crosses.
- **ROI_ENTER / ROI_EXIT**: centroid vs. rect with a **0.02 hysteresis
  margin**: enter requires the centroid strictly inside (margin in), exit
  requires it clearly outside (margin out). A centroid hovering on the
  border cannot oscillate into an event storm.

### Metrics: exact definitions

Every value is measured, never simulated (`performance_monitor.cpp`):

| Metric | Definition |
| --- | --- |
| sourceFps / processedFps | (frames in window - 1) / span of their timestamps, over a sliding ~2 s window capped at 512 samples |
| latency avg/min/max/P50/P95 | wall-clock ms via `steady_clock` around detect + track + events (+emit start) per frame, aggregated over the window |
| queueDepth / droppedTotal | queue occupancy at tick time / cumulative dropped-oldest count |
| cpuPercent | (utime+stime delta from `/proc/self/stat` between consecutive ticks) / wall-clock delta × 100 |
| memoryMb | `VmRSS` from `/proc/self/status`, MB |

### DEGRADED hysteresis

If `processedFps < 0.6 × sourceFps` for 5 continuous seconds the engine
emits a `DEGRADED` state line; it recovers to `RUNNING` only after 10
continuous seconds back above the threshold. The first 2 s after start are
a warmup during which no transition fires. Hysteresis on both edges
prevents flapping at the boundary.

## Layer 2: the engine service (`mini-services/engine-service/`)

Bun + TypeScript on port 3003. Responsibilities, and only these:

- **Own ALL database writes.** One process writes SQLite (WAL mode,
  `busy_timeout=5000`, `bun:sqlite` raw SQL, prepared statements, explicit
  transactions); this is what makes the read/write split safe.
- **Session supervision**: spawn the engine with the stream's config
  (`protocol.ts` builds the argv; the seed is a stable FNV-1a hash of the
  stream id, so each stream is deterministic per id), pump stdout/stderr,
  track state transitions, escalate stop (graceful `stop` → SIGTERM after
  5 s → SIGKILL after 2 s), and finalize sessions: crash → `ERROR` with
  `engine_crash_exit_<code>`; boot-time reconciliation marks phantom
  sessions from a crashed service as `ERROR`/`service_restarted`.
- **Write policy**: detections are batched and flushed every 1 s;
  events are written immediately; every 2nd metrics line is persisted
  (`metricsPersistEvery`); session rows are updated on every metrics tick.
- **Retention**: metrics older than 24 h deleted, detections trimmed to
  100k rows, events to 20k; a sweep transaction runs every 5 minutes.
- **Realtime**: socket.io at path `"/"` (a gateway contract; the code
  re-orders request listeners so `/internal/*` stays reachable). Rooms are
  `stream:<id>`; `subscribe`/`unsubscribe` join and leave rooms. On
  connect the server emits `hello`.
- **Model registry seeding**: two configuration rows are inserted with
  `INSERT OR IGNORE` on every boot (idempotent).

### The internal API

`/internal/health`, `/internal/snapshot`, `/internal/streams` (POST),
`/internal/streams/:id` (PATCH, DELETE with cascade), `/internal/streams/:id/start|stop`
(POST), `/internal/models` (POST), `/internal/models/:id` (PATCH),
`/internal/settings` (GET, PATCH). Every request must carry the
`x-internal-token` header (`EV_INTERNAL_TOKEN`, default `edgevision-local`
for local development). Bodies are capped at 256 KB.

## Layer 3: the web API (`src/app/api/v1/`)

Next.js route handlers on port 3000. The split:

- **Reads go through Prisma** against the same SQLite file. WAL lets one
  reader process coexist with the writer process without contention.
- **Mutations never touch the database directly**: they validate with zod
  (`src/lib/edgevision-server/schemas.ts`, Persian messages), then forward
  to the internal API with a 5 s timeout (10 s for start, 15 s for stop,
  which waits for graceful engine shutdown), then read the result back
  through Prisma and return it.

Why: exactly one writer means no cross-process write races, no ORM-vs-raw-
SQL schema drift ownership, and the service can batch, retain, and
broadcast without coordinating with anyone. The cost is one HTTP hop per
mutation, which is irrelevant at this scale. Two correctness details worth
knowing: time-range filters use raw SQL with ISO-string binding because
Prisma binds DateTime filters to SQLite as epoch numbers and SQLite's
cross-type ordering would silently corrupt the comparison
(`src/lib/edgevision-server/sql.ts` documents this); and the active-session
snapshot is cached 2 s in memory.

Other guard rails: 60 mutations/minute per IP (in-memory token bucket),
1 MB body cap, canonical error envelope `{error:{code,message,details?}}`
with Persian messages and English codes, and `withApi` wrapping so an
unhandled exception becomes a clean 500 with no stack trace.

## Layer 4: the dashboard (`src/app/page.tsx`, `src/components/edgevision/`)

A single `/` route hosting nine views (sidebar navigation, view state in
the URL). The client library (`src/lib/edgevision/`) holds a typed REST
client with an 8 s timeout and Persian error mapping, a socket.io
singleton that re-subscribes on every (re)connect, and Persian formatting
(digits, Jalali dates, durations, state labels). LiveScene renders the
scene, detection boxes, ROI and line as SVG per frame; Recharts draws
analytics. A polling layer backstops the socket for lists and health.
Design: dark zinc/emerald, Vazirmatn font, RTL, tabular digits.

## Data flow, end to end

For a frame in a running session:

1. Producer thread renders the scene state → bounded queue (drop-oldest
   under pressure).
2. Consumer runs the detector, tracker and event engine; if the frame
   index is a multiple of the emit stride, a `frame` line goes to stdout.
3. Every 1 s a `metrics` line goes out; state lines only on transitions.
4. The service parses each line: detections are buffered (flushed every
   1 s in one transaction), events are inserted immediately and broadcast,
   metrics are broadcast and every 2nd one persisted.
5. socket.io rooms fan the payloads out to subscribed browsers; the
   LiveScene and metric cards update.
6. The REST API reads the retained rows for the explorers, charts, and
   reports (CSV with a UTF-8 BOM so Excel keeps Persian text intact).

Diagrams: [data-flow.svg](assets/data-flow.svg),
[realtime-pipeline.svg](assets/realtime-pipeline.svg),
[deployment.svg](assets/deployment.svg).

## Database schema

Six tables, snake_case columns, indexed on the hot paths
(`prisma/schema.prisma` is the read model; the service writes the same
names in raw SQL):

| Table | Key columns | Written when |
| --- | --- | --- |
| `streams` | config fields + `status` | on create/edit (service); status on lifecycle |
| `sessions` | `state`, `reason`, counters, `started_at`, `ended_at` | on start, on metrics ticks, on finalize |
| `detections` | `session_id`, `frame_index`, `ts`, `label`, `confidence`, `track_id`, box | batched every 1 s |
| `events` | `type`, `track_id`, `label`, `payload_json`, `ts` | immediately |
| `metrics` | fps, latency stats, queue, cpu, memory, totals | every 2nd engine metrics line |
| `models` | registry metadata + `is_active` | on boot (seed) and on register/activate |

DateTime columns store ISO-8601 UTC strings (written by the service as
`new Date(ms).toISOString()`), which is why all time-range SQL binds ISO
strings.

## Security boundaries

Loopback by default. Three boundaries exist: browser → web API (rate
limit, body cap, validation, no secrets in responses), web API → engine
service (shared internal token), engine service → engine child (strict
argv/stdin contract, sanitized ids, whitelisted commands). See
[../SECURITY.md](../SECURITY.md) for the full threat model and the
explicit non-goals (no multi-tenant auth in v1.0.0).

---

Copyright © 2026 Parsa Fathi — Apache-2.0
