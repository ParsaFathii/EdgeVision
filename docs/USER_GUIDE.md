# User Guide

How to actually use the EdgeVision dashboard. The UI is Persian and
right-to-left; this guide uses the Persian labels you will see on screen
with English explanations. Field names in API payloads stay English.

## First run

After a fresh install the database is empty, and every view says so
plainly: the overview shows an empty-state card («هنوز استریمی ثبت نشده
است» style), the explorers explain that data appears once a stream runs,
and the model registry lists the two seeded configurations that boot with
the engine service. There is no fake demo data anywhere: no pre-seeded
detections, no synthetic history rows. The only seed is the model registry
metadata, because the settings view needs defaults to show.

## Quick start

The overview view has a «راه‌اندازی سریع» button. It creates a **real
stream** named «استریم خیابان اصلی» and starts it immediately:

- scene STREET, 640x360, 15 FPS, 8 objects, confidence threshold 0.35;
- all three classes enabled;
- a monitoring ROI covering the middle of the frame and a vertical crossing
  line at x=0.5 (the street scene crosses it regularly);
- queue capacity 30, inference grid 40x24, emit stride 2, all read from
  your settings defaults.

You are then navigated to the stream detail view where the live scene
starts rendering within a couple of seconds. The button is not a canned
demo: it goes through the same API, the same session lifecycle, and the
same engine process as anything you configure by hand.

## Creating a stream

«استریم‌های زنده» view, then the create button. Every field, its range,
and what it really does:

| Field | Range | Meaning |
| --- | --- | --- |
| نام (name) | 1-80 characters | Display name, shown in lists and the sidebar |
| صحنه (scene) | STREET / INTERSECTION / PARKING | The synthetic scene the engine watches: خیابان (two-lane road with a crosswalk), چهارراه (bidirectional + turning flows), پارکینگ (slow maneuvers) |
| عرض / ارتفاع (width x height) | 320-1920 x 240-1080 | Simulated camera raster; also the aspect ratio of the live view |
| نرخ فریم (targetFps) | 1-30 | Frames the producer generates per second |
| تعداد اشیا (objectCount) | 3-20 | Scene population (vehicles, pedestrians, one cyclist in street/intersection scenes) |
| آستانه اطمینان (confidenceThreshold) | 0.05-0.95 | Detections below this confidence are dropped before tracking |
| فیلتر کلاس (classFilter) | PEDESTRIAN / VEHICLE / CYCLIST | Empty means all classes |
| ناحیه پایش (ROI) | x, y, w, h in 0..1 | The monitoring region; ROI_ENTER/ROI_EXIT events fire on the ROI boundary (with hysteresis) |
| خط عبور (line) | x1, y1, x2, y2 in 0..1 | The crossing line; LINE_CROSS fires when a track's centroid changes side |
| ظرفیت صف (queueCapacity) | 5-200 | Bounded frame queue size; overflow drops the oldest frames |
| شبکه استنتاج (gridCols x gridRows) | 16-80 x 9-48 | The inference grid; the dominant cost knob (see Settings below) |
| گام انتشار (emitStride) | 1-10 | Every Nth frame is emitted to the live view |

All coordinates are normalized (0..1 of the frame), so the same ROI and
line work at any resolution. The editor shows a live preview box with your
ROI and line drawn on a frame-shaped canvas, so you can position them
before saving. Validation messages are Persian and name the exact rule
that failed, for example: «نرخ فریم باید بین 1 و 30 باشد».

## Starting and stopping

Starting a stream (play button on a stream card, or in the detail view)
does the following, in order: a session row is created (`STARTING`), the
service spawns a native engine process with your stream's configuration,
the engine reports `session_started` and `RUNNING`, and the dashboard
receives realtime frames over the WebSocket. Stopping asks for
confirmation («نشست فعال این استریم متوقف شود؟»), sends the stop command,
and the engine shuts down gracefully, writes its summary, and the session
row is finalized.

States you will see (Persian on screen, English in the API):

