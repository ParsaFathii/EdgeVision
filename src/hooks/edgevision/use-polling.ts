// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// فچر دوره‌ای عمومی — بارگذاری، خطا، نوسازی دستی + پاک‌سازی مطمئن.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { errMessageFa } from '@/lib/edgevision/api';

export interface PollingResult<T> {
  data: T | null;
  error: string | null;
  /** بارگذاری اولیه (تا وقتی داده‌ای نیست). */
  loading: boolean;
  refresh: () => void;
}

interface PollingOptions {
  /** بازهٔ نوسازی (ms) — null یعنی فقط یک‌بار. */
  intervalMs?: number | null;
  /** کلید تغییر فیلترها — تغییرش یعنی فچر باید از نو اجرا شود. */
  key?: string;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  { intervalMs = null, key = '' }: PollingOptions = {},
): PollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const runRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let epoch = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    setLoading(true);

    const run = async () => {
      const my = ++epoch;
      try {
        const result = await fetcherRef.current();
        if (cancelled || my !== epoch) return;
        setData(result);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled || my !== epoch) return;
        setError(errMessageFa(err));
        setLoading(false);
      }
    };

    runRef.current = () => {
      if (!cancelled) void run();
    };

    void run();
    if (intervalMs && intervalMs > 0) {
      timer = setInterval(() => void run(), intervalMs);
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, key]);

  const refresh = useCallback(() => {
    runRef.current();
  }, []);

  return { data, error, loading, refresh };
}
