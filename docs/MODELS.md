# Models

What the model registry is, what it is not, and what it would take to run
real ONNX inference in the native engine.

## The registry is metadata

The `models` table (see `prisma/schema.prisma`, seeded by
`mini-services/engine-service/seed.ts` on every boot with `INSERT OR
IGNORE`) stores **configuration metadata for deployable model
configurations**: name, task, format, device, input shape, class list,
size, license, description, and a single `isActive` flag. It is a
deployment manifest, not a weight store: no binary model files live in
this repository, and nothing in the running pipeline reads weights.

## The two seeded configurations

| Field | `edgevision-detect-s` | `edgevision-detect-m` |
| --- | --- | --- |
| task / format / device | OBJECT_DETECTION / ONNX / CPU | OBJECT_DETECTION / ONNX / CPU |
| inputShape | `1x3x416x416` | `1x3x640x640` |
| classes | PEDESTRIAN, VEHICLE, CYCLIST | PEDESTRIAN, VEHICLE, CYCLIST |
| sizeBytes | 7,580,000 (~7.2 MB) | 25,900,000 (~24.7 MB) |
| license | Apache-2.0 | Apache-2.0 |
| description | «مدل سبک تشخیص اشیا برای پردازنده — چیدمان YOLOv8» | «مدل متوسط با دقت بالاتر برای پردازنده» |
| isActive | yes (seed default) | no |

Single-active semantics: `PATCH /api/v1/models/:id` with
`{"isActive": true}` activates one row and deactivates all others in a
single transaction. The registry is informational for the pipeline in this
build; it drives the UI and records intent for deployment.

## Using the registry from the API

List (captured live, one item shown):

```console
$ curl -s http://127.0.0.1:3000/api/v1/models
{"items":[{"id":"edgevision-detect-s","name":"edgevision-detect-s",
"task":"OBJECT_DETECTION","format":"ONNX","device":"CPU","inputShape":"1x3x416x416",
"classesJson":"[\"PEDESTRIAN\",\"VEHICLE\",\"CYCLIST\"]","sizeBytes":7580000,
"license":"Apache-2.0","description":"مدل سبک تشخیص اشیا برای پردازنده — چیدمان YOLOv8",
"isActive":true,"createdAt":"2026-10-05T05:11:28.407Z","updatedAt":"2026-10-05T05:58:51.322Z"}]}
```

Activate (captured live; the response is the updated row, and a follow-up
list immediately showed `edgevision-detect-s` flipped to `false`):

```console
$ curl -s -X PATCH -H "content-type: application/json" \
    -d '{"isActive":true}' http://127.0.0.1:3000/api/v1/models/edgevision-detect-m
{"id":"edgevision-detect-m","name":"edgevision-detect-m","task":"OBJECT_DETECTION",
"format":"ONNX","device":"CPU","inputShape":"1x3x640x640",
"classesJson":"[\"PEDESTRIAN\",\"VEHICLE\",\"CYCLIST\"]","sizeBytes":25900000,
"license":"Apache-2.0","description":"مدل متوسط با دقت بالاتر برای پردازنده",
"isActive":true,"createdAt":"2026-10-05T05:11:28.407Z","updatedAt":"2026-10-05T06:27:03.365Z"}
```

Registering a new configuration (validation: `name` 1-80 unique chars,
`inputShape` 1-40 chars, `classesJson` an array of 1-20 strings 1-40 chars
each, optional `task`/`format`/`device` up to 40 chars, `sizeBytes` a
non-negative integer, `license` up to 100 chars, `description` up to 300):

```console
$ curl -s -X POST -H "content-type: application/json" http://127.0.0.1:3000/api/v1/models \
    -d '{"name":"my-detect-config","inputShape":"1x3x512x512",
         "classesJson":["PEDESTRIAN","VEHICLE","CYCLIST"],"sizeBytes":15300000,
         "license":"<your-review>","description":"custom deployment config"}'
```

A duplicate name answers 409 `MODEL_DUPLICATE` («مدلی با این نام ثبت شده
است»). The full request/response reference is in
[API.md](API.md#models).

## How detection actually happens in this build

To be explicit, because this is the kind of thing that should never be
vague: **no ONNX model is executed.** The native engine runs a grid-scan
detector implemented in `engine-cpp/src/detector.cpp`:

1. frame occupancy is quantized onto a cols x rows inference grid with a
   20-channel multi-scale kernel sweep (real arithmetic, cost strictly
   proportional to grid size);
2. cells above a 0.5 occupancy threshold are labeled with 4-connected
   union-find;
3. component bounds become normalized boxes; size/aspect heuristics pick
   the class;
4. confidence combines box stability, area plausibility, response
   sharpness, and a deterministic noise walk.

It is a deterministic stand-in for an ONNX model: honest about being a
substitute, real about being measured. The latency numbers on the metric
cards are the true cost of this detector on your machine.

## Where an ONNX integration would plug in

The engine was shaped so the swap is localized:

| Boundary | File | What changes |
| --- | --- | --- |
| Detector interface | `engine-cpp/src/detector.hpp` (`detect(const std::vector<SceneObject>&, frame_idx)`) | Replace the grid-scan body with preprocessed-frame → ONNX Runtime session → NMS → `Detection`s; the struct and downstream stages stay |
| Frame content | `engine-cpp/src/frame_queue.hpp` | The `Frame` currently carries the scene render state; a real camera source would carry pixels, and the producer becomes the capture thread |
| Engine binary + linking | `scripts/build-engine.sh`, `engine-cpp/CMakeLists.txt` | Link ONNX Runtime (MIT license; download the release tarball for your platform yourself) and add its include/lib paths |
| Configuration | `--grid` becomes model input size; stream `inputShape` from the registry flows into argv | `mini-services/engine-service/protocol.ts` already serializes stream config into the CLI contract |

The tracker, event engine, performance monitor, session orchestration,
NDJSON protocol, service, web API, and dashboard need **no changes**: they
consume `Detection`/`TrackOutput`/events, not detector internals. That is
the point of the boundary.

## Weights are not distributed: license hygiene

No `.onnx`, `.pt`, or weight files of any kind are committed to this
repository. This is deliberate:

- popular YOLO families are **AGPL-3.0** (e.g. Ultralytics YOLO) or
  **GPL-3.0** (some YOLOv5 exports); committing their weights would drag
  the whole repository's effective license terms into question;
- if you want real weights, download them yourself from the model's
  publisher, read that model's license, and keep the files **outside the
  repository** (or accept the license consequences knowingly).

The seeded registry rows carry `license: "Apache-2.0"` because they are
configuration metadata authored for this project, not because any weights
exist under that license.

---

Copyright © 2026 Parsa Fathi — Apache-2.0
