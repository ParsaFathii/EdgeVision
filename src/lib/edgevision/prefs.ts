// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// ترجیحات نمایش کاربر (localStorage): اعداد فارسی و چیدمان فشرده.

'use client';

import { create } from 'zustand';

const STORAGE_KEY = 'edgevision:display';

interface DisplayPrefs {
  faDigits: boolean;
  compact: boolean;
  hydrated: boolean;
  setFaDigits: (v: boolean) => void;
  setCompact: (v: boolean) => void;
  hydrate: () => void;
}

function persist(faDigits: boolean, compact: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ faDigits, compact }));
  } catch {
    // حالت خصوصی مرورگر — بی‌خیال.
  }
}

export const useDisplayPrefs = create<DisplayPrefs>((set, get) => ({
  faDigits: true,
  compact: false,
  hydrated: false,
  setFaDigits: (v) => {
    set({ faDigits: v });
    persist(v, get().compact);
  },
  setCompact: (v) => {
    set({ compact: v });
    persist(get().faDigits, v);
  },
  hydrate: () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { faDigits?: unknown; compact?: unknown };
        set({
          faDigits: typeof parsed.faDigits === 'boolean' ? parsed.faDigits : true,
          compact: typeof parsed.compact === 'boolean' ? parsed.compact : false,
        });
      }
    } catch {
      // مقدار خراب — همان پیش‌فرض‌ها می‌مانند.
    }
  },
}));
