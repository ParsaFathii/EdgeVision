# نصب و راه‌اندازی

این سند اج‌ویژن را از مخزن خام تا داشبورد زنده روی یک ماشین لینوکسی بالا می‌آورد. همهٔ مسیرها نسبت به ریشهٔ مخزن نوشته شده‌اند.

## پیش‌نیازها

| ابزار | حداقل | تست‌شده | کاربرد |
|---|---|---|---|
| g++ | ۱۲ | ۱۴٫۲ | کامپایل موتور C++20 |
| Bun | ۱٫۳ | ۱٫۳٫۱۴ | اجرای اپ و سرویس موتور، مدیریت بسته‌ها |
| python3 | ۳٫۱۲ | ۳٫۱۲٫۱۴ | هارنس تست موتور (`engine_smoke.py`) |
| git | — | هر نسخهٔ مدرن | دریافت مخزن |

- **SQLite جداگانه لازم نیست**؛ سرویس موتور با `bun:sqlite` و اپ با Prisma خودشان فایل دیتابیس را باز می‌کنند.
- Node لازم نیست؛ اگر باشد (نسخه ۲۴ تست شده) صرفاً برای ابزارهای جانبی حول مخزن به کار می‌آید.
- تست‌شده روی لینوکس (دبیان). ویندوز و مک تست نشده‌اند.
- حداقل منبع پیشنهادی: یک هستهٔ آزاد برای هر نشست فعال و حدود ۲ گیگابایت RAM.

### متغیرهای محیطی

پیش‌فرض‌ها برای اجرای محلی درست‌اند؛ فقط اگر چیدمان متفاوتی می‌خواهید دست بزنید:

| متغیر | پیش‌فرض | اثر |
|---|---|---|
| `DATABASE_URL` | `file:db/custom.db` (از `.env`؛ قالب: `.env.example`) | مسیر SQLite برای Prisma و اپ — نسبت به ریشهٔ مخزن resolve می‌شود |
| `EV_INTERNAL_TOKEN` | `edgevision-local` | توکن هدر `x-internal-token` بین اپ و سرویس |
| `EV_ENGINE_SERVICE_URL` | `http://127.0.0.1:3003` | نشانی API داخلی سرویس از دید اپ |
| `ENGINE_BIN` | مسیر بیلد release | override مسیر باینری موتور (کاربرد اصلی: تست) |

## نصب گام‌به‌گام

### ۱) دریافت مخزن

```bash
git clone https://github.com/ParsaFathii/EdgeVision.git
cd EdgeVision
```

### ۲) نصب وابستگی‌های اپ

```bash
bun install
```

این دستور وابستگی‌های داشبورد و API را (Next.js، React، Tailwind، Recharts، socket.io-client، Prisma و…) نصب می‌کند.

### ۳) اعمال اسکیمای دیتابیس

```bash
bun run db:push
```

پشت این دستور `prisma db push` اجرا می‌شود و جداول `streams`، `sessions`، `detections`، `events`، `metrics` و `models` در `db/custom.db` ساخته می‌شوند. مسیر دیتابیس از `DATABASE_URL` در فایل `.env` می‌آید — پیش از این گام، قالب را کپی کنید:

```bash
cp .env.example .env
```

محتوای پیش‌فرض (نسبی به ریشهٔ مخزن):

```
DATABASE_URL=file:db/custom.db
```

سرویس موتور این فایل را نمی‌خواند و مسیر دیتابیس را نسبت به محل خودش پیدا می‌کند — که به همین فایل می‌رسد؛ پس همیشه هر دو سرویس روی یک دیتابیس کار می‌کنند.

اگر پوشهٔ `db/` وجود نداشت، سرویس موتور خودش موقع بوت می‌سازد؛ اما برای آماده‌شدن دیتابیس پیش از اولین اجرای API همین‌جا لازم است اجرایش کنید.

### ۴) کامپایل موتور بومی

```bash
bash scripts/build-engine.sh
```

خروجی مورد انتظار (ضبط‌شده):

```
engine-cpp/build/edgevision-engine
```

اسکریپت فقط مسیر باینری را چاپ می‌کند؛ هیچ هشدار و خطایی نباید ببینید — پروژه با `-Wall -Wextra -Wconversion -Wshadow -Werror` کامپایل می‌شود و روی دوازده ثانیهٔ یک ماشین معمولی تمام می‌شود. برای بیلد اشکال‌زدایی:

```bash
bash scripts/build-engine.sh --sanitizers   # => engine-cpp/build/edgevision-engine-asan
```

گزینهٔ CMake هم هست (`cmake -B engine-cpp/build -S engine-cpp`) اما در همین محیط مستقیماً با g++ کامپایل می‌شود.

برای اطمینان، نسخهٔ موتور را بپرسید:

```bash
./engine-cpp/build/edgevision-engine --version
# {"type":"version","version":"1.0.0"}
```

### ۵) اجرای سرویس موتور

در یک ترمینال جداگانه:

```bash
cd mini-services/engine-service
bun install      # فقط بار اول
bun run dev
```

لاگ‌های مورد انتظار هنگام بوت (ضبط‌شده از `service.log`):

```
$ bun --hot index.ts
[engine-service] database open (WAL): …/EdgeVision/db/custom.db
[engine-service] listening on port 3003 (internal API + socket.io at path "/")
[engine-service] engine binary present
```

اگر موتور را هنوز نساخته باشید، به‌جای سطر آخر این را می‌بینید:

```
[engine-service] engine binary MISSING (engine-cpp/build/edgevision-engine) — start/stop returns 503 until it is built
```

