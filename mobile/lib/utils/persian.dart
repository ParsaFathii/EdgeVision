// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

/// ابزارهای فارسی: ارقام فارسی، تاریخ جلالی، بازه‌های زمانی و برچسب‌های رابط.
///
/// تبدیل تاریخ جلالی بدون بستهٔ بیرونی، با الگوریتم استاندارد کاظیمیرش
/// بورکوفسکی (نسخهٔ اصلاح‌شدهٔ روش بیرشک) که مرجع پیاده‌سازی‌های رایج
/// (jalaali-js و moment-jalaali) است. دقت الگوریتم برای بازهٔ ۱۱۷۸ تا ۱۶۳۳
/// خورشیدی (۱۷۹۹ تا ۲۲۵۴ میلادی) تضمین شده است.
library;

const String _header =
    'EdgeVision — کلاینت موبایل\nCopyright © 2026 Parsa Fathi — Apache-2.0';

/// سربرگ پروژه — در صفحهٔ «درباره» نمایش داده می‌شود.
String get projectHeader => _header;

// — — — ارقام فارسی — — —

/// نگاشت نویسهٔ رقم لاتین به رقم فارسی.
const Map<String, String> faDigitMap = {
  '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴',
  '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹',
};

/// جای‌گزینی همهٔ ارقام لاتینِ رشته با ارقام فارسی.
String faDigits(String input) {
  var out = input;
  for (final entry in faDigitMap.entries) {
    out = out.replaceAll(entry.key, entry.value);
  }
  return out;
}

/// جداکنندهٔ هزارگان فارسی (U+066C).
const String _thousandSep = '٬';

/// جداکنندهٔ اعشار فارسی (U+066B).
const String _decimalSep = '٫';

/// قالب‌بندی عدد با ارقام فارسی، جداکنندهٔ هزارگان «٬» و اعشار «٫».
///
/// [decimals] تعداد رقم اعشار ثابت است (پیش‌فرض بدون اعشار).
String faNumber(num value, {int decimals = 0}) {
  final fixed = value.abs().toStringAsFixed(decimals);
  final parts = fixed.split('.');
  final intPart = parts[0];
  final grouped = StringBuffer();
  for (var i = 0; i < intPart.length; i++) {
    // جداکنندهٔ هر سه رقم از سمت راست: پیش از رقم i وقتی باقی‌ماندهٔ
    // ارقام بعد از آن مضربی از ۳ باشد.
    if (i > 0 && (intPart.length - i) % 3 == 0) {
      grouped.write(_thousandSep);
    }
    grouped.write(intPart[i]);
  }
  final sign = value.isNegative && (decimals > 0 || intPart != '0') ? '−' : '';
  final body =
      parts.length > 1 && parts[1].isNotEmpty
          ? '$grouped$_decimalSep${parts[1]}'
          : grouped.toString();
  return faDigits('$sign$body');
}

/// درصد فارسی: «٪۹۲» — مقدار ورودی خودش درصد است (۹۲ یعنی ۹۲٪).
String faPercent(num value, {int decimals = 0}) =>
    '٪${faNumber(value, decimals: decimals)}';

// — — — تاریخ جلالی — — —

/// تاریخ جلالی (سال، ماه، روز).
class JalaliDate {
  const JalaliDate(this.year, this.month, this.day);

  final int year;
  final int month;
  final int day;
}

const List<String> jalaliMonths = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const List<String> jalaliWeekdays = [
  'شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه',
];

int _div(int a, int b) => a ~/ b;

int _mod(int a, int b) => a - (a ~/ b) * b;

