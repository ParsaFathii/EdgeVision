# مرجع API

API عمومی اج‌ویژن روی پورت ۳۰۰۰ زیر پیشوند `/api/v1` سرو می‌شود؛ WebSocket بلادرنگ روی پورت ۳۰۰۳ (مسیر `/`). مثال‌های این سند روی سیستم واقعی اجرا و خروجی‌شان ثبت شده؛ موارد بریده‌شده با `…` و اعشارهای بلند گردشده نشان داده شده‌اند.

## قراردادهای عمومی

- **قالب زمان:** پارامترهای `from`/`to` هم ISO 8601 می‌پذیرند هم عدد epoch (اگر ۱۰ رقم یا بیشتر باشد میلی‌ثانیه، کمتر ثانیه). مهرهای زمانی داخل بارهای WebSocket و سنجه‌ها epoch میلی‌ثانیه‌اند؛ فیلدهای زمانی پاسخ‌های REST به‌صورت ISO 8601 UTC برمی‌گردند.
- **صفحه‌بندی:** نقاط فهرست‌دار با `{items, total, page, pageSize}` جواب می‌دهند. `page` از ۱ شروع می‌شود (پیش‌فرض ۱)، `pageSize` پیش‌فرض ۲۵ و سقف ۲۰۰.
- **پاکت خطا:** همهٔ خطاها با یک شکل واحد:

```json
{
  "error": {
    "code": "VALIDATION",
    "message": "داده‌های ورودی نامعتبر است",
    "details": ["نام استریم باید بین 1 و 80 نویسه باشد"]
  }
}
```

`code` انگلیسی و پایدار است (برای کد کلاینت)، `message` فارسی برای نمایش، `details` فقط در خطاهای اعتبارسنجی می‌آید.

- **محدودیت نرخ:** ۶۰ درخواست تغییردهنده در دقیقه به‌ازای هر IP (سطل توکن در حافظهٔ فرایند). پاسخ اضافه‌بار: ۴۲۹ با کد `RATE_LIMIT`. GETها شامل نمی‌شوند.

## سلامت

### GET /api/v1/health

وضعیت کلی: دیتابیس، سرویس موتور و باینری موتور.

```bash
curl -s http://localhost:3000/api/v1/health
```

```json
{"status":"ok","db":true,"engine":true,"engineBinary":true,"activeSessions":0,"version":"1.0.0","uptimeSec":5459}
```

`status` فقط یکی از `ok` یا `degraded` است. فیلدها: `db` (باز بودن SQLite)، `engine` (در دسترس بودن سرویس پورت ۳۰۰۳)، `engineBinary` (وجود فایل باینری موتور)، `activeSessions`، `version`، `uptimeSec`.

## استریم‌ها

### GET /api/v1/streams

فهرست همهٔ استریم‌ها به ترتیب ساخت، هر کدام با `activeSession` (اگر نشست فعالی داشته باشد).

```bash
curl -s http://localhost:3000/api/v1/streams
```

```json
{"items":[{"id":"5f987f9e-55e8-4f96-9058-a7ed4a80c17e","name":"استریم خیابان اصلی","scene":"STREET","sourceType":"SYNTHETIC","width":640,"height":360,"targetFps":15,"objectCount":8,"confidenceThreshold":0.35,"classFilterJson":"[\"PEDESTRIAN\",\"VEHICLE\",\"CYCLIST\"]","roiJson":"{\"x\":0.25,\"y\":0.15,\"w\":0.5,\"h\":0.6}","lineJson":"{\"x1\":0.5,\"y1\":0.1,\"x2\":0.5,\"y2\":0.9}","queueCapacity":30,"gridCols":40,"gridRows":24,"emitStride":2,"status":"IDLE","createdAt":"2026-10-05T05:44:45.951Z","updatedAt":"2026-10-05T06:11:59.565Z","activeSession":null}]}
```

نکته: `classFilterJson`/`roiJson`/`lineJson` رشتهٔ JSON هستند (نه آبجکت تودرتو) — عمداً، چون همین شکل در ستون‌های SQLite می‌نشیند.

### POST /api/v1/streams

بدنهٔ کامل با تمام فیلدها (مقادیر پیش‌فرض سرویس: شبکهٔ ۴۰×۲۴، صف ۳۰، گام ۲):

