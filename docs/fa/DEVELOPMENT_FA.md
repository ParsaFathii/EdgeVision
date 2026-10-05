# راهنمای توسعه

این سند برای کسی است که می‌خواهد کد اج‌ویژن را بخواند، تغییرش بدهد یا قابلیتی به آن اضافه کند. فرض می‌کنم [ARCHITECTURE_FA.md](ARCHITECTURE_FA.md) را خوانده‌اید.

## تور مخزن و نقشهٔ مالکیت

| مسیر | چه چیزی آنجاست | قرارداد مهم |
|---|---|---|
| `engine-cpp/src/` | موتور بومی C++20 (۲۱ فایل hpp/cpp) | پروتکل NDJSON منجمد |
| `engine-cpp/tools/` | هارنس تست موتور (`engine_smoke.py`) | اجرای مستقیم باینری |
| `engine-cpp/CMakeLists.txt` | بیلد اختیاری CMake | همان فلگ‌های g++ |
| `mini-services/engine-service/` | سرویس هماهنگی (Bun + TS) | API داخلی + مالکیت نوشتن |
| `src/app/api/v1/` | route های Next.js | شکل پاسخ/خطای عمومی |
| `src/lib/edgevision-server/` | ابزارهای سمت سرور (zod، خطاها، rate limit، bodyguard) | پیام‌های فارسی |
| `src/app/page.tsx` | پوستهٔ اپ و سوییچ نماها | ViewId ها |
| `src/components/edgevision/` | نماها (`view-*.tsx`)، `stream-editor`، `live-scene` و اجزای مشترک | — |
| `src/lib/edgevision/` | کلاینت API، سوکت، قالب‌بندی فارسی | — |
| `src/hooks/edgevision/` | hook های polling و اعداد فارسی | — |
| `prisma/schema.prisma` | اسکیمای مرجع | ستون‌های snake_case منجمد |
| `scripts/build-engine.sh` | بیلد موتور | سیاست صفر هشدار |
| `mobile/` | کلاینت Flutter | همان API عمومی |
| `services/api-python/` | سرویس مرجع FastAPI | همان دیتابیس |
| `docs/` و `docs/fa/` | مستندات EN و FA | هم‌راستا با حقایق پروژه |
| `docs/assets/` | نمودارها و اسکرین‌شات‌ها | — |

## اجرای هر مؤلفه

```bash
# موتور بومی (release)
bash scripts/build-engine.sh

# موتور با sanitizer (باینری جدا: edgevision-engine-asan)
bash scripts/build-engine.sh --sanitizers

# سرویس موتور (پورت ۳۰۰۳؛ لاگ در service.log)
cd mini-services/engine-service && bun install && bun run dev

# اپ و داشبورد (پورت ۳۰۰۰؛ لاگ در dev.log)
bun run dev

# lint
bun run lint

# دیتابیس
bun run db:push        # اعمال اسکیما
bun run db:generate    # ساخت کلاینت Prisma

# اجرای مستقیم موتور برای آزمایش پروتکل
./engine-cpp/build/edgevision-engine --session-id t1 --stream-id t1 \
  --seed 7 --scene STREET --width 640 --height 360 --target-fps 10 \
  --objects 5 --queue-capacity 20 --confidence 0.3 --grid 40x24 \
  --metrics-interval 1000 --emit-stride 2
```

## قواعد سبک کد

**TypeScript (اپ و سرویس):**

- `strict` روشن؛ `any` ممنوع — داده‌های مرزی با `unknown` و narrowing نوع‌ای پذیرفته می‌شوند (الگوی موجود در `socket.ts` و `sessions.ts`)
- پیام‌های خطای قابل‌نمایش فارسی و با نیم‌فاصلهٔ درست («داده‌های ورودی نامعتبر است»)؛ کدهای خطا انگلیسی و پایدار
- متن‌های رابط کاربری فارسی، شناسه‌ها و لاگ‌ها انگلیسی؛ اعداد نمایشی با ارقام فارسی (`faNumber`)
- `bun run lint` باید بدون هیچ خطا و هشداری پاس شود — ارتقای lint به‌عنوان بخشی از تعهد، نه گام اختیاری

**C++ (موتور):**

- کامپایل با `-std=c++20 -Wall -Wextra -Wconversion -Wshadow -Werror -pthread` — صفر هشدار، بدون استثنا؛ هیچ وابستگی خارجی اضافه نمی‌شود
- قطعیت (determinism) خط قرمز است: هیچ ورودی wall-clock به شبیه‌ساز/آشکارساز نمی‌رسد
- هیچ استثنایی از `main` بیرون نمی‌زند (نقشهٔ خروج: 2 برای خطای پیکربندی، 3 برای بقیه)

