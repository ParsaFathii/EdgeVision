# افزودن سکوهای اجرا (اندروید و دسکتاپ)

این پوشه فقط منبع مشترک Flutter را نگه می‌دارد (پوشه‌های `android/`،
`ios/` و … عمداً commit نشده‌اند تا پروژه سبک بماند). برای ساختن
برنامهٔ قابل نصب، سکوهای مورد نظر را با `flutter create .` بازسازی کنید:

```bash
cd mobile

# اندروید (پیش‌نهاد شناسهٔ برنامه: ir.edgevision.mobile)
flutter create . --platforms android --org ir.edgevision

# دسکتاپ لینوکس و ویندوز
flutter create . --platforms linux,windows --org ir.edgevision

# همهٔ سکوها
flutter create . --platforms android,linux,windows --org ir.edgevision
```

سپس:

```bash
flutter pub get
flutter run -d <device-id>
flutter build apk --release        # اندروید
flutter build linux --release      # لینوکس
```

## شناسهٔ برنامه

- پیش‌نهاد application id / package name: **`ir.edgevision.mobile`**
  (ساخت با `--org ir.edgevision` و نام پروژهٔ `edgevision_mobile` همین
  را می‌سازد).
- برای تغییر دستی: `android/app/build.gradle` → `applicationId`.

## نکته‌های سکو

- **اندروید**: اتصال به `10.0.2.2` یعنی «میزبان شبیه‌ساز». روی گوشی
  واقعی نشانی LAN سرور را از پردهٔ تنظیمات وارد کنید. برنامه فقط به
  HTTP/WS محلی وصل می‌شود؛ در اندروید ۹+ ترافیک cleartext باید مجاز
  شود (`android:usesCleartextTraffic="true"` در `AndroidManifest.xml` —
  برای شبکهٔ آزمایشگاهی محلی).
- **دسکتاپ (لینوکس)**: به `libgtk-3` و ابزارهای ساخت نیاز دارد؛ نشانی
  پیش‌فرض `localhost` است.
- **iOS/macOS**: کد مشترک سازگار است اما سکوها در این استقرار
  ساخته/آزموده نشده‌اند (و مجوز cleartext باید دستی افزوده شود).

## وابستگی‌های خارجی

فقط دو بستهٔ عمومی: `http` (REST) و `web_socket_channel` (WebSocket خام).
هیچ بستهٔ تقویم، نمودار یا socket.io استفاده نشده — جلالی، نمودار خطی و
پروتکل socket.io v4 همگی در خود پروژه پیاده‌سازی شده‌اند.