| فیلد | نوع | بازه/قالب |
|---|---|---|
| name | string | ۱ تا ۸۰ نویسه |
| scene | string | STREET یا INTERSECTION یا PARKING |
| width / height | int | ۳۲۰–۱۹۲۰ / ۲۴۰–۱۰۸۰ |
| targetFps | number | ۱ تا ۳۰ |
| objectCount | int | ۳ تا ۲۰ |
| confidenceThreshold | number | ۰٫۰۵ تا ۰٫۹۵ |
| classFilter | string[] | زیرمجموعهٔ PEDESTRIAN/VEHICLE/CYCLIST (خالی = همه) |
| roi | object یا null | {x, y, w, h} هر یک ۰ تا ۱؛ w و h > ۰ |
| line | object یا null | {x1, y1, x2, y2} هر یک ۰ تا ۱ |
| queueCapacity | int | ۵ تا ۲۰۰ |
| gridCols / gridRows | int | ۱۶–۸۰ / ۹–۴۸ |
| emitStride | int | ۱ تا ۱۰ |

پاسخ موفق **۲۰۱** و همان آبجکت استریم (بعلاوهٔ `activeSession: null`). خروجی ضبط‌شدهٔ یک بدنهٔ ناقص:

```bash
curl -s -X POST http://localhost:3000/api/v1/streams \
  -H "content-type: application/json" \
  -d '{"name":"","scene":"MARS","width":100}'
```

```json
{"error":{"code":"VALIDATION","message":"داده‌های ورودی نامعتبر است","details":["نام استریم باید بین 1 و 80 نویسه باشد","صحنه باید یکی از STREET، INTERSECTION یا PARKING باشد","عرض تصویر باید بین 320 و 1920 باشد","ارتفاع تصویر باید عدد باشد","…"]}}
```

(همان پیام‌ها در سمت کلاینت داشبورد هم دیده می‌شوند؛ اعتبارسنجی سخت‌گیرانه در سرویس موتور دوباره اجرا می‌شود.)

### GET /api/v1/streams/:id

استریم + `activeSession` + `latestMetric` (آخرین ردیف سنجهٔ ذخیره‌شدهٔ این استریم). خروجی ضبط‌شده (کوتاه‌شده):

```json
{"id":"5f987f9e-…","name":"استریم خیابان اصلی","scene":"STREET","…":"…","status":"IDLE","activeSession":null,"latestMetric":{"id":620,"sessionId":"be183142-…","ts":"2026-10-05T06:11:58.097Z","sourceFps":14.833,"processedFps":14.845,"latencyAvgMs":1.615,"latencyMinMs":1.537,"latencyMaxMs":1.709,"latencyP50Ms":1.604,"latencyP95Ms":1.708,"queueDepth":0,"droppedTotal":0,"cpuPercent":3,"memoryMb":1.918,"framesProcessed":60,"detectionsTotal":228}}
```

اگر استریم نبود: `404` با `{"error":{"code":"NOT_FOUND","message":"موردی یافت نشد"}}`.

### PATCH /api/v1/streams/:id

هر زیرمجموعه‌ای از فیلدهای POST (فیلدهای ناموجود دست نمی‌خورند). استریمِ در حال اجرا قابل ویرایش نیست: `409` با کد `STREAM_ACTIVE` و پیام «استریم فعال را نمی‌توان ویرایش کرد» — اول متوقفش کنید.

### DELETE /api/v1/streams/:id

حذف استریم به‌همراه **تمام** تاریخچه‌اش (نشست‌ها، تشخیص‌ها، رویدادها و سنجه‌ها) در یک تراکنش. پاسخ: `{"ok":true}`. اگر نشست فعال داشته باشد: `409` با پیام «ابتدا نشست فعال را متوقف کنید».

### POST /api/v1/streams/:id/start

شروع یک نشست تازه. سرویس فرایند موتور spawn می‌کند و تا RUNNING شدن (حداکثر ~۲٫۵ ثانیه) صبر می‌کند؛ مهلت HTTP روی ۱۰ ثانیه است.

```bash
curl -s -X POST http://localhost:3000/api/v1/streams/5f987f9e-…/start
```

```json
{"session":{"streamId":"5f987f9e-55e8-4f96-9058-a7ed4a80c17e","sessionId":"be183142-4a26-4fa7-84e1-8c42fedb82fc","state":"RUNNING","startedAt":"2026-10-05T06:11:54.065Z","framesProcessed":0,"detectionsTotal":0}}
```