| Stream status | Persian | Meaning |
| --- | --- | --- |
| IDLE | غیرفعال | Not running; can be started |
| STARTING | در حال راه‌اندازی | Engine process spawning |
| RUNNING | در حال اجرا | Session active |
| STOPPING | در حال توقف | Graceful shutdown in progress |
| ERROR | خطا | Session failed; starting again resets it |

| Session state | Persian | Meaning |
| --- | --- | --- |
| STARTING | در حال راه‌اندازی | Same as the stream's STARTING |
| RUNNING | در حال اجرا | Processing frames normally |
| DEGRADED | با افت کیفیت | Processed FPS below 60% of source FPS for 5 s; recovers after 10 s above |
| STOPPING | در حال توقف | Graceful stop in progress |
| STOPPED | پایان‌یافته | Ended cleanly (reason recorded) |
| ERROR | خطا | Crashed or failed (reason recorded, e.g. engine_crash_exit_9) |

You cannot edit or delete a stream while it is running: the API answers
409 with a Persian message; stop it first.

## Reading the live view

The stream detail view (جزئیات استریم) is the heart of the product. The
LiveScene component draws an SVG per frame:

- the **scene** background (road markings, lanes, crosswalk, parked
  rectangles, depending on scene type);
- **detection boxes** in emerald with a chip label like «خودرو ٪۹۲»
  (class + confidence) and the track id;
- the **ROI** («ناحیهٔ پایش») and the **crossing line** («خط عبور») you
  configured, overlaid so you can verify event geometry against what you
  see;
- badges with the current frame number («فریم ۱٬۳۰۱») and the frame's
  measured latency («تأخیر ۱۰ میلی‌ثانیه»).

The stale-data chip «داده‌های کهنه» appears when the stream is running but
no frame has arrived for more than 5 seconds: the socket is reconnecting,
the engine stopped, or the service bounced mid-session. It clears as soon
as frames flow again. The connection chip in the header (متصل / در حال
اتصال مجدد…) reflects the WebSocket itself; the socket client
re-subscribes to your streams automatically after every reconnect.

## Metric cards

Each card is a real measurement of the running pipeline (definitions and
formulas in [ARCHITECTURE.md](ARCHITECTURE.md)):

| Card | Unit | What it is |
| --- | --- | --- |
| نرخ فریم منبع / پردازش | fps | Frames generated vs. frames fully processed per second, counted in a ~2 s window |
| تأخیر (avg / min / max / P50 / P95) | ms | Wall-clock time of detect + track + events per frame |
| صف | frames | Queue depth vs. capacity («۲ از ۳۰»); drops are counted separately |
| پردازنده (CPU) | ٪ | utime+stime delta of the engine process between metric ticks |
| حافظه | MB | VmRSS of the engine process |
| فریم‌ها / تشخیص‌ها | count | Cumulative frames processed and confirmed detections |

## Detections explorer

کاوشگر تشخیص lists every retained detection row with filters: stream,
label (from the live label list), minimum confidence, time range, and
pagination. Each row shows the track id, label, confidence (as a bar),
frame index, timestamp (Jalali) and box coordinates. The CSV export
(`GET /api/v1/reports?format=csv`) downloads a UTF-8-BOM file, which
Excel opens with Persian text intact; the columns are
`ts,streamId,sessionId,frameIndex,trackId,label,confidence,x,y,w,h`.

## Events

The events view (رویدادها) lists events with a natural Persian sentence
for each row, plus the raw JSON payload in an expandable block:

| Type | Persian | Example sentence |
| --- | --- | --- |
| LINE_CROSS | عبور از خط | «خودرو (مسیر ۱) از خط عبور کرد — جهت چپ به راست» |
| ROI_ENTER | ورود به ناحیه | «عابر پیاده (مسیر ۷) وارد ناحیهٔ پایش شد» |
| ROI_EXIT | خروج از ناحیه | «خودرو (مسیر ۴۳) از ناحیهٔ پایش خارج شد» |
| SESSION_END | پایان نشست | «نشست به پایان رسید — دلیل: user_stop» |
| ERROR | خطا | «خطا در پردازش رخ داد: …» |

