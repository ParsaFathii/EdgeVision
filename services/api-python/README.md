# EdgeVision — سرویس مرجع API (FastAPI)

پیاده‌سازی **مرجع** سطح REST نسخهٔ ۱ (`/api/v1`) با FastAPI روی **همان
پایگاه‌دادهٔ SQLite** (`db/custom.db`) که بقیهٔ سامانه از آن استفاده می‌کند.

Copyright © ۲۰۲۶ پارسا فاتی — مجوز Apache-2.0.

> **جای این سرویس در معماری:** لایهٔ API اصلیِ سرویده‌شده در این استقرار
> همان **route handlerهای Next.js روی پورت ۳۰۰۰** است. این سرویس یک مرجع
> مستقل است که نشان می‌دهد همان قرارداد REST را می‌توان با پشتهٔ دیگری
> (Python/FastAPI) هم دقیق پیاده کرد — برای مقایسه، آموزش و آزمون.
> بلادرنگ (socket.io روی پورت ۳۰۰۳) در این سرویس بازتولید نمی‌شود؛
> کلاینت‌ها برای دادهٔ زنده مستقیماً به engine-service وصل می‌شوند.

## ساختار

```
services/api-python/
├── requirements.txt   # fastapi + uvicorn[standard] + pydantic
├── app.py             # کل سرویس در یک ماژول (~۱۳۲۰ خط)
└── README.md
```

## اجرا

```bash
cd services/api-python
pip install -r requirements.txt      # در sandbox از قبل نصب است
python3 -m uvicorn app:app --host 127.0.0.1 --port 8000
```

پیش‌فرض‌ها (قابل تغییر با متغیر محیطی):

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `EV_DB_PATH` | `<repo>/db/custom.db` | مسیر SQLite (فقط‌خواندنی، حالت `mode=ro`) |
| `EV_ENGINE_SERVICE_URL` | `http://127.0.0.1:3003` | نشانی API داخلی engine-service برای نوشتن‌ها |
| `EV_INTERNAL_TOKEN` | `edgevision-local` | توکن هدر `x-internal-token` |
| `EV_FORWARD_TIMEOUT_S` | `5` | مهلت ارجاع نوشتن‌ها (ثانیه) |

مستندات OpenAPI خودکار: **http://127.0.0.1:8000/docs**

## قرارداد

- **خواندن‌ها** (streams، detections، events، metrics، sessions، reports،
  models) مستقیماً از SQLite با `sqlite3` استاندارد می‌خوانند — بدون ORM،
  با پارامترهای مقیدشده و شرط‌های زمانی روی رشته‌های ISO (همان قرارداد
  نوشته‌شده توسط engine-service).
- **نوشتن‌ها** (ساخت/ویرایش/حذف/شروع/توقف استریم، ثبت/فعال‌سازی مدل،
  تنظیمات) ابتدا با **pydantic** اعتبارسنجی می‌شوند (دامنه‌ها و پیام‌های
  فارسی، همان schemas.ts) و سپس به API داخلی engine-service ارجاع داده
  می‌شوند — سرویس پردازش تنها نویسندهٔ پایگاه‌داده است.
- پوشش خطای مشترک `{error: {code, message, details?}}` با پیام فارسی؛
  خطاهای اعتبارسنجی pydantic هم به همین شکل (کد ۴۰۰ `VALIDATION`)
  درمی‌آیند.
- پارامترهای زمانی `from`/`to` هم ISO-8601 و هم epoch-ms/epoch-s را
  می‌پذیرند؛ صفحه‌بندی `page`/`pageSize` (پیش‌فرض ۲۵، سقف ۲۰۰)؛
  بازه‌بندی متریک با `strftime` (1s/5s/30s/1m)؛ CSV گزارش با
  **BOM UTF-8** و CRLF.

## نمونه‌های واقعی (ضبط‌شده در همین sandbox — اجرای زنده)

سلامت سامانه:

```bash
$ curl -s http://127.0.0.1:8000/api/v1/health
{"status":"ok","db":true,"engine":true,"engineBinary":true,"activeSessions":0,"version":"1.0.0","uptimeSec":0}
```

فهرست استریم‌ها (شکل ردیف همان لایهٔ Next است):

```bash
$ curl -s http://127.0.0.1:8000/api/v1/streams
{"items":[{"id":"5f987f9e-55e8-4f96-9058-a7ed4a80c17e","name":"استریم خیابان اصلی",
"scene":"STREET","sourceType":"SYNTHETIC","width":640,"height":360,"targetFps":15.0,
"objectCount":8,"confidenceThreshold":0.35,"classFilterJson":"[\"PEDESTRIAN\",\"VEHICLE\",\"CYCLIST\"]",
"roiJson":"{\"x\":0.25,\"y\":0.15,\"w\":0.5,\"h\":0.6}","lineJson":"{\"x1\":0.5,\"y1\":0.1,\"x2\":0.5,\"y2\":0.9}",
"queueCapacity":30,"gridCols":40,"gridRows":24,"emitStride":2,"status":"IDLE",
"createdAt":"2026-10-05T05:44:45.951Z","updatedAt":"2026-10-05T06:15:53.642Z","activeSession":null}]}
```

تشخیص‌ها با صفحه‌بندی (۲۰۰):

