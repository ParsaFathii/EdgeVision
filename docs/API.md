# API Reference

The primary served API is the Next.js route layer on port 3000
(`/api/v1/*`). The engine service on port 3003 exposes the internal
control API (`/internal/*`) used by the web layer, plus the socket.io
endpoint. A FastAPI reference implementation of the same REST surface
lives in `services/api-python/` (port 8000) and is documented in its own
README.

All examples marked **captured live** were recorded on 2026-10-05 against
the running stack (app on :3000, service on :3003) with a real STREET
stream session. Outputs are trimmed with `...` only where noted.

## Conventions

| Topic | Rule |
| --- | --- |
| Content type | `application/json; charset=utf-8` (CSV reports: `text/csv; charset=utf-8`) |
| Time parameters | ISO 8601 (`2026-10-05T06:11:41.793Z`) or epoch milliseconds (10+ digits). Epoch seconds (1-9 digits) are also accepted. Invalid values answer 400 |
| Timestamps in responses | ISO 8601 UTC strings |
| Coordinates | normalized 0..1, box top-left origin |
| Pagination | `page` (default 1), `pageSize` (default 25, max 200); list responses are `{items, total, page, pageSize}` |
| Mutations | POST/PATCH/DELETE are rate limited: 60 per minute per client IP (429 when exceeded); request bodies are capped at 1 MB (413) |
| Error envelope | `{"error":{"code":"<ENGLISH_CODE>","message":"<Persian>","details":[...]}}` |

Canonical error codes: `VALIDATION` (400), `NOT_FOUND` (404), `RATE_LIMIT`
(429), `BODY_TOO_LARGE` (413), `ENGINE_DOWN` (503), `INTERNAL` (500), plus
forwarded service codes (`SESSION_ACTIVE`, `STREAM_ACTIVE`,
`ENGINE_BINARY_MISSING`, `MODEL_DUPLICATE`, ...).

```json
{"error":{"code":"NOT_FOUND","message":"موردی یافت نشد"}}
```

## Health

### `GET /api/v1/health`

Aggregates the database and the engine service. Captured live:

```json
{
  "status": "ok",
  "db": true,
  "engine": true,
  "engineBinary": true,
  "activeSessions": 1,
  "version": "1.0.0",
  "uptimeSec": 5531
}
```

`status` is `"ok"` or `"degraded"` (db or engine unhealthy).

## Streams

### `GET /api/v1/streams`

Every stream (Prisma read) with its active session, if any. Captured live
(single-item list, trimmed):

```json
{"items":[{"id":"5f987f9e-55e8-4f96-9058-a7ed4a80c17e","name":"استریم خیابان اصلی",
"scene":"STREET","sourceType":"SYNTHETIC","width":640,"height":360,"targetFps":15,
"objectCount":8,"confidenceThreshold":0.35,
"classFilterJson":"[\"PEDESTRIAN\",\"VEHICLE\",\"CYCLIST\"]",
"roiJson":"{\"x\":0.25,\"y\":0.15,\"w\":0.5,\"h\":0.6}",
"lineJson":"{\"x1\":0.5,\"y1\":0.1,\"x2\":0.5,\"y2\":0.9}",
"queueCapacity":30,"gridCols":40,"gridRows":24,"emitStride":2,"status":"RUNNING",
"createdAt":"2026-10-05T05:44:45.951Z","updatedAt":"2026-10-05T06:11:36.859Z",
"activeSession":{"streamId":"5f987f9e-...","sessionId":"6b8cc8c2-...","state":"RUNNING",
"startedAt":"2026-10-05T06:11:36.851Z","framesProcessed":0,"detectionsTotal":0}}]}
```

`activeSession` is `null` when the stream is idle. `roiJson`, `lineJson`
and `classFilterJson` are JSON-encoded strings (as stored).

### `POST /api/v1/streams`

Creates a stream (validated, forwarded to the service). Body fields:

| Field | Type | Range / values | Default |
| --- | --- | --- | --- |
| `name` | string | 1-80 chars | required |
| `scene` | enum | STREET, INTERSECTION, PARKING | required |
| `width` / `height` | int | 320-1920 / 240-1080 | required |
| `targetFps` | number | 1-30 | required |
| `objectCount` | int | 3-20 | required |
| `confidenceThreshold` | number | 0.05-0.95 | required |
| `classFilter` | string[] | subset of PEDESTRIAN, VEHICLE, CYCLIST | `[]` (all) |
| `roi` | object \| null | `{x,y,w,h}` each 0..1, `w,h` > 0 | - |
| `line` | object \| null | `{x1,y1,x2,y2}` each 0..1, non-degenerate | - |
| `queueCapacity` | int | 5-200 | 30 |
| `gridCols` / `gridRows` | int | 16-80 / 9-48 | 40 / 24 |
| `emitStride` | int | 1-10 | 2 |