The LINE_CROSS payload carries the line geometry and direction (`LR`,
`L2R` and similar forms; the dashboard renders the direction in Persian).
Filter by type and time range; pagination matches the detections explorer.

## Analytics

تحلیل‌ها draws four Recharts visualizations from retained data: counts by
label, events by type, FPS and latency over time (bucketed; default 30 s
buckets), and a sessions table with durations («۱ دقیقه و ۵۴ ثانیه»).
Interpretation notes: buckets average the persisted metric rows (the
engine emits a metrics line every second and the service stores every
second one, so a bucket averages roughly one stored row per two seconds
of engine time), so a bucket's FPS is the mean over its window, not a
spike chart; latency P95 matters more than the average when you change
the inference grid. The session picker narrows charts to one session.

## Models

مدل‌ها shows the model registry: metadata for deployable model
configurations. Two entries are seeded (`edgevision-detect-s`,
`edgevision-detect-m`) with their input shapes, class lists, sizes and
licenses. The switch activates one model at a time (single-active:
activating B deactivates A). Honest note, stated in the UI itself: in this
build the registry is configuration metadata, and detection is performed
by the native grid-scan detector; no ONNX weights are shipped. See
[MODELS.md](MODELS.md) for what a future integration would plug into.

## Sessions

نشست‌ها lists session history per stream and state: start/end times
(Jalali), duration, frames processed, frames dropped, detections and
events totals, and the terminal reason (user_stop, engine_crash_exit_9,
service_restarted, ...). It is the first place to look when something went
wrong: the reason column tells you which side failed.

## Settings

تنظیمات exposes the engine defaults used for new streams, persisted by
the engine service (they survive service restarts):

| Default | Range | Real effect |
| --- | --- | --- |
| شبکه استنتاج (grid) | 16-80 x 9-48 | The dominant cost: raising the grid from 40x24 to 80x48 roughly quadruples per-frame arithmetic, and the latency card rises visibly within seconds |
| ظرفیت صف (queue) | 5-200 | How far the consumer may lag before the oldest frames are dropped |
| گام انتشار (stride) | 1-10 | 1 emits every frame: the live scene looks smoother; 4 halves the WebSocket traffic |

Display preferences (Persian digits, Jalali dates) are stored locally in
your browser, not on the server.

## Keyboard and accessibility notes

- All interactive controls are reachable by keyboard; focus rings follow
  the dark zinc/emerald design system.
- Navigation landmarks and `aria-label`s are in Persian; icon-only buttons
  carry accessible names.
- Touch targets are at least 44 px; the sidebar collapses to a Sheet
  (hamburger) below the desktop breakpoint.
- Numbers in metric contexts use tabular digits so columns align.

## FAQ

**Why is there no real camera?** This build runs a deterministic synthetic
scene simulator as the video source (an honest stand-in, documented in the
README). The source abstraction exists in the engine; a capture backend
(OpenCV/FFmpeg) is not bundled.

**Why does the confidence value change frame to frame?** Confidence is
computed per detection from measured properties (box stability, size
plausibility, response sharpness) plus a small deterministic noise walk,
so it moves in a natural band around a stable value. It is not a random
number generator, and it is not a neural network score.

**What happens if the engine crashes?** The session is marked ERROR with
the exit code in the reason, the stream status becomes ERROR, an ERROR
event row is written, and everything else keeps running. Start the stream
again and it recovers. If the whole engine service restarts, phantom
sessions are reconciled to ERROR at boot.

**Why did my old data disappear?** Retention: metric rows are kept 24
hours, detections are capped at 100k rows, events at 20k; the oldest rows
are swept every 5 minutes. Deleting a stream removes its sessions,
detections, events and metrics with it.

**Why do the FPS numbers differ slightly from my stream's target FPS?**
They are measured (frames counted in a sliding window), not configured.
Scheduling jitter makes 15 FPS read as 14.9 or 15.1; that is the point of
measuring.

---

Copyright © 2026 Parsa Fathi — Apache-2.0