**متن فارسی (همه‌جا):** نیم‌فاصله‌ها با U+200C و صحیح (می‌شود، داده‌ها، راه‌اندازی)؛ «هٔ» برای اضافهٔ فارسی روی واژه‌های مختوم به ه (ناحیهٔ پایش)؛ اعداد متن با ارقام فارسی؛ نام فنی، مسیر و کد انگلیسی می‌ماند. قبل از commit یک اسکن ساده بزنید تا نویسه‌های شکسته/غیرمنتظره وارد نشده باشد.

## قراردادهای پروتکل منجمد

سه قرارداد، تغییر هرکدام یک تغییر شکستن سازگاری است و باید آگاهانه و همراه مستندات انجام شود:

1. **NDJSON موتور** (`engine-cpp` ↔ سرویس): انواع خطوط `ready`، `session_started`، `state`، `frame`، `event`، `metrics`، `settings_applied`، `pong`، `session_stopped`، `error` — تعریف مرجع در `mini-services/engine-service/protocol.ts` و پیاده‌سازی در `engine-cpp/src/session.cpp`
2. **API داخلی سرویس** (`/internal/*` با `x-internal-token`): شکل بدنه/پاسخ همان است که `src/lib/edgevision-server/internal.ts` مصرف می‌کند
3. **WebSocket** (socket.io): رویدادهای `hello`، `frame`، `metrics`، `event`، `session`، `pong` و فرمان‌های `subscribe`/`unsubscribe`/`ping`

**قاعده:** هر تغییر در این قراردادها = به‌روزرسانی همان‌جا `protocol.ts`/`schemas.ts` **و** مستندات ([API_FA.md](API_FA.md)، [../API.md](../API.md)) در همان تغییر. مستنداتی که با کد نمی‌خوانند، باگ مستندند.

## افزودن قابلیت

**نوع صحنهٔ جدید** (مثلاً HIGHWAY):

1. `engine-cpp/src/config.hpp` — افزودن به `SceneKind` + اعتبارسنجی `parse_config`
2. `engine-cpp/src/scene.cpp` — تابع spawn و رفتار حرکت (فایل صحنه همه‌چیز را در خود دارد)
3. `engine-cpp/src/session.cpp` — نام صحنه در `scene_name()` فقط برای لاگ stderr
4. `src/lib/edgevision-server/schemas.ts` — `sceneSchema`
5. `mini-services/engine-service/validate.ts` — همان enum در سمت سرویس
6. داشبورد: `types.ts` (`SceneKind`)، `format.ts` (`sceneLabelFa`)، `stream-editor.tsx` (`SCENES`)

**نوع رویداد جدید:**

1. `engine-cpp/src/events.hpp/.cpp` — منطق هندسی و پرکردن `EventOut`
2. `engine-cpp/src/session.cpp` — فقط اگر خط جدید می‌خواهد (امروز همه از `emit_event` یکسان عبور می‌کنند)
3. `mini-services/engine-service/protocol.ts` — نوع در `EngineEvent`
4. `src/lib/edgevision-server/schemas.ts` — `EVENT_TYPES`
5. داشبورد: `types.ts` (`EventKind`)، `format.ts` (`eventTypeFa`)، `events.ts` (جملهٔ فارسی)، `view-events.tsx` (تراشهٔ فیلتر)

**نمای جدید داشبورد:**

1. `src/components/edgevision/view-<name>.tsx` — با حالت‌های loading/empty/error+retry (الگوی نماهای موجود)
2. `src/components/edgevision/shared/nav.ts` — افزودن به `ViewId` و فهرست ناوبری
3. `src/app/page.tsx` — `case` جدید در سوییچ نما
4. اگر دادهٔ تازه می‌خواهد: endpoint در `src/app/api/v1/` + تابع در `src/lib/edgevision/api.ts` + نوع‌ها در `types.ts`

## اسکریپت‌های بیلد

- `scripts/build-engine.sh` — همهٔ `engine-cpp/src/*.cpp` را با g++ و فلگ سخت‌گیرانه کامپایل می‌کند و مسیر باینری را چاپ می‌کند. `CXX` قابل بازنویسی است. با `--sanitizers` بیلد ASan+UBSan جدا می‌سازد تا بیلد release دست‌نخورده بماند.
- `engine-cpp/CMakeLists.txt` — همان تنظیمات برای کسانی که CMake را ترجیح می‌دهند (`ENABLE_SANITIZERS` هم دارد).
- `package.json` — `dev` (پورت ۳۰۰۰ با tee به dev.log)، `build`/`start` (خروجی standalone)، `lint`، و چهار دستور `db:*`.
- `mini-services/engine-service/package.json` — `dev` با `bun --hot` برای تکرار سریع.

## گردش‌کار راستی‌آزمایی