Status codes: 201 with the created stream (plus `activeSession: null`);
400 `VALIDATION` with per-field Persian details; 503 `ENGINE_DOWN`; 429
when rate limited. Validation error, captured live:

```json
{"error":{"code":"VALIDATION","message":"داده‌های ورودی نامعتبر است",
"details":["صحنه باید یکی از STREET، INTERSECTION یا PARKING باشد"]}}
```

### `GET /api/v1/streams/:id`

One stream plus `activeSession` and `latestMetric` (the newest persisted
metric row for the stream, flat Prisma shape). 404 when unknown.

### `PATCH /api/v1/streams/:id`

Edits a stream. Same fields as create, all optional (partial). 409
`STREAM_ACTIVE` («استریم فعال را نمی‌توان ویرایش کرد») if the stream is
running. The engine reads the configuration at session start: changes take
effect on the next start.

### `DELETE /api/v1/streams/:id`

Deletes the stream and cascades its sessions, detections, events and
metrics. 409 if the stream is running («ابتدا نشست فعال را متوقف کنید»).
Returns `{"ok":true}`.

### `POST /api/v1/streams/:id/start`

Starts a session. Response `{"session":{...}}` with the new session info.
Status codes: 200 started; 409 `SESSION_ACTIVE` if one already runs
(«نشست دیگری برای این استریم در حال اجراست»); 404; 503
`ENGINE_BINARY_MISSING` («موتور بومی ساخته نشده است. اسکریپت
scripts/build-engine.sh را اجرا کنید.») when the binary is absent.

### `POST /api/v1/streams/:id/stop`

Stops the active session gracefully (the service escalates to SIGTERM
after 5 s and SIGKILL after 2 s). Response `{"session":{...}}` with the
finalized record. Captured live through the internal API (same shape the
web layer returns):

```json
{"ok":true,"session":{"streamId":"5f987f9e-...","sessionId":"06f3a202-...",
"state":"STOPPED","reason":"user_stop","startedAt":"2026-10-05T06:14:38.395Z",
"endedAt":"2026-10-05T06:15:53.642Z","framesProcessed":1128,"framesDropped":0,
"detectionsTotal":5542,"eventsTotal":74}}
```

Status codes: 200; 404 `NO_ACTIVE_SESSION`; 503 when the service is down.

## Detections

### `GET /api/v1/detections`

Query parameters:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `streamId` / `sessionId` | uuid | - | equality |
| `label` | string | - | equality (PEDESTRIAN / VEHICLE / CYCLIST) |
| `minConfidence` | number | - | `confidence >= value` |
| `trackId` | int | - | equality; 400 if not an integer |
| `from` / `to` | ISO 8601 or epoch | - | inclusive range on `ts` |
| `page` | int | 1 | |
| `pageSize` | int | 25 | max 200 |
| `sort` | `ts` \| `confidence` | `ts` | |
| `order` | `asc` \| `desc` | `desc` | secondary sort by `id` |

Captured live (`?pageSize=2`, trimmed):

```json
{"items":[{"id":13643,"sessionId":"6b8cc8c2-...","streamId":"5f987f9e-...",
"frameIndex":74,"ts":"2026-10-05T06:11:41.793Z","label":"CYCLIST",
"confidence":0.921,"trackId":12,"x":0.9,"y":0,"w":0.05,"h":0.083}],
"total":8799,"page":1,"pageSize":2}
```

### `GET /api/v1/detections/labels`

Distinct labels with counts, sorted by count descending. Optional
`streamId` / `sessionId`. Captured live:

```json
[{"label":"VEHICLE","count":4412},{"label":"PEDESTRIAN","count":4366},{"label":"CYCLIST","count":21}]
```

## Events

### `GET /api/v1/events`

Query: `streamId`, `type` (must be one of LINE_CROSS, ROI_ENTER, ROI_EXIT,
SESSION_END, ERROR, STATE_CHANGE, else 400), `from`/`to` (on `ts`),
`page`, `pageSize`. Result rows parse `payloadJson` into `payload`.
Captured live (`?pageSize=1`):

