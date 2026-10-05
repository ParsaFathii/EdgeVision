// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// کلاس‌های دکمه و تکه‌های ظاهری مشترک سامانهٔ طراحی EdgeVision.

export const btn = {
  primary:
    'bg-emerald-600 text-zinc-950 hover:bg-emerald-500 focus-visible:ring-emerald-500/40',
  outline:
    'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-emerald-500/30',
  ghost: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 focus-visible:ring-emerald-500/30',
  danger:
    'border-rose-900/70 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50 hover:text-rose-200 focus-visible:ring-rose-500/30',
  subtle: 'bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700/70 focus-visible:ring-emerald-500/30',
} as const;

export const cardBase = 'border-zinc-800 bg-zinc-900/70';