/// نقاط شکست تقویم هجری خورشیدی در الگوریتم بورکوفسکی.
const List<int> _breaks = <int>[
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060,
  2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

class _JalCalResult {
  const _JalCalResult({required this.leap, required this.gy, required this.march});
  final int leap;
  final int gy;
  final int march;
}

/// محاسبهٔ روز کبیسه و روز جلالیِ اول فروردین (مارس میلادی) برای سال خورشیدی.
_JalCalResult _jalCal(int jy) {
  final gy = jy + 621;
  var leapJ = -14;
  var jp = _breaks[0];
  var jump = 0;
  for (var i = 1; i < _breaks.length; i++) {
    final jm = _breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + _div(jump, 33) * 8 + _div(_mod(jump, 33), 4);
    jp = jm;
  }
  var n = jy - jp;
  leapJ = leapJ + _div(n, 33) * 8 + _div(_mod(n, 33) + 3, 4);
  if (_mod(jump, 33) == 4 && jump - n == 4) leapJ += 1;

  final leapG = _div(gy, 4) - _div((_div(gy, 100) + 1) * 3, 4) - 150;
  final march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + _div(jump + 4, 33) * 33;
  var leap = _mod(_mod(n + 1, 33) - 1, 4);
  if (leap == -1) leap = 4;
  return _JalCalResult(leap: leap, gy: gy, march: march);
}

/// شمارهٔ روز جلالی از تاریخ میلادی (روز جولیان پروله‌پتیک).
int _g2d(int gy, int gm, int gd) {
  var d = _div((gy + _div(gm - 8, 6) + 100100) * 1461, 4) +
      _div(153 * _mod(gm + 9, 12) + 2, 5) +
      gd -
      34840408;
  d = d - _div(_div(gy + 100100 + _div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

class _Greg {
  const _Greg({required this.year, required this.month, required this.day});
  final int year;
  final int month;
  final int day;
}

/// تبدیل روز جولیان به میلادی.
_Greg _d2g(int jdn) {
  var j = 4 * jdn + 139361631;
  j = j + _div(_div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  final i = _div(_mod(j, 1461), 4) * 5 + 308;
  final day = _div(_mod(i, 153), 5) + 1;
  final month = _mod(_div(i, 153), 12) + 1;
  final year = _div(j, 1461) - 100100 + _div(8 - month, 6);
  return _Greg(year: year, month: month, day: day);
}

/// تبدیل تاریخ میلادی به جلالی (الگوریتم بورکوفسکی).
JalaliDate toJalali(DateTime gregorian) {
  final utc = DateTime.utc(
    gregorian.year,
    gregorian.month,
    gregorian.day,
  );
  final jdn = _g2d(utc.year, utc.month, utc.day);
  final gy = _d2g(jdn).year;
  var jy = gy - 621;
  final r = _jalCal(jy);
  final jdn1f = _g2d(gy, 3, r.march);
  var k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      // شش ماه نخست سال: ۳۱ روزه.
      return JalaliDate(jy, 1 + _div(k, 31), _mod(k, 31) + 1);
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap == 1) k += 1;
  }
  return JalaliDate(jy, 7 + _div(k, 30), _mod(k, 30) + 1);
}

/// تاریخ کوتاه: «۱۴۰۵/۰۷/۱۲».
String faDateShort(DateTime gregorian) {
  final j = toJalali(gregorian);
  final mm = j.month.toString().padLeft(2, '0');
  final dd = j.day.toString().padLeft(2, '0');
  return faDigits('${j.year}/$mm/$dd');
}

/// تاریخ بلند: «۱۲ مهر ۱۴۰۵».
String faDate(DateTime gregorian) {
  final j = toJalali(gregorian);
  final month = jalaliMonths[j.month - 1];
  // سال بدون جداکنندهٔ هزارگان نمایش داده می‌شود («۱۴۰۵» نه «۱٬۴۰۵»).
  return '${faNumber(j.day)} $month ${faDigits(j.year.toString())}';
}

/// ساعت دو رقمی با ارقام فارسی: «۱۴:۰۳».
String faTime(DateTime time) {
  final hh = time.hour.toString().padLeft(2, '0');
  final mm = time.minute.toString().padLeft(2, '0');
  return faDigits('$hh:$mm');
}

/// تاریخ و ساعت: «۱۲ مهر ۱۴۰۵، ۱۴:۰۳».
String faDateTime(DateTime gregorian) =>
    '${faDate(gregorian)}، ${faTime(gregorian)}';

// — — — بازه‌های زمانی — — —

/// بازهٔ زمانی خوانا: «۳ دقیقه و ۱۲ ثانیه».
///
/// دو واحد معنادار نخست نمایش داده می‌شوند؛ «کمتر از یک ثانیه» برای
/// بازه‌های زیر یک ثانیه.
String faDuration(Duration duration) {
  var d = duration;
  if (d.isNegative) d = Duration.zero;
  if (d.inMilliseconds < 1000) return 'کمتر از یک ثانیه';

  final days = d.inDays;
  final hours = d.inHours % 24;
  final minutes = d.inMinutes % 60;
  final seconds = d.inSeconds % 60;

  final units = <(int, String)>[
    (days, 'روز'),
    (hours, 'ساعت'),
    (minutes, 'دقیقه'),
    (seconds, 'ثانیه'),
  ];
  final parts = <String>[];
  for (final (value, label) in units) {
    if (value > 0) parts.add('${faNumber(value)} $label');
    if (parts.length == 2) break;
  }
  if (parts.isEmpty) return 'کمتر از یک ثانیه';
  return parts.join(' و ');
}

/// زمان نسبی: «۵ دقیقه پیش»، «۳ روز پیش»، «هم‌اکنون».
String faAgo(DateTime time, {DateTime? now}) {
  final diff = (now ?? DateTime.now()).difference(time);
  if (diff.isNegative) return 'هم‌اکنون';
  if (diff.inSeconds < 10) return 'هم‌اکنون';
  if (diff.inDays > 0) return '${faNumber(diff.inDays)} روز پیش';
  if (diff.inHours > 0) return '${faNumber(diff.inHours)} ساعت پیش';
  if (diff.inMinutes > 0) return '${faNumber(diff.inMinutes)} دقیقه پیش';
  return '${faNumber(diff.inSeconds)} ثانیه پیش';
}

// — — — برچسب‌های دامنه — — —

/// نام فارسی دسته‌های اشیا.
String classLabelFa(String? label) {
  switch (label) {
    case 'PEDESTRIAN':
      return 'عابر پیاده';
    case 'VEHICLE':
      return 'خودرو';
    case 'CYCLIST':
      return 'دوچرخه‌سوار';
    case null:
      return '—';
    default:
      return label;
  }
}

/// نام فارسی نوع صحنه.
String sceneLabelFa(String scene) {
  switch (scene) {
    case 'STREET':
      return 'خیابان دوگذره';
    case 'INTERSECTION':
      return 'چهارراه';
    case 'PARKING':
      return 'پارکینگ';
    default:
      return scene;
  }
}

/// وضعیت استریم به فارسی.
String streamStatusFa(String status) {
  switch (status) {
    case 'IDLE':
      return 'غیرفعال';
    case 'STARTING':
      return 'در حال راه‌اندازی';
    case 'RUNNING':
      return 'در حال اجرا';
    case 'STOPPING':
      return 'در حال توقف';
    case 'ERROR':
      return 'خطا';
    default:
      return status;
  }
}

/// وضعیت نشست به فارسی.
String sessionStateFa(String state) {
  switch (state) {
    case 'STARTING':
      return 'در حال شروع';
    case 'RUNNING':
      return 'در حال اجرا';
    case 'DEGRADED':
      return 'افت کارایی';
    case 'STOPPING':
      return 'در حال توقف';
    case 'STOPPED':
      return 'پایان‌یافته';
    case 'ERROR':
      return 'خطا';
    default:
      return state;
  }
}

/// نوع رویداد به فارسی.
String eventTypeFa(String type) {
  switch (type) {
    case 'LINE_CROSS':
      return 'عبور از خط';
    case 'ROI_ENTER':
      return 'ورود به ناحیهٔ پایش';
    case 'ROI_EXIT':
      return 'خروج از ناحیهٔ پایش';
    case 'SESSION_END':
      return 'پایان نشست';
    case 'ERROR':
      return 'خطا';
    case 'STATE_CHANGE':
      return 'تغییر وضعیت';
    default:
      return type;
  }
}

/// جهت عبور از خط به فارسی.
///
/// مقادیر قرارداد جاری موتور L2R/R2L/T2B/B2T است؛ مقدارهای LR/RL/TB/BT
/// شکل قدیمی‌اند و برای مدارای با ردیف‌های تاریخی نگه داشته شده‌اند.
String directionLabelFa(String? direction) {
  switch (direction) {
    case 'LR':
    case 'L2R':
      return 'چپ به راست';
    case 'RL':
    case 'R2L':
      return 'راست به چپ';
    case 'TB':
    case 'T2B':
      return 'بالا به پایین';
    case 'BT':
    case 'B2T':
      return 'پایین به بالا';
    case null:
      return '—';
    default:
      return direction;
  }
}
