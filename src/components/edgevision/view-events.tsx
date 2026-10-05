// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// رویدادها — فیلتر نوع/استریم/زمان + فهرست صفحه‌بندی‌شده با جملهٔ فارسی و JSON.

'use client';

import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useFmt } from '@/hooks/edgevision/use-num';
import { usePolling } from '@/hooks/edgevision/use-polling';
import { api } from '@/lib/edgevision/api';
import { eventSentenceFa } from '@/lib/edgevision/events';
import { jalali, jalaliTime, relativeTime } from '@/lib/edgevision/format';
import type { EventKind } from '@/lib/edgevision/types';
import { EventTypeBadge } from './shared/badges';
import { PageHeader, SectionCard } from './shared/cards';
import { EmptyState, ErrorView, LoadingView } from './shared/state-views';
import { ALL_STREAMS, StreamSelect, TimeRangeSelect, Pager, rangeFrom } from './shared/selects';
import { btn } from './shared/styles';
import type { Nav } from './shared/nav';

const PAGE_SIZE = 20;

const TYPE_CHIPS: { value: 'all' | EventKind; label: string }[] = [
  { value: 'all', label: 'همه' },
  { value: 'LINE_CROSS', label: 'عبور از خط' },
  { value: 'ROI_ENTER', label: 'ورود به ناحیه' },
  { value: 'ROI_EXIT', label: 'خروج از ناحیه' },
  { value: 'SESSION_END', label: 'پایان نشست' },
  { value: 'ERROR', label: 'خطا' },
];

export function ViewEvents({ nav }: { nav: Nav }) {
  const fmt = useFmt();
  const [type, setType] = useState<'all' | EventKind>('all');
  const [streamId, setStreamId] = useState<string>(ALL_STREAMS);
  const [range, setRange] = useState<'15m' | '1h' | '6h' | '24h' | 'all'>('24h');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const streams = usePolling(() => api.streams(), { intervalMs: 10000 });

  const filterKey = JSON.stringify({ type, streamId, range, page });
  const events = usePolling(
    () =>
      api.events({
        streamId: streamId === ALL_STREAMS ? undefined : streamId,
        type: type === 'all' ? undefined : type,
        from: rangeFrom(range),
        page,
        pageSize: PAGE_SIZE,
      }),
    { intervalMs: 5000, key: filterKey },
  );

  const streamNameById = new Map((streams.data?.items ?? []).map((s) => [s.id, s.name]));
  const items = events.data?.items ?? [];
  const total = events.data?.total ?? 0;

  if (streams.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="رویدادها" description="عبور از خط، ورود و خروج از ناحیه و…" />
        <LoadingView />
      </div>
    );
  }

  if (!streams.data && streams.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="رویدادها" />
        <ErrorView message={streams.error} onRetry={streams.refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="رویدادها" description="عبور از خط، ورود و خروج از ناحیه و…" />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="فیلتر نوع رویداد">
          {TYPE_CHIPS.map((chip) => (
            <Button
              key={chip.value}
              variant={type === chip.value ? 'default' : 'outline'}
              size="sm"
              aria-pressed={type === chip.value}
              onClick={() => {
                setType(chip.value);
                setPage(1);
              }}
              className={
                type === chip.value
                  ? `min-h-11 ${btn.primary}`
                  : `min-h-11 ${btn.outline}`
              }
            >
              {chip.label}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-zinc-400">استریم</Label>
            <StreamSelect
              streams={streams.data?.items ?? []}
              value={streamId}
              onChange={(v) => {
                setStreamId(v);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-zinc-400">بازهٔ زمانی</Label>
            <TimeRangeSelect
              value={range}
              onChange={(v) => {
                setRange(v);
                setPage(1);
              }}
            />
          </div>
        </div>
      </div>

      <SectionCard title="فهرست رویدادها" description="به‌روزرسانی هر ۵ ثانیه">
        {events.loading && !events.data ? (
          <LoadingView label="در حال دریافت رویدادها…" />
        ) : events.error && !events.data ? (
          <ErrorView message={events.error} onRetry={events.refresh} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={BellRing}
            title="هنوز داده‌ای ثبت نشده است"
            description={
              (streams.data?.items ?? []).length === 0
                ? 'برای ثبت رویداد، ابتدا یک استریم بسازید و ناحیهٔ پایش یا خط عبور تعریف کنید.'
                : 'رویدادی با این فیلترها ثبت نشده؛ بازهٔ زمانی را بزرگ‌تر کنید یا استریمی را اجرا کنید.'
            }
            action={
              (streams.data?.items ?? []).length === 0 ? (
                <Button variant="outline" onClick={() => nav.navigate('streams')} className={`min-h-11 ${btn.outline}`}>
                  رفتن به استریم‌ها
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="thin-scroll max-h-[32rem] divide-y divide-zinc-800/70 overflow-y-auto">
              {items.map((ev) => {
                const isOpen = expanded === ev.id;
                return (
                  <li key={ev.id} className="py-3">
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 rounded-md p-1 text-start transition-colors hover:bg-zinc-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                      onClick={() => setExpanded(isOpen ? null : ev.id)}
                      aria-expanded={isOpen}
                    >
                      <EventTypeBadge type={ev.type} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-6 text-zinc-200">{eventSentenceFa(ev)}</p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {streamNameById.get(ev.streamId) ?? ev.streamId}
                          <span className="tnum ms-2" title={jalaliTime(ev.ts)}>
                            {relativeTime(ev.ts)}
                          </span>
                          <span className="tnum ms-2">{jalali(ev.ts)}</span>
                        </p>
                      </div>
                      {ev.payload && (
                        <span className="mt-1 shrink-0 text-[10px] text-zinc-600">
                          {isOpen ? 'بستن جزئیات' : 'جزئیات'}
                        </span>
                      )}
                    </button>
                    {isOpen && ev.payload && (
                      <pre
                        dir="ltr"
                        className="thin-scroll mt-2 max-h-40 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-400"
                      >
                        {JSON.stringify(ev.payload, null, 2)}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
            <p className="text-xs text-zinc-600">
              برای دیدن جزئیات هر رویداد روی آن بزنید. {fmt.num(total)} رویداد در کل.
            </p>
          </>
        )}
      </SectionCard>
    </div>
  );
}