```json
{"items":[{"id":13,"sessionId":"f8c8f665-...","streamId":"5f987f9e-...",
"type":"LINE_CROSS","trackId":1,"label":"VEHICLE",
"payload":{"line":[0.3,0.2,0.3,0.8],"direction":"LR"},
"ts":"2026-10-05T05:46:56.413Z","createdAt":"2026-10-05T05:46:56.413Z"}],
"total":4,"page":1,"pageSize":1}
```

Event types: `LINE_CROSS` (payload carries `direction`, e.g. `"LR"` /
`"L2R"`), `ROI_ENTER` / `ROI_EXIT` (empty payload), `SESSION_END`
(summary payload with counters), `ERROR` (reason and exit code).
`STATE_CHANGE` is reserved.

## Metrics

### `GET /api/v1/metrics`

Either bucketed history or the live snapshot.

Bucketed: `streamId`, `sessionId`, `from`/`to`, `bucket` = `1s|5s|30s|1m`
(default `30s`; anything else answers 400 «بازه‌بندی باید یکی از 1s، 5s،
30s یا 1m باشد»). Buckets are keyed by epoch-ms bucket start and average
the persisted rows (one row per ~2 s of engine time); a `summary` object
with the same fields plus min/max latency accompanies the buckets.
Captured live (trimmed to one bucket):

```json
{"bucket":"30s","buckets":[{"ts":1791179070000,"samples":6,"avgSourceFps":15,
"avgProcessedFps":15.766,"avgLatencyMs":13.016,"maxQueueDepth":4,"avgDropped":0,
"avgCpuPercent":27.66,"avgMemoryMb":135.33},... 24 more buckets ...],
"summary":{"samples":330,"avgSourceFps":14.971,"avgProcessedFps":16.128,
"avgLatencyMs":12.093,"minLatencyMs":1.492,"maxLatencyMs":24.8,"maxQueueDepth":4,
"maxDropped":0,"avgCpuPercent":24.05,"avgMemoryMb":119.26,
"maxFramesProcessed":6918,"maxDetections":13836}}
```

Live: `?live=1` returns the latest persisted metric row per active session
plus the session entry, e.g. `{"live":true,"sessions":[{"streamId":...,
"sessionId":...,"state":"RUNNING","startedAt":...,"framesProcessed":30,
"detectionsTotal":93,"metric":{"id":619,...,"sourceFps":14.987,
"processedFps":15,"latencyAvgMs":1.615,"latencyMinMs":1.492,
"latencyMaxMs":2.521,"latencyP50Ms":1.567,"latencyP95Ms":2.146,"queueDepth":0,
"droppedTotal":0,"cpuPercent":2,"memoryMb":1.918,...}}]}` (captured live).
The `metric` field uses the flat database column names (camelCase).

## Models

### `GET /api/v1/models`

The registry. Captured live (trimmed to one item):

```json
{"items":[{"id":"edgevision-detect-s","name":"edgevision-detect-s",
"task":"OBJECT_DETECTION","format":"ONNX","device":"CPU","inputShape":"1x3x416x416",
"classesJson":"[\"PEDESTRIAN\",\"VEHICLE\",\"CYCLIST\"]","sizeBytes":7580000,
"license":"Apache-2.0","description":"مدل سبک تشخیص اشیا برای پردازنده — چیدمان YOLOv8",
"isActive":true,"createdAt":"2026-10-05T05:11:28.407Z","updatedAt":"2026-10-05T05:58:51.322Z"}]}
```

### `POST /api/v1/models`

Registers a configuration. Required: `name` (1-80, unique), `inputShape`
(1-40 chars), `classesJson` (array of 1-20 strings, each 1-40 chars; the
name is historical, the value is an array). Optional: `task`/`format`/
`device` (max 40 chars each; defaults OBJECT_DETECTION / ONNX / CPU),
`sizeBytes` (int >= 0), `license` (max 100), `description` (max 300).
201 with the row; 409 `MODEL_DUPLICATE` («مدلی با این نام ثبت شده است»).

### `PATCH /api/v1/models/:id`

Body `{"isActive": true|false}`. Single-active semantics: activating one
model deactivates every other, in one transaction. Captured live
(activating `edgevision-detect-m` immediately flipped `edgevision-detect-s`
to `false`; the response is the updated row):

