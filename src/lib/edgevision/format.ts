// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// قالب‌بندی فارسی: اعداد، درصدها، مدت‌ها، تاریخ جلالی و برچسب‌های فارسی.

import type {
  EventKind,
  ObjectClass,
  SceneKind,
  SessionState,
  StreamStatus,
} from './types';

let faNumFmt: Intl.NumberFormat | null = null;
let enNumFmt: Intl.NumberFormat | null = null;

function faFormatter(): Intl.NumberFormat {
  faNumFmt ??= new Intl.NumberFormat('fa-IR');
  return faNumFmt;
}

function enFormatter(): Intl.NumberFormat {
  enNumFmt ??= new Intl.NumberFormat('en-US');
  return enNumFmt;
}

/** عدد با ارقام فارسی (برای متن‌های ثابت). */
export function faNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fa-IR', opts).format(n);
}

/** عدد فارسی/لاتین بسته به ترجیح کاربر (برای داده‌های پویا). */
export function formatNumber(n: number, fa: boolean, opts?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(n)) return '—';
  if (opts) return new Intl.NumberFormat(fa ? 'fa-IR' : 'en-US', opts).format(n);
  return (fa ? faFormatter() : enFormatter()).format(n);
}

/** درصد فارسی: ۰٫۳۵ → ٪۳۵ */
export function faPercent(x: number, fa = true, fractionDigits = 0): string {
  if (!Number.isFinite(x)) return '—';
  const v = new Intl.NumberFormat(fa ? 'fa-IR' : 'en-US', {
    maximumFractionDigits: fractionDigits,
  }).format(x * 100);
  return fa ? `٪${v}` : `${v}%`;
}

/** حجم به مگابایت. */
export function formatBytes(bytes: number, fa = true): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return fa ? '۰ مگابایت' : '0 MB';
  const mb = bytes / (1024 * 1024);
  const v = formatNumber(mb, fa, { maximumFractionDigits: 1 });
  return fa ? `${v} مگابایت` : `${v} MB`;
}

/** مدت به شکل «۳ دقیقه و ۱۲ ثانیه». */
export function faDuration(ms: number, fa = true): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec <= 0) return fa ? 'کمتر از یک ثانیه' : '<1s';
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${formatNumber(hours, fa)} ${fa ? 'ساعت' : 'h'}`);
  if (minutes > 0) parts.push(`${formatNumber(minutes, fa)} ${fa ? 'دقیقه' : 'm'}`);
  if (seconds > 0 && hours === 0) parts.push(`${formatNumber(seconds, fa)} ${fa ? 'ثانیه' : 's'}`);
  if (parts.length === 0) return fa ? 'کمتر از یک ثانیه' : '<1s';
  return parts.join(fa ? ' و ' : ' ');
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** تاریخ جلالی: «۵ آبان ۱۴۰۵» */
export function jalali(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

/** ساعت دقیقه ثانیه: «۱۴:۳۲:۰۵» */
export function jalaliTime(value: string | number | Date | null | undefined, withSeconds = true): string {
  const d = toDate(value);
  if (!d) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).format(d);
}

/** تاریخ و ساعت کوتاه: «۵ آبان، ۱۴:۳۲» */
export function jalaliDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return `${jalali(d)}، ${jalaliTime(d, false)}`;
}

/** زمان نسبی: «۳ ثانیه پیش» */
export function relativeTime(value: string | number | Date | null | undefined, now = Date.now()): string {
  const d = toDate(value);
  if (!d) return '—';
  const diffSec = Math.floor((now - d.getTime()) / 1000);
  if (diffSec < 5) return 'همین حالا';
  if (diffSec < 60) return `${faNumber(diffSec)} ثانیه پیش`;
  if (diffSec < 3600) return `${faNumber(Math.floor(diffSec / 60))} دقیقه پیش`;
  if (diffSec < 86400) return `${faNumber(Math.floor(diffSec / 3600))} ساعت پیش`;
  if (diffSec < 7 * 86400) return `${faNumber(Math.floor(diffSec / 86400))} روز پیش`;
  return jalali(d);
}

export function classLabelFa(label: string | null | undefined): string {
  switch (label) {
    case 'PEDESTRIAN':
      return 'عابر پیاده';
    case 'VEHICLE':
      return 'خودرو';
    case 'CYCLIST':
      return 'دوچرخه‌سوار';
    default:
      return label ?? 'نامشخص';
  }
}

export function sceneLabelFa(scene: string | null | undefined): string {
  switch (scene) {
    case 'STREET':
      return 'خیابان';
    case 'INTERSECTION':
      return 'چهارراه';
    case 'PARKING':
      return 'پارکینگ';
    default:
      return scene ?? '—';
  }
}

export function statusLabelFa(status: StreamStatus | string | null | undefined): string {
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
      return status ?? '—';
  }
}

export function stateLabelFa(state: SessionState | string | null | undefined): string {
  switch (state) {
    case 'STARTING':
      return 'در حال راه‌اندازی';
    case 'RUNNING':
      return 'در حال اجرا';
    case 'DEGRADED':
      return 'با افت کیفیت';
    case 'STOPPING':
      return 'در حال توقف';
    case 'STOPPED':
      return 'پایان‌یافته';
    case 'ERROR':
      return 'خطا';
    default:
      return state ?? '—';
  }
}

export function eventTypeFa(type: EventKind | string | null | undefined): string {
  switch (type) {
    case 'LINE_CROSS':
      return 'عبور از خط';
    case 'ROI_ENTER':
      return 'ورود به ناحیه';
    case 'ROI_EXIT':
      return 'خروج از ناحیه';
    case 'SESSION_END':
      return 'پایان نشست';
    case 'ERROR':
      return 'خطا';
    default:
      return type ?? '—';
  }
}

/** «مسیر ۱۲» */
export function trackLabelFa(trackId: number | null | undefined): string {
  if (trackId === null || trackId === undefined) return '—';
  return `مسیر ${faNumber(trackId)}`;
}

/** تبدیل ارقام لاتین یک رشته به فارسی. */
export function toFaDigits(s: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  return s.replace(/[0-9]/g, (d) => fa[Number(d)]);
}

/** مقدار عددی امن برای رندر سنجه‌ها (null/undefined → null). */
export function safeNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