یعنی سرویس بالا می‌آید ولی شروع استریم تا زمان build با خطای ۵۰۳ جواب می‌دهد.

### ۶) اجرای اپ

در ترمینال دیگری از ریشهٔ مخزن:

```bash
bun run dev
```

اپ روی پورت ۳۰۰۰ بالا می‌آید و خروجی‌اش به `dev.log` هم tee می‌شود. مرورگر را باز کنید:

```
http://localhost:3000
```

اگر همه‌چیز درست باشد، در نمای کلی وضعیت «سالم» را می‌بینید و دکمهٔ «راه‌اندازی سریع» یک استریم واقعی می‌سازد و اجرا می‌کند. جزئیات کار با داشبورد در [USER_GUIDE_FA.md](USER_GUIDE_FA.md) است.

### ۷) بررسی نهایی نصب

با دو پرسش مطمئن شوید هر دو سرویس سالم‌اند:

```bash
curl -s http://localhost:3000/api/v1/health
# {"status":"ok","db":true,"engine":true,"engineBinary":true,"activeSessions":0,"version":"1.0.0","uptimeSec":…}

curl -s -H "x-internal-token: edgevision-local" http://localhost:3003/internal/health
# {"ok":true,"db":true,"engineBinary":true,"activeSessions":0,"version":"1.0.0"}
```

اگر هر دو `true` برگرداندند، نصب کامل است.

## به‌روزرسانی

```bash
git pull                       # کد تازه
bun install                    # وابستگی‌های احتمالی جدید
bun run db:push                # اسکیمای تغییرکرده را اعمال می‌کند (در تغییرات مخرب دادهٔ مربوط را می‌اندازد)
bash scripts/build-engine.sh   # موتور تازه
```

سپس هر دو سرویس را ری‌استارت کنید. سرویس موتور موقع بوت، نشست‌های یتیمِ ری‌استارت را با وضعیت ERROR صادقانه می‌بندد و رجیستری مدل‌ها را idempotent دوباره seed می‌کند؛ دادهٔ دیگر دست نمی‌خورد.

## اجزای اختیاری

این دو جزء اجرای اصلی را لازم ندارند و جدای از آن عمل می‌کنند:

**سرویس مرجع FastAPI** — پیاده‌سازی مرجع همان API روی همان دیتابیس (API اصلی در استقرار پیش‌فرض، لایهٔ Next.js است):

```bash
cd services/api-python
pip install -r requirements.txt
python -m uvicorn app:app --port 8000
```

**کلاینت Flutter** — سورس کامل در `mobile/`؛ به SDK فلاتر نیاز دارد:

```bash
cd mobile
flutter pub get
flutter run
```

توجه: تحلیل و تست این کلاینت (`flutter analyze`/`flutter test`) در محیط ساخت در دسترس نبوده و باید خودتان اجرایش کنید؛ CI روی رانرهای گیت‌هاب اجرایش می‌کند.

## رفع اشکال

| نشانه | دلیل | راه‌حل |
|---|---|---|
| `EADDRINUSE` موقع `bun run dev` | پورت ۳۰۰۰ اشغال است | فرایند قبلی را ببندید (`lsof -i :3000`) یا آن را kill کنید |
| سرویس موتور بالا نمی‌آید | پورت ۳۰۰۳ اشغال است | `lsof -i :3003` و بستن فرایند قبلی |
| پیام فارسی «جدول‌های لازم در دیتابیس یافت نشد…» | سرویس موتور قبل از اجرای `bun run db:push` راه‌اندازی شده | در ریشهٔ مخزن `bun run db:push` را اجرا و سرویس را ری‌استارت کنید |
| خطای ۵۰۳ با پیام «سرویس پردازش در دسترس نیست» | سرویس موتور (پورت ۳۰۰۳) خاموش است | گام ۵ را اجرا کنید؛ داشبورد خودش با اتصال مجدد برمی‌گردد |
| خطای ۵۰۳ با پیام «موتور بومی ساخته نشده است…» | باینری `engine-cpp/build/edgevision-engine` وجود ندارد | `bash scripts/build-engine.sh` را اجرا کنید |
| فایل‌های `custom.db-wal` و `custom.db-shm` کنار دیتابیس | حالت WAL عادی SQLite است، نه خرابی | کاری نکنید؛ این فایل‌ها بخشی از دیتابیس زنده‌اند و در git نادیده گرفته می‌شوند |
| خطای `SQLITE_BUSY` | نباید رخ دهد | سرویس موتور تنها نویسندهٔ دیتابیس است، WAL فعال است و `busy_timeout` روی ۵۰۰۰ میلی‌ثانیه نشسته؛ اگر باز هم دیدید یعنی دو نسخهٔ همزمان از سرویس موتور دارید — `lsof -i :3003` را بررسی کنید |
| رفتار عجیب بعد از تغییر کد سرویس | hot-reload (`bun --hot`) نشست‌های قبلی را یتیم کرده | سرویس موقع بوت نشست‌های یتیم را صادقانه با وضعیت ERROR می‌بندد؛ کافی است یک‌بار ری‌استرت کنید |
| خواستن دیدن لاگ اپ | — | `dev.log` در ریشهٔ مخزن و `mini-services/engine-service/service.log` برای سرویس موتور |

## حذف

اج‌ویژن هیچ چیزی خارج از پوشهٔ خودش نصب نمی‌کند (بسته‌های Bun هم داخل `node_modules` مخزن می‌مانند). حذف کامل یعنی پاک‌کردن پوشهٔ مخزن؛ همین.

---

حق نشر © ۲۰۲۶ پارسا فتحی — مجوز Apache-2.0
