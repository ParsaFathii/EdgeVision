// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// قالب‌بندی اعداد وابسته به ترجیح «اعداد فارسی» کاربر.

'use client';

import { useMemo } from 'react';
import { useDisplayPrefs } from '@/lib/edgevision/prefs';
import { faDuration, faPercent, formatBytes, formatNumber } from '@/lib/edgevision/format';

export interface Fmt {
  /** عدد — فارسی یا لاتین. */
  num: (n: number, opts?: Intl.NumberFormatOptions) => string;
  /** درصد با علامت ٪. */
  pct: (x: number, fractionDigits?: number) => string;
  /** حجم به مگابایت. */
  bytes: (n: number) => string;
  /** مدت به شکل «۳ دقیقه و ۱۲ ثانیه». */
  dur: (ms: number) => string;
}

export function useFmt(): Fmt {
  const fa = useDisplayPrefs((s) => s.faDigits);
  return useMemo(
    () => ({
      num: (n: number, opts?: Intl.NumberFormatOptions) => formatNumber(n, fa, opts),
      pct: (x: number, fractionDigits = 0) => faPercent(x, fa, fractionDigits),
      bytes: (n: number) => formatBytes(n, fa),
      dur: (ms: number) => faDuration(ms, fa),
    }),
    [fa],
  );
}