قبل از merge هر تغییر معنادار:

1. **بیلد تمیز:** `bash scripts/build-engine.sh` بدون هیچ خروجی غیر از مسیر باینری
2. **هارنس موتور، سه‌بار پشت‌سرهم:** `python3 engine-cpp/tools/engine_smoke.py` — تکرار سه‌بار برای رد کردن شانس
3. **بیلد sanitizer:** `bash scripts/build-engine.sh --sanitizers` و اجرای همان هارنس روی باینری asan (با override مسیر `ENGINE_BIN`)
4. **lint:** `bun run lint` با خروجی صفر
5. **چک‌لیست دستی مرورگر:** «راه‌اندازی سریع» → صحنهٔ زنده و کارت‌های سنجه در جزئیات استریم → توقف/شروع با تأیید → بازکردن JSON خام رویداد → فیلتر کاوشگر و دانلود CSV → نمودارهای تحلیل‌ها → کلید فعال‌سازی مدل → ذخیرهٔ تنظیمات → منوی موبایل (۳۹۰ پیکسل)
6. **رفتار خرابی:** یک‌بار سرویس موتور را قطع کنید و مطمئن شوید خطاها فارسی و بازیابی‌پذیرند

## اشکال‌زدایی روزمره

```bash
# لاگ زندهٔ اپ (Next.js + API)
tail -f dev.log

# لاگ زندهٔ سرویس موتور (spawn، گذر وضعیت، finalize)
tail -f mini-services/engine-service/service.log

# تماشای پروتکل NDJSON موتور مستقیماً (بدون سرویس)
./engine-cpp/build/edgevision-engine --session-id d1 --stream-id d1 \
  --seed 7 --scene STREET --width 640 --height 360 --target-fps 10 \
  --objects 5 --queue-capacity 20 --confidence 0.3 --grid 40x24 \
  --metrics-interval 1000 --emit-stride 2 | head -5
```

نکته‌های کوچک که وقت نجات می‌دهند:

- خروجی موتور خط‌بافر نیست و نباید هم باشد؛ سرویس به‌صورت جریانی می‌خواند. برای تماشا با `head` مشکلی نیست.
- فرمان‌های stdin ناشناخته با یک خط stderr نادیده گرفته می‌شوند، نه کرش — هارنس می‌تواند پرحرف باشد.
- اگر داشبورد «در حال اتصال مجدد…» نشان می‌دهد ولی API جواب می‌دهد، مشکل از سوکت :۳۰۰۳ است نه اپ؛ `curl -H "x-internal-token: edgevision-local" http://localhost:3003/internal/health` را بزنید.
- برای اجرای هارنس روی بیلد sanitizer، مسیر باینری را override کنید: `ENGINE_BIN=./engine-cpp/build/edgevision-engine-asan python3 engine-cpp/tools/engine_smoke.py`

## بازنشانی محیط توسعه

```bash
# دادهٔ آزمایشی را پاک کن، اسکیما را دوباره بساز (رجیستری مدل‌ها با بوت سرویس برمی‌گردد)
rm -f db/custom.db db/custom.db-wal db/custom.db-shm
bun run db:push
```

پیش از این کار سرویس موتور را خاموش کنید تا فایل باز نماند.

## غیرهدف‌های شناخته‌شده

این‌ها باگ نیستند؛ تصمیم‌های نسخهٔ ۱٫۰٫۰‌اند:

- احراز هویت و چندکاربری — استقرار تک‌کاربره است؛ شرح در SECURITY.md
- بک‌اند ضبط واقعی ویدئو (OpenCV/FFmpeg) — انتزاع منبع هست، بسته‌بندی نیست
- اجرای همزمان روی چند ماشین / مقیاس‌پذیری افقی
- پشتیبانی ویندوز و مک — فقط لینوکس (دبیان) تست شده
- مدل ONNX واقعی — آشکارساز جانشین، با نقاط اتصال آماده (ببینید [MODELS_FA.md](MODELS_FA.md))

## چک‌لیست انتشار

نسخهٔ پروژه باید در همهٔ این جاها با هم یکی باشد:

1. `package.json` — فیلد `version`
2. `engine-cpp/src/config.hpp` — ثابت `kEngineVersion`
3. سرویس موتور — رشتهٔ نسخه در پیام `hello` (`mini-services/engine-service/index.ts`) و `/internal/health` (`http.ts`)
4. `src/app/api/v1/health/route.ts` — فیلد `version`

هر چهار مورد را با هم bump کنید، هارنس و lint را دوباره اجرا کنید و مستندات را اگر شماره‌ای در متن دارند به‌روز کنید.

---

حق نشر © ۲۰۲۶ پارسا فتحی — مجوز Apache-2.0
