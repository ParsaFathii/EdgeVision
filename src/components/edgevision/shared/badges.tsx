// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// نشان‌های وضعیت — تینت ملایم + نقطهٔ رنگی (بدون بلوک‌های پررنگ).

'use client';

import { cn } from '@/lib/utils';
import { eventTypeFa, stateLabelFa, statusLabelFa } from '@/lib/edgevision/format';
import type { EventKind, SessionState, StreamStatus } from '@/lib/edgevision/types';

function Dot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('size-1.5 rounded-full', className)} />;
}

interface Tone {
  wrap: string;
  dot: string;
  pulse?: boolean;
}

function toneForStatus(status: StreamStatus | string): Tone {
  switch (status) {
    case 'RUNNING':
      return { wrap: 'bg-emerald-500/10 text-emerald-400', dot: 'bg-emerald-400' };
    case 'STARTING':
      return { wrap: 'bg-amber-500/10 text-amber-400', dot: 'bg-amber-400', pulse: true };
    case 'STOPPING':
      return { wrap: 'bg-amber-500/10 text-amber-400', dot: 'bg-amber-400', pulse: true };
    case 'ERROR':
      return { wrap: 'bg-rose-500/10 text-rose-400', dot: 'bg-rose-400' };
    default:
      return { wrap: 'bg-zinc-500/10 text-zinc-400', dot: 'bg-zinc-500' };
  }
}

function toneForState(state: SessionState | string): Tone {
  switch (state) {
    case 'RUNNING':
      return { wrap: 'bg-emerald-500/10 text-emerald-400', dot: 'bg-emerald-400' };
    case 'STARTING':
      return { wrap: 'bg-amber-500/10 text-amber-400', dot: 'bg-amber-400', pulse: true };
    case 'DEGRADED':
      return { wrap: 'bg-amber-500/10 text-amber-400', dot: 'bg-amber-400' };
    case 'STOPPING':
      return { wrap: 'bg-amber-500/10 text-amber-400', dot: 'bg-amber-400', pulse: true };
    case 'ERROR':
      return { wrap: 'bg-rose-500/10 text-rose-400', dot: 'bg-rose-400' };
    default:
      return { wrap: 'bg-zinc-500/10 text-zinc-400', dot: 'bg-zinc-500' };
  }
}

export function StreamStatusBadge({ status }: { status: StreamStatus | string | null | undefined }) {
  const tone = toneForStatus(status ?? 'IDLE');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium',
        tone.wrap,
      )}
    >
      <Dot className={cn(tone.dot, tone.pulse && 'animate-pulse')} />
      {statusLabelFa(status)}
    </span>
  );
}

export function SessionStateBadge({ state }: { state: SessionState | string | null | undefined }) {
  const tone = toneForState(state ?? 'STOPPED');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium',
        tone.wrap,
      )}
    >
      <Dot className={cn(tone.dot, tone.pulse && 'animate-pulse')} />
      {stateLabelFa(state)}
    </span>
  );
}

export function EventTypeBadge({ type }: { type: EventKind | string }) {
  let tone = 'bg-zinc-500/10 text-zinc-300';
  let dot = 'bg-zinc-500';
  switch (type) {
    case 'LINE_CROSS':
      tone = 'bg-teal-500/10 text-teal-300';
      dot = 'bg-teal-400';
      break;
    case 'ROI_ENTER':
      tone = 'bg-amber-500/10 text-amber-400';
      dot = 'bg-amber-400';
      break;
    case 'ROI_EXIT':
      tone = 'bg-zinc-500/10 text-zinc-300';
      dot = 'bg-zinc-500';
      break;
    case 'SESSION_END':
      tone = 'bg-zinc-500/10 text-zinc-300';
      dot = 'bg-zinc-500';
      break;
    case 'ERROR':
      tone = 'bg-rose-500/10 text-rose-400';
      dot = 'bg-rose-400';
      break;
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium', tone)}>
      <Dot className={dot} />
      {eventTypeFa(type)}
    </span>
  );
}

/** نشان دستهٔ شیء با رنگ اختصاصی. */
export function ClassChip({ label }: { label: string }) {
  const map: Record<string, string> = {
    VEHICLE: 'bg-zinc-700/40 text-zinc-300',
    PEDESTRIAN: 'bg-amber-500/10 text-amber-300',
    CYCLIST: 'bg-teal-500/10 text-teal-300',
  };
  const fa = { VEHICLE: 'خودرو', PEDESTRIAN: 'عابر پیاده', CYCLIST: 'دوچرخه‌سوار' } as Record<string, string>;
  return (
    <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', map[label] ?? 'bg-zinc-500/10 text-zinc-300')}>
      {fa[label] ?? label}
    </span>
  );
}