```json
{"id":"edgevision-detect-m","name":"edgevision-detect-m","task":"OBJECT_DETECTION",
"format":"ONNX","device":"CPU","inputShape":"1x3x640x640",
"classesJson":"[\"PEDESTRIAN\",\"VEHICLE\",\"CYCLIST\"]","sizeBytes":25900000,
"license":"Apache-2.0","description":"مدل متوسط با دقت بالاتر برای پردازنده",
"isActive":true,"createdAt":"2026-10-05T05:11:28.407Z","updatedAt":"2026-10-05T06:27:03.365Z"}
```

404 `MODEL_NOT_FOUND` when unknown. 400 when `isActive` is not a boolean
(«فیلد isActive باید از نوع بولی باشد»).

## Sessions

### `GET /api/v1/sessions`

Query: `streamId`, `state` (e.g. RUNNING, STOPPED, ERROR), `from`/`to`
(applied to `startedAt`), `page`, `pageSize`. Captured live
(`?pageSize=3`, third item trimmed):

```json
{"items":[{"id":"6b8cc8c2-...","streamId":"5f987f9e-...","state":"RUNNING",
"reason":null,"startedAt":"2026-10-05T06:11:36.851Z","endedAt":null,
"framesProcessed":0,"framesDropped":0,"detectionsTotal":0,"eventsTotal":0},
{"id":"f8c8f665-...","streamId":"5f987f9e-...","state":"ERROR",
"reason":"engine_crash_exit_137","startedAt":"2026-10-05T05:46:53.704Z",
"endedAt":"2026-10-05T05:54:38.957Z","framesProcessed":6933,"framesDropped":0,
"detectionsTotal":13866,"eventsTotal":2},...],"total":3,"page":1,"pageSize":3}
```

## Reports

### `GET /api/v1/reports`

Query: `streamId`, `from`, `to`, `format` = `json` (default) or `csv`
(anything else answers 400).

JSON: aggregates over the range. Captured live (trimmed):

```json
{"generatedAt":"2026-10-05T06:11:46.092Z","range":{"from":null,"to":null},
"streamsSummary":[{"streamId":"5f987f9e-...","name":"استریم خیابان اصلی",
"sessions":3,"detections":8799,"events":10}],"sessionsCount":3,
"detectionsByLabel":[{"label":"VEHICLE","count":4412},...],
"eventsByType":[{"type":"LINE_CROSS","count":3},...],
"metricsAverages":{"avgSourceFps":14.999,"avgProcessedFps":16.309,
"avgLatencyMs":13.488,"avgCpuPercent":26.91,"avgMemoryMb":134.97,
"maxQueueDepth":4,"samples":291},
"topTracks":[{"trackId":1,"label":"VEHICLE","count":4330},...]}
```

CSV: the full detections table with a UTF-8 BOM, CRLF line endings, RFC
4180 escaping, and `content-disposition:
attachment; filename="edgevision-report.csv"`. Header:
`ts,streamId,sessionId,frameIndex,trackId,label,confidence,x,y,w,h`. The
BOM is what makes Excel open the file with Persian labels intact.

## Settings

### `GET /api/v1/settings`

Proxies the engine service defaults. Captured live:

```json
{"defaultGridCols":40,"defaultGridRows":24,"defaultQueueCapacity":30,
"defaultEmitStride":2,"metricsPersistEvery":2}
```

### `PATCH /api/v1/settings`

Partial: `defaultGridCols` (16-80), `defaultGridRows` (9-48),
`defaultQueueCapacity` (5-200), `defaultEmitStride` (1-10). The service
persists them to `mini-services/engine-service/settings.json`; they apply
to newly created streams.

## Internal API (port 3003)

Guarded by the `x-internal-token` header (`EV_INTERNAL_TOKEN`, default
`edgevision-local`). The web layer calls these; you normally do not need
to, except for health checks or ops scripts.

| Endpoint | Purpose |
| --- | --- |
| `GET /internal/health` | `{ok, db, engineBinary, activeSessions, version}` |
| `GET /internal/snapshot` | `{sessions:[...]}` active sessions |
| `POST /internal/streams` | create (validation details in Persian) |
| `PATCH /internal/streams/:id` | edit (409 if active) |
| `DELETE /internal/streams/:id` | cascade delete |
| `POST /internal/streams/:id/start` / `/stop` | session control |
| `POST /internal/models`, `PATCH /internal/models/:id` | registry |
| `GET/PATCH /internal/settings` | service defaults |

