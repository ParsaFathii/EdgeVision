// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// نشست‌ها — تاریخچهٔ نشست‌های پردازش با فیلتر وضعیت/استریم و ردیف بازشو.

'use client';

import { Fragment, useState } from 'react';
import { History, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useFmt } from '@/hooks/edgevision/use-num';
import { usePolling } from '@/hooks/edgevision/use-polling';
import { api } from '@/lib/edgevision/api';
import { jalali, jalaliTime, stateLabelFa } from '@/lib/edgevision/format';
import type { SessionState } from '@/lib/edgevision/types';
import { SessionStateBadge } from './shared/badges';
import { PageHeader, SectionCard } from './shared/cards';
import { EmptyState, ErrorView, LoadingView } from './shared/state-views';
import { ALL_STREAMS, StreamSelect, Pager } from './shared/selects';
import { btn } from './shared/styles';
import type { Nav } from './shared/nav';

const PAGE_SIZE = 15;

const STATES: { value: 'all' | SessionState; label: string }[] = [
  { value: 'all', label: 'همهٔ وضعیت‌ها' },
  { value: 'RUNNING', label: 'در حال اجرا' },
  { value: 'STARTING', label: 'در حال راه‌اندازی' },
  { value: 'DEGRADED', label: 'با افت کیفیت' },
  { value: 'STOPPING', label: 'در حال توقف' },
  { value: 'STOPPED', label: 'پایان‌یافته' },
  { value: 'ERROR', label: 'خطا' },
];

export function ViewSessions({ nav }: { nav: Nav }) {
  const fmt = useFmt();
  const [state, setState] = useState<string>('all');
  const [streamId, setStreamId] = useState<string>(ALL_STREAMS);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const streams = usePolling(() => api.streams(), { intervalMs: 10000 });
  const filterKey = JSON.stringify({ state, streamId, page });
  const sessions = usePolling(
    () =>
      api.sessions({
        streamId: streamId === ALL_STREAMS ? undefined : streamId,
        state: state === 'all' ? undefined : state,
        page,
        pageSize: PAGE_SIZE,
      }),
    { intervalMs: 5000, key: filterKey },
  );

  const streamNameById = new Map((streams.data?.items ?? []).map((s) => [s.id, s.name]));
  const items = sessions.data?.items ?? [];
  const total = sessions.data?.total ?? 0;

  if (streams.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="نشست‌ها" description="تاریخچهٔ نشست‌های پردازش همهٔ استریم‌ها" />
        <LoadingView />
      </div>
    );
  }

  if (!streams.data && streams.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="نشست‌ها" />
        <ErrorView message={streams.error} onRetry={streams.refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="نشست‌ها" description="تاریخچهٔ نشست‌های پردازش همهٔ استریم‌ها" />

      <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-zinc-400">وضعیت</Label>
          <Select
            value={state}
            onValueChange={(v) => {
              setState(v);
              setPage(1);
            }}
            dir="rtl"
          >
            <SelectTrigger className="w-full bg-zinc-900 text-zinc-200" aria-label="فیلتر وضعیت">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
              {STATES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
      </div>

      <SectionCard title="فهرست نشست‌ها" description="به‌روزرسانی هر ۵ ثانیه — برای جزئیات روی ردیف بزنید">
        {sessions.loading && !sessions.data ? (
          <LoadingView label="در حال دریافت نشست‌ها…" />
        ) : sessions.error && !sessions.data ? (
          <ErrorView message={sessions.error} onRetry={sessions.refresh} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={History}
            title="هنوز داده‌ای ثبت نشده است"
            description={
              (streams.data?.items ?? []).length === 0
                ? 'نشست وقتی ثبت می‌شود که یک استریم را اجرا کنید.'
                : 'نشستی با این فیلترها پیدا نشد؛ فیلتر وضعیت را تغییر دهید.'
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
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="w-8" aria-label="جزئیات" />
                  <TableHead className="text-zinc-400">استریم</TableHead>
                  <TableHead className="text-zinc-400">وضعیت</TableHead>
                  <TableHead className="text-zinc-400">شروع</TableHead>
                  <TableHead className="text-zinc-400">پایان</TableHead>
                  <TableHead className="text-zinc-400">مدت</TableHead>
                  <TableHead className="text-zinc-400">فریم‌های پردازش‌شده</TableHead>
                  <TableHead className="text-zinc-400">حذف‌شده</TableHead>
                  <TableHead className="text-zinc-400">تشخیص‌ها</TableHead>
                  <TableHead className="text-zinc-400">رویدادها</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s) => {
                  const isOpen = expanded === s.id;
                  return (
                    <Fragment key={s.id}>
                      <TableRow className="border-zinc-800/70">
                        <TableCell className="ps-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpanded(isOpen ? null : s.id)}
                            aria-label={isOpen ? 'بستن جزئیات' : 'نمایش جزئیات'}
                            aria-expanded={isOpen}
                            className={`size-11 p-0 ${btn.ghost}`}
                          >
                            {isOpen ? (
                              <ChevronUp className="size-4" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="size-4" aria-hidden="true" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="max-w-32 truncate text-zinc-200">
                          {streamNameById.get(s.streamId) ?? s.streamId}
                        </TableCell>
                        <TableCell><SessionStateBadge state={s.state} /></TableCell>
                        <TableCell className="tnum text-zinc-300" title={jalali(s.startedAt)}>
                          {jalaliTime(s.startedAt, false)}
                        </TableCell>
                        <TableCell className="tnum text-zinc-300">
                          {s.endedAt ? jalaliTime(s.endedAt, false) : '—'}
                        </TableCell>
                        <TableCell className="tnum text-zinc-300">
                          {fmt.dur((s.endedAt ? Date.parse(s.endedAt) : Date.now()) - Date.parse(s.startedAt))}
                        </TableCell>
                        <TableCell className="tnum text-zinc-300">{fmt.num(s.framesProcessed)}</TableCell>
                        <TableCell className="tnum text-zinc-300">{fmt.num(s.framesDropped)}</TableCell>
                        <TableCell className="tnum text-zinc-300">{fmt.num(s.detectionsTotal)}</TableCell>
                        <TableCell className="tnum text-zinc-300">{fmt.num(s.eventsTotal)}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-zinc-950/40 hover:bg-zinc-950/40">
                          <TableCell colSpan={10} className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-400">
                              <span>
                                شناسهٔ نشست:{' '}
                                <code dir="ltr" className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                                  {s.id}
                                </code>
                              </span>
                              <span>وضعیت: {stateLabelFa(s.state)}</span>
                              {s.reason && <span>دلیل: {s.reason}</span>}
                              {s.framesProcessed + s.framesDropped > 0 && (
                                <span className="tnum">
                                  بازده:{' '}
                                  {fmt.pct(s.framesProcessed / (s.framesProcessed + s.framesDropped))} از فریم‌های دریافتی
                                </span>
                              )}
                              <span className="tnum">شروع کامل: {jalali(s.startedAt)}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