```bash
$ curl -s "http://127.0.0.1:8000/api/v1/detections?page=1&pageSize=5"
{"items":[{"id":16584,"sessionId":"06f3a202-…","streamId":"5f987f9e-…","frameIndex":1128,
"ts":"2026-10-05T06:15:53.599Z","label":"VEHICLE","confidence":0.8,"trackId":100,
"x":0.6,"y":0.458,"w":0.3,"h":0.167}, … (۵ ردیف)],"total":11740,"page":1,"pageSize":5}
```

خطای ۴۰۴ با پوشش فارسی:

```bash
$ curl -s http://127.0.0.1:8000/api/v1/streams/00000000-0000-0000-0000-000000000000
{"error":{"code":"NOT_FOUND","message":"موردی یافت نشد"}}          # HTTP 404
```

خطای اعتبارسنجی (۴۰۰) با جزئیات فارسی:

```bash
$ curl -s -X POST http://127.0.0.1:8000/api/v1/streams \
    -H 'content-type: application/json' -d '{"name":"x","scene":"FOREST","width":100}'
{"error":{"code":"VALIDATION","message":"داده‌های ورودی نامعتبر است",
"details":["صحنه باید یکی از STREET، INTERSECTION یا PARKING باشد",
"عرض تصویر باید بین 320 و 1920 باشد","فیلد height الزامی است", …]}}   # HTTP 400
```

چرخهٔ کامل نوشتن از طریق engine-service واقعی (همه با کد وضعیت درست):

```bash
$ curl -s -X POST …/api/v1/streams -d '{…معتبر…}'            # 201 + ردیف جدید
$ curl -s -X PATCH …/api/v1/streams/<id> -d '{"objectCount":7}'   # 200 + نام/مقدار جدید
$ curl -s -X POST …/api/v1/streams/<id>/start
{"session":{"streamId":"53938ff3-…","sessionId":"8815e2b7-…","state":"RUNNING",
"startedAt":"2026-10-05T07:00:21.508Z","framesProcessed":0,"detectionsTotal":0}}    # 200

$ (۵ ثانیه اجرا)

$ curl -s "…/api/v1/metrics?live=1"
{"live":true,"sessions":[{"streamId":"53938ff3-…","state":"RUNNING","framesProcessed":60,
"detectionsTotal":285,"metric":{"id":685,"ts":"2026-10-05T07:00:25.559Z",
"sourceFps":14.632,"processedFps":14.766, …}}]}                    # 200

$ curl -s -X POST …/api/v1/streams/<id>/stop
{"session":{"state":"STOPPED","reason":"user_stop","startedAt":"2026-10-05T07:00:21.508Z",
"endedAt":"2026-10-05T07:00:26.590Z","framesProcessed":76,"framesDropped":0,
"detectionsTotal":381,"eventsTotal":1}}                             # 200

$ curl -s "…/api/v1/sessions?streamId=<id>"
{"items":[{"id":"8815e2b7-…","state":"STOPPED","reason":"user_stop","framesProcessed":76,
"detectionsTotal":381,"eventsTotal":1, …}],"total":1,"page":1,"pageSize":25}   # 200

$ curl -s -X DELETE …/api/v1/streams/<id>                          # 200 {"ok":true}
$ curl -s …/api/v1/streams/<id>                                    # 404 (حذف آبشاری)
```

گزارش CSV با BOM (سه بایت `EF BB BF`) و CRLF:

```bash
$ curl -s "…/api/v1/reports?format=csv" | head -c 60 | cat -v
M-oM-;M-?ts,streamId,sessionId,frameIndex,trackId,label,confidence,x,y,w,h^M …
# HTTP 200 — content-type: text/csv; charset=utf-8 — ۱۱۷۴۱ خط داده
```

تک‌فعالی مدل‌ها هم از همین مسیر برقرار است (فعال‌کردن `edgevision-detect-m`
در همان لحظه `edgevision-detect-s` را غیرفعال کرد؛ وضعیت seed بعد از آزمون
بازگردانده شد).

## تفاوت‌های آگاهانه با لایهٔ Next.js (صادقانه)

- **بدون CORS** — سرویس مرجعِ محلی است؛ مرورگر نباید مستقیم به آن وصل شود.
- **بدون محدودیت نرخ** — لایهٔ Next ۶۰ نوشتن بر دقیقه بر IP دارد؛ این سرویس
  مرجع آن را پیاده نمی‌کند (مستندسازی، نه پنهان‌کاری).
- **بدون سقف بدنهٔ ۱MB** لایهٔ Next — درخواست‌های ارجاعی فقط توسط سقف
  خود engine-service (۲۵۶KB) محدود می‌شوند.
- **بدون WebSocket/socket.io** — بلادرنگ عمداً فقط از طریق engine-service
  (پورت ۳۰۰۳) برقرار می‌ماند.
- خطاهای اعتبارسنجی با کد ۴۰۰ (نه ۴۲۲ پیش‌فرض FastAPI) برمی‌گردند تا با
  قرارداد لایهٔ اصلی یکسان باشند؛ ترتیب جزئیات ممکن است با Next کمی
  متفاوت باشد (هر دو فارسی و با همان پیام‌ها).

## وابستگی‌ها

فقط `fastapi` + `uvicorn[standard]` + `pydantic` (فایل
`requirements.txt`). ارجاع‌های HTTP با `urllib` استاندارد انجام می‌شود —
بدون وابستگی HTTP کلاینت اضافه.