Captured live:

```console
$ curl -s -H "x-internal-token: edgevision-local" http://127.0.0.1:3003/internal/health
{"ok":true,"db":true,"engineBinary":true,"activeSessions":0,"version":"1.0.0"}
```

Internal validation failures answer `400 {"message":..., "details":[...]}`;
other internal errors use `{"code":..., "message":...}`. Bodies above
256 KB answer 413. A missing or wrong token answers 401
«توکن داخلی نامعتبر است».

## WebSocket protocol

socket.io v4 on port 3003, **path `/`** (a gateway contract; browser code
in this deployment connects through the preview gateway, native clients
connect directly to `ws://<host>:3003/socket.io/?EIO=4&transport=websocket`).
The engine service sets `pingInterval` 25 s / `pingTimeout` 60 s.

### Client → server

| Event | Payload | Effect |
| --- | --- | --- |
| `subscribe` | `{"streams":["<id>",...]}` | join room `stream:<id>` per id; subsequent events for those streams are delivered |
| `unsubscribe` | `{"streams":["<id>",...]}` | leave the rooms |
| `ping` | any payload, optionally with an ack callback | server answers `pong` and, when a callback was provided, calls it with `{ts}` |

### Server → client

| Event | Payload | Captured live? |
| --- | --- | --- |
| `hello` | `{version, engineBinary, activeSessions:[...]}` (on connect) | yes |
| `pong` | `{ts, echo}` | yes |
| `frame` | `{streamId, sessionId, frameIndex, ts, latencyMs, objects:[{oid,t,x,y,w,h}], detections:[{trackId,label,conf,x,y,w,h}]}` | yes |
| `metrics` | `{streamId, sessionId, ts, sourceFps, processedFps, latency:{avgMs,minMs,maxMs,p50Ms,p95Ms}, queueDepth, queueCapacity, droppedTotal, cpuPercent, memoryMb, framesProcessed, detectionsTotal, uptimeMs}` | yes |
| `event` | `{streamId, sessionId, type, ts, trackId?, label?, payload}` | yes |
| `session` | `{streamId, sessionId, state, reason, startedAt}` on transitions; `{streamId, sessionId, state, reason, endedAt}` on finalize | - |

Captured live against a running STREET stream (trimmed):

```json
{"streamId":"5f987f9e-...","sessionId":"06f3a202-...","frameIndex":472,
"ts":1791180909865,"latencyMs":1.683,
"objects":[{"oid":1,"t":"VEHICLE","x":0.263,"y":0.521,"w":0.122,"h":0.083},...],
"detections":[{"trackId":65,"label":"VEHICLE","conf":0.928,"x":0,"y":0.458,"w":0.125,"h":0.125},...]}
```

```json
{"streamId":"5f987f9e-...","sessionId":"06f3a202-...","ts":1791180910662,
"sourceFps":14.526,"processedFps":14.538,
"latency":{"avgMs":1.764,"minMs":1.624,"maxMs":2.802,"p50Ms":1.672,"p95Ms":2.625},
"queueDepth":0,"queueCapacity":30,"droppedTotal":0,"cpuPercent":1.999,"memoryMb":2.027,
"framesProcessed":483,"detectionsTotal":2493,"uptimeMs":32265}
```

An `event` payload, captured live the same way:
`{"streamId":"5f987f9e-...","sessionId":"06f3a202-...","type":"LINE_CROSS",
"ts":1791180912334,"trackId":52,"label":"VEHICLE","payload":{"direction":"L2R"}}`.

### Reconnect expectations

Clients should auto-reconnect with backoff and re-send `subscribe` for
their wanted streams after every (re)connect: room membership does not
survive a disconnect. The bundled dashboard does exactly this
(`src/lib/edgevision/socket.ts`), and marks the view stale when no frame
arrives for 5 seconds. Events that happen while you are disconnected are
not replayed; read them back through the REST API.

## Ops endpoint (sandbox)

`POST /api/v1/engine-service` on port 3000 ensures the engine service is
running (spawning it detached when down) and requires the internal token.
It exists for the hosting sandbox where shell-spawned background processes
are reaped; it is not part of the product API surface on a normal machine.

---

Copyright © 2026 Parsa Fathi — Apache-2.0