خطاها: `409 SESSION_ACTIVE` («نشست دیگری برای این استریم در حال اجراست»)، `404 STREAM_NOT_FOUND`، `503 ENGINE_BINARY_MISSING` («موتور بومی ساخته نشده است. اسکریپت scripts/build-engine.sh را اجرا کنید.»).

### POST /api/v1/streams/:id/stop

توقف پلکانی نشست فعال (فرمان stop → SIGTERM → SIGKILL؛ مهلت HTTP روی ۱۵ ثانیه). خروجی ضبط‌شده:

```json
{"session":{"streamId":"5f987f9e-…","sessionId":"be183142-…","state":"STOPPED","reason":"user_stop","startedAt":"2026-10-05T06:11:54.065Z","endedAt":"2026-10-05T06:11:59.565Z","framesProcessed":82,"framesDropped":0,"detectionsTotal":342,"eventsTotal":7}}
```

اگر نشست فعالی نباشد: `404 NO_ACTIVE_SESSION` («نشست فعالی برای این استریم یافت نشد»).

## تشخیص‌ها

### GET /api/v1/detections

| پارامتر | نوع | پیش‌فرض | توضیح |
|---|---|---|---|
| streamId / sessionId / label | string | — | فیلتر تساوی |
| trackId | int | — | «شناسه مسیر (trackId) باید عدد صحیح باشد» |
| minConfidence | number | — | کف اطمینان |
| from / to | ISO یا epoch | — | بازهٔ زمانی روی ts |
| page | int | ۱ | |
| pageSize | int | ۲۵ | سقف ۲۰۰ |
| sort | ts یا confidence | ts | |
| order | asc یا desc | desc | |

خروجی ضبط‌شده با `?pageSize=2`:

```json
{"items":[{"id":13364,"sessionId":"f8c8f665-…","streamId":"5f987f9e-…","frameIndex":6931,"ts":"2026-10-05T05:54:38.841Z","label":"PEDESTRIAN","confidence":0.78,"trackId":2,"x":0.12,"y":0.4948,"w":0.05,"h":0.11},{"id":13363,"…":"…","label":"VEHICLE","confidence":0.92,"trackId":1}],"total":8648,"page":1,"pageSize":2}
```

مختصات `x/y/w/h` نرمال‌شدهٔ ۰ تا ۱ و `x/y` گوشهٔ بالا-چپ است.

### GET /api/v1/detections/labels

برچسب‌های متمایز با شمارش، مرتب بر حسب فراوانی (فیلترهای اختیاری streamId و sessionId):

```json
[{"label":"PEDESTRIAN","count":4324},{"label":"VEHICLE","count":4324}]
```

## رویدادها

### GET /api/v1/events

پارامترها: `streamId`، `type` (یکی از LINE_CROSS، ROI_ENTER، ROI_EXIT، SESSION_END، ERROR، STATE_CHANGE — مقدار خارج از فهرست خطای ۴۰۰ می‌گیرد)، `from`/`to`، `page`، `pageSize`. مرتب‌سازی ثابت: جدیدترین اول. خروجی ضبط‌شده:

```json
{"items":[{"id":15,"sessionId":"f8c8f665-…","streamId":"5f987f9e-…","type":"ERROR","trackId":null,"label":null,"payload":{"reason":"engine_crash_exit_137","exitCode":137},"ts":"2026-10-05T05:54:38.957Z","createdAt":"2026-10-05T05:54:38.957Z"},{"id":13,"…":"…","type":"LINE_CROSS","trackId":1,"label":"VEHICLE","payload":{"direction":"LR"},"ts":"2026-10-05T05:46:56.413Z"}],"total":4,"page":1,"pageSize":2}
```

`payload` آبجکت JSON است (در دیتابیس به‌صورت متن ذخیره و موقع خواندن parse می‌شود). جهت عبور در نسخهٔ جاری یکی از `L2R`/`R2L`/`T2B`/`B2T` است.

## سنجه‌ها

### GET /api/v1/metrics

دو حالت دارد:

**حالت تاریخچه** (پیش‌فرض) — پارامترها: `streamId`، `sessionId`، `from`/`to` و `bucket` با مقدارهای `1s`/`5s`/`30s`/`1m` (پیش‌فرض ۳۰ ثانیه؛ مقدار نامعتبر ۴۰۰ می‌گیرد). خروجی: میانگین‌ها و بیشینه‌های هر سطل + یک `summary` کلی. مهر `ts` هر سطل، epoch میلی‌ثانیهٔ شروع سطل است:

```json
{"bucket":"30s","buckets":[{"ts":1791179070000,"samples":6,"avgSourceFps":15,"avgProcessedFps":15.77,"avgLatencyMs":13.02,"maxQueueDepth":4,"avgDropped":0,"avgCpuPercent":27.67,"avgMemoryMb":135.33},"…"],"summary":{"samples":354,"avgSourceFps":14.96,"avgProcessedFps":16.04,"avgLatencyMs":11.97,"minLatencyMs":1.49,"maxLatencyMs":28.98,"maxQueueDepth":4,"maxDropped":0,"avgCpuPercent":23.45,"avgMemoryMb":111.31,"maxFramesProcessed":6918,"maxDetections":13836}}
```

**حالت زنده** — با `?live=1`: آخرین سنجهٔ هر نشست فعال (بدون سطل):

```json
{"live":true,"sessions":[]}
```

(وقتی استریمی روشن باشد، هر عضو `sessions` شمارنده‌های نشست زیر کلید `metric` می‌آید.)

## مدل‌ها

### GET /api/v1/models

رجیستری کامل. خروجی ضبط‌شده:

```json
{"items":[{"id":"edgevision-detect-s","name":"edgevision-detect-s","task":"OBJECT_DETECTION","format":"ONNX","device":"CPU","inputShape":"1x3x416x416","classesJson":"[\"PEDESTRIAN\",\"VEHICLE\",\"CYCLIST\"]","sizeBytes":7580000,"license":"Apache-2.0","description":"مدل سبک تشخیص اشیا برای پردازنده — چیدمان YOLOv8","isActive":true,"createdAt":"2026-10-05T05:11:28.407Z","updatedAt":"2026-10-05T05:58:51.322Z"},{"id":"edgevision-detect-m","…":"…","inputShape":"1x3x640x640","sizeBytes":25900000,"isActive":false}]}
```

### POST /api/v1/models

ثبت یک پیکربندی جدید. فیلدها: `name` (۱–۸۰، یکتا)، `inputShape` (۱–۴۰، الزامی)، `classesJson` (آرایهٔ ۱ تا ۲۰ رشتهٔ ۱–۴۰ نویسه — با وجود نامش، آرایه است)، و اختیاری‌ها: `task`، `format`، `device` (هر یک تا ۴۰)، `sizeBytes` (عدد صحیح نامنفی)، `license` (تا ۱۰۰)، `description` (تا ۳۰۰). پاسخ موفق ۲۰۱ و آبجکت مدل. نام تکراری: `409 MODEL_DUPLICATE` («مدلی با این نام ثبت شده است»).

### PATCH /api/v1/models/:id

بدنه: `{"isActive": true|false}`. فقط یک مدل می‌تواند فعال باشد: فعال‌کردن یکی، بقیه را در همان تراکنش خاموش می‌کند. پاسخ: آبجکت مدل به‌روزشده. نبودن مدل: `404 MODEL_NOT_FOUND`.

## نشست‌ها

### GET /api/v1/sessions

پارامترها: `streamId`، `state` (یکی از STARTING/RUNNING/DEGRADED/STOPPING/STOPPED/ERROR)، `from`/`to` (روی زمان شروع)، `page`، `pageSize`. خروجی ضبط‌شده:

```json
{"items":[{"id":"f8c8f665-…","streamId":"5f987f9e-…","state":"ERROR","reason":"engine_crash_exit_137","startedAt":"2026-10-05T05:46:53.704Z","endedAt":"2026-10-05T05:54:38.957Z","framesProcessed":6933,"framesDropped":0,"detectionsTotal":13866,"eventsTotal":2},{"id":"b57b0ef0-…","state":"STOPPED","reason":"user_stop","framesProcessed":1716,"detectionsTotal":3432}],"total":2,"page":1,"pageSize":2}
```

## گزارش‌ها

### GET /api/v1/reports

خلاصهٔ تحلیلی بازه (پارامترها: `streamId`، `from`، `to`، `format=json|csv`). خروجی JSON ضبط‌شده:

```json
{"generatedAt":"2026-10-05T06:10:45.666Z","range":{"from":null,"to":null},"streamsSummary":[{"streamId":"5f987f9e-…","name":"استریم خیابان اصلی","sessions":2,"detections":8648,"events":4}],"sessionsCount":2,"detectionsByLabel":[{"label":"PEDESTRIAN","count":4324},{"label":"VEHICLE","count":4324}],"eventsByType":[{"type":"LINE_CROSS","count":2},{"type":"ERROR","count":1},{"type":"SESSION_END","count":1}],"metricsAverages":{"avgSourceFps":15,"avgProcessedFps":16.32,"avgLatencyMs":13.57,"avgCpuPercent":27.08,"avgMemoryMb":135.89,"maxQueueDepth":4,"samples":289},"topTracks":[{"trackId":1,"label":"VEHICLE","count":4324},{"trackId":2,"label":"PEDESTRIAN","count":4324}]}
```

با `format=csv` همان جدول تشخیص‌ها با ستون‌های `ts,streamId,sessionId,frameIndex,trackId,label,confidence,x,y,w,h` برمی‌گردد — متنی با BOM (UTF-8) و پایان‌خط CRLF و هدر `attachment; filename="edgevision-report.csv"`؛ در اکسل فارسی سالم باز می‌شود.

## تنظیمات

### GET /api/v1/settings — PATCH /api/v1/settings

```bash
curl -s http://localhost:3000/api/v1/settings
```

```json
{"defaultGridCols":40,"defaultGridRows":24,"defaultQueueCapacity":30,"defaultEmitStride":2,"metricsPersistEvery":2}
```

PATCH فیلدهای `defaultGridCols` (۱۶–۸۰)، `defaultGridRows` (۹–۴۸)، `defaultQueueCapacity` (۵–۲۰۰) و `defaultEmitStride` (۱–۱۰) را می‌پذیرد (همه اختیاری؛ `metricsPersistEvery` فعلاً ثابت ۲ است). این‌ها فقط پیش‌فرضِ استریم‌های جدیدند و در `settings.json` سرویس ذخیره می‌شوند.

## کدهای وضعیت و خطا

| کد HTTP | کد | نمونه پیام فارسی |
|---|---|---|
| 400 | VALIDATION | «داده‌های ورودی نامعتبر است» (+ details) |
| 400 | INVALID_JSON / BODY_READ_FAILED | «بدنه درخواست باید JSON معتبر باشد» |
| 401 | UNAUTHORIZED | «توکن داخلی نامعتبر است» (فقط API داخلی) |
| 404 | NOT_FOUND | «موردی یافت نشد» |
| 404 | STREAM_NOT_FOUND / MODEL_NOT_FOUND / NO_ACTIVE_SESSION | «استریم مورد نظر یافت نشد» و… |
| 409 | STREAM_ACTIVE / SESSION_ACTIVE | «استریم فعال را نمی‌توان ویرایش کرد» |
| 409 | MODEL_DUPLICATE | «مدلی با این نام ثبت شده است» |
| 413 | BODY_TOO_LARGE | «حجم درخواست بیش از حد مجاز است» |
| 429 | RATE_LIMIT | «درخواست‌های بیش از حد مجاز؛ کمی صبر کنید» |
| 500 | INTERNAL | «خطای داخلی سرور» |
| 503 | ENGINE_DOWN | «سرویس پردازش در دسترس نیست» |
| 503 | ENGINE_BINARY_MISSING | «موتور بومی ساخته نشده است. اسکریپت scripts/build-engine.sh را اجرا کنید.» |

خطاهای سرویس موتور با همین وضعیت و پیام فارسی از لایهٔ Next.js عبور داده می‌شوند؛ خطای ۴۰۰ داخلی به کد واحد VALIDATION نگاشت می‌شود.

## API داخلی سرویس موتور (پورت ۳۰۰۳)

لایهٔ Next.js برای نوشتن با این API حرف می‌زند؛ مستقیم به آن نیاز ندارید مگر برای ابزارهای نگهداری. همهٔ مسیرها با پیشوند `/internal/` و فقط با هدر `x-internal-token`:

- `GET /internal/health` — سلامت سرویس و باینری موتور (`{"ok":true,"db":true,"engineBinary":true,"activeSessions":0,"version":"1.0.0"}`)
- `GET /internal/snapshot` — نشست‌های فعال
- `POST /internal/streams`، `PATCH|DELETE /internal/streams/:id`، `POST /internal/streams/:id/start|stop`
- `POST /internal/models`، `PATCH /internal/models/:id`
- `GET|PATCH /internal/settings`

توکن پیش‌فرض `edgevision-local` است و با متغیر محیطی `EV_INTERNAL_TOKEN` (و نشانی سرویس با `EV_ENGINE_SERVICE_URL`) قابل تغییر.

## WebSocket (socket.io)

اتصال روی پورت ۳۰۰۳ با مسیر `/` (همان قرارداد گیت‌وی). پیام‌ها JSON هستند.

### سرور به کلاینت

**hello** — بلافاصله بعد از اتصال:

```json
{"version":"1.0.0","engineBinary":true,"activeSessions":[]}
```

(با نشست فعال، `activeSessions` فهرستی از `{streamId, sessionId, state, startedAt}` است.)

**session** — هر گذر وضعیت (ضبط‌شده):

```json
{"streamId":"5f987f9e-…","sessionId":"be183142-…","state":"RUNNING","reason":null,"startedAt":"2026-10-05T06:11:54.065Z"}
```

**frame** — هر گام ارسال (ضبط‌شده، کوتاه‌شده):

```json
{"streamId":"5f987f9e-…","sessionId":"be183142-…","frameIndex":4,"ts":1791180714342,"latencyMs":1.539,"objects":[{"oid":1,"t":"VEHICLE","x":0.141,"y":0.484,"w":0.126,"h":0.092},"…"],"detections":[{"trackId":1,"label":"VEHICLE","conf":0.78,"x":0.125,"y":0.333,"w":0.15,"h":0.25}]}
```

`objects` وضعیت واقعی صحنه است (چیزی که «دوربین» می‌بیند) و `detections` خروجی خط‌لوله (فقط مسیرهای تأییدشده). `ts` و `frameIndex` برای تشخیص «داده‌های کهنه» به کار می‌روند.

**metrics** — هر ثانیه (ضبط‌شده):

```json
{"streamId":"5f987f9e-…","sessionId":"be183142-…","ts":1791180719117,"sourceFps":14.682,"processedFps":14.694,"latency":{"avgMs":1.662,"minMs":1.593,"maxMs":1.748,"p50Ms":1.66,"p95Ms":1.709},"queueDepth":0,"queueCapacity":30,"droppedTotal":0,"cpuPercent":1.961,"memoryMb":1.918,"framesProcessed":75,"detectionsTotal":307,"uptimeMs":5049}
```

**event** — رویدادها (ضبط‌شده):

```json
{"streamId":"5f987f9e-…","sessionId":"be183142-…","type":"LINE_CROSS","ts":1791180718677,"trackId":11,"label":"VEHICLE","payload":{"direction":"L2R"}}
```

**pong** — پاسخ ping شما، به شکل `{"ts":<epoch میلی‌ثانیه>,"echo":<همان دادهٔ ping>}`.

### کلاینت به سرور

```js
socket.emit("subscribe",   { streams: ["5f987f9e-…"] });
socket.emit("unsubscribe", { streams: ["5f987f9e-…"] });
socket.emit("ping", "rtt-probe");
```

**معنی subscribe:** عضویت در اتاق `stream:<id>` — فقط پیام‌های همان استریم‌ها به شما می‌رسد. عضویت روی اتصال تازه منتقل نمی‌شود و باید دوباره اجرا شود؛ داشبورد خودش بعد از هر اتصال مجدد، فهرست استریم‌های موردنظر را دوباره می‌فرستد.

### رفتار اتصال مجدد

سرور هر ۲۵ ثانیه ping می‌فرستد و ۶۰ ثانیه مهلت پاسخ می‌دهد. کلاینت رسمی (داشبورد) با backoff نمایی ۱ تا ۸ ثانیه خودش وصل می‌شود و بعد از هر وصل، عضویت‌ها را بازسازی می‌کند؛ در فاصلهٔ قطعی، نشان «در حال اتصال مجدد…» دیده می‌شود و داده‌های فهرست‌ها از polling زنده می‌ماند.

---

حق نشر © ۲۰۲۶ پارسا فتحی — مجوز Apache-2.0
