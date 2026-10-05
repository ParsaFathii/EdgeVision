// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// تحلیل‌ها — نمودارهای واقعی از API: تشخیص به تفکیک برچسب، تأخیر، نرخ فریم،
// رویدادها بر اساس نوع و جدول نشست‌های اخیر.

'use client';

import { useMemo, useState } from 'react';
import { BarChart3, Radio } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { jalaliTime, stateLabelFa } from '@/lib/edgevision/format';
import type { MetricBucket } from '@/lib/edgevision/types';
import { SessionStateBadge } from './shared/badges';
import { PageHeader, SectionCard } from './shared/cards';
import { EmptyState, ErrorView, LoadingView } from './shared/state-views';
import {
  ALL_STREAMS,
  StreamSelect,
  TimeRangeSelect,
  bucketForRange,
  rangeFrom,
} from './shared/selects';
import { btn } from './shared/styles';
import type { Nav } from './shared/nav';

const CLASS_COLORS: Record<string, string> = {
  PEDESTRIAN: '#f59e0b',
  VEHICLE: '#a1a1aa',
  CYCLIST: '#2dd4bf',
};

const CLASS_FA: Record<string, string> = {
  PEDESTRIAN: 'عابر پیاده',
  VEHICLE: 'خودرو',
  CYCLIST: 'دوچرخه‌سوار',
};

const EVENT_TYPES = ['LINE_CROSS', 'ROI_ENTER', 'ROI_EXIT', 'SESSION_END', 'ERROR'] as const;
const EVENT_FA: Record<string, string> = {
  LINE_CROSS: 'عبور از خط',
  ROI_ENTER: 'ورود به ناحیه',
  ROI_EXIT: 'خروج از ناحیه',
  SESSION_END: 'پایان نشست',
  ERROR: 'خطا',
};

const tooltipStyle = {
  background: '#18181b',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  fontSize: 12,
  direction: 'rtl',
} as const;

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function ViewAnalytics({ nav }: { nav: Nav }) {
  const fmt = useFmt();
  const [range, setRange] = useState<'15m' | '1h' | '6h' | '24h'>('1h');
  const [streamId, setStreamId] = useState<string>(ALL_STREAMS);

  const streams = usePolling(() => api.streams(), { intervalMs: 15000 });
  const sid = streamId === ALL_STREAMS ? undefined : streamId;
  const from = rangeFrom(range);

  const metrics = usePolling(
    () => api.metrics({ streamId: sid, from, bucket: bucketForRange(range) }),
    { intervalMs: 15000, key: `${range}|${streamId}` },
  );

  const detections = usePolling(
    // سقف API برای pageSize برابر ۲۰۰ است؛ نمودار با همین حجم کار می‌کند.
    () => api.detections({ streamId: sid, from, page: 1, pageSize: 200, sort: 'ts', order: 'asc' }),
    { intervalMs: 30000, key: `${range}|${streamId}` },
  );

  const eventsByType = usePolling(
    () =>
      Promise.all(
        EVENT_TYPES.map((t) => api.events({ streamId: sid, type: t, from, page: 1, pageSize: 1 })),
      ).then((results) =>
        EVENT_TYPES.map((t, i) => ({ type: t, count: results[i].total })),
      ),
    { intervalMs: 20000, key: `${range}|${streamId}` },
  );

  const sessions = usePolling(
    () => api.sessions({ streamId: sid, page: 1, pageSize: 8 }),
    { intervalMs: 20000, key: streamId },
  );

  const streamNameById = new Map((streams.data?.items ?? []).map((s) => [s.id, s.name]));

  // — — نمودار ۱: تشخیص‌ها به تفکیک برچسب (سطل‌بندی سمت کاربر) — —
  const detectionSeries = useMemo(() => {
    const items = detections.data?.items ?? [];
    if (items.length === 0) return [];
    const startT = from ? Date.parse(from) : Math.min(...items.map((d) => Date.parse(d.ts)));
    const endT = Date.now();
    const span = Math.max(1, endT - startT);
    const buckets = 24;
    const width = span / buckets;
    const rows: { t: number; PEDESTRIAN: number; VEHICLE: number; CYCLIST: number }[] = Array.from(
      { length: buckets },
      (_, i) => ({ t: startT + (i + 0.5) * width, PEDESTRIAN: 0, VEHICLE: 0, CYCLIST: 0 }),
    );
    for (const d of items) {
      const t = Date.parse(d.ts);
      const idx = Math.min(buckets - 1, Math.max(0, Math.floor((t - startT) / width)));
      const label = d.label in CLASS_COLORS ? d.label : 'VEHICLE';
      rows[idx][label as 'PEDESTRIAN' | 'VEHICLE' | 'CYCLIST'] += 1;
    }
    return rows;
  }, [detections.data, from]);

  // — — نمودار ۲: تأخیر استنتاج — —
  const latencySeries = useMemo(() => {
    const buckets = metrics.data?.buckets ?? [];
    const hasPercentiles = buckets.some((b) => numOrNull(b.p50Ms) !== null || numOrNull(b.p95Ms) !== null);
    return {
      hasPercentiles,
      rows: buckets.map((b: MetricBucket) => ({
        ts: b.ts,
        avg: numOrNull(b.avgLatencyMs) ?? 0,
        p50: numOrNull(b.p50Ms) ?? undefined,
        p95: numOrNull(b.p95Ms) ?? undefined,
      })),
    };
  }, [metrics.data]);

  // — — نمودار ۳: نرخ فریم — —
  const fpsSeries = useMemo(
    () =>
      (metrics.data?.buckets ?? []).map((b) => ({
        ts: b.ts,
        source: numOrNull(b.avgSourceFps) ?? 0,
        processed: numOrNull(b.avgProcessedFps) ?? 0,
      })),
    [metrics.data],
  );

  const eventChartData = useMemo(
    () => (eventsByType.data ?? []).map((e) => ({ type: EVENT_FA[e.type] ?? e.type, count: e.count })),
    [eventsByType.data],
  );

  const anyData =
    detectionSeries.length > 0 ||
    fpsSeries.length > 0 ||
    (eventsByType.data ?? []).some((e) => e.count > 0) ||
    (sessions.data?.items ?? []).length > 0;

  if (streams.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="تحلیل‌ها" description="نگاه آماری به رفتار پلتفرم در بازهٔ انتخابی" />
        <LoadingView />
      </div>
    );
  }

  if (!streams.data && streams.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="تحلیل‌ها" />
        <ErrorView message={streams.error} onRetry={streams.refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="تحلیل‌ها" description="نگاه آماری به رفتار پلتفرم در بازهٔ انتخابی" />

      <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-zinc-400">بازهٔ زمانی</Label>
          {/* «همه» در این نما ارائه نمی‌شود؛ حالت ناممکن به بزرگ‌ترین بازه برمی‌گردد */}
          <TimeRangeSelect value={range} onChange={(v) => setRange(v === 'all' ? '24h' : v)} withAll={false} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-zinc-400">استریم</Label>
          <StreamSelect streams={streams.data?.items ?? []} value={streamId} onChange={setStreamId} />
        </div>
      </div>

      {!anyData ? (
        <EmptyState
          icon={BarChart3}
          title="هنوز داده‌ای برای نمایش نیست؛ یک استریم را اجرا کنید"
          description="نمودارها فقط دادهٔ واقعی ثبت‌شده در API را نشان می‌دهند."
          action={
            (streams.data?.items ?? []).length === 0 ? (
              <Button variant="outline" onClick={() => nav.navigate('streams')} className={`min-h-11 ${btn.outline}`}>
                <Radio className="size-4" aria-hidden="true" />
                رفتن به استریم‌ها
              </Button>
            ) : (
              <Button variant="outline" onClick={() => nav.navigate('streams')} className={`min-h-11 ${btn.outline}`}>
                اجرای یک استریم
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="تشخیص‌ها به تفکیک برچسب"
              description="سطل‌بندی زمانی روی دادهٔ واقعی"
            >
              {detectionSeries.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
                  در این بازه تشخیصی ثبت نشده است
                </div>
              ) : (
                <div dir="ltr" className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={detectionSeries} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <defs>
                        {Object.entries(CLASS_COLORS).map(([k, c]) => (
                          <linearGradient key={k} id={`grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={c} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={c} stopOpacity={0.05} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="t"
                        tick={{ fill: '#71717a', fontSize: 11 }}
                        tickFormatter={(v: number) => jalaliTime(v, false)}
                        tickLine={false}
                        axisLine={{ stroke: '#3f3f46' }}
                        minTickGap={40}
                        type="number"
                        domain={['dataMin', 'dataMax']}
                      />
                      <YAxis
                        tick={{ fill: '#71717a', fontSize: 11 }}
                        tickFormatter={(v: number) => fmt.num(v)}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(v) => jalaliTime(Number(v))}
                        formatter={(value: number | string, name) => [
                          `${fmt.num(Number(value))} تشخیص`,
                          CLASS_FA[String(name)] ?? String(name),
                        ]}
                      />
                      <Legend
                        formatter={(value) => (
                          <span style={{ color: '#a1a1aa', fontSize: 12 }}>{CLASS_FA[String(value)] ?? value}</span>
                        )}
                      />
                      {Object.entries(CLASS_COLORS).map(([k, c]) => (
                        <Area
                          key={k}
                          type="monotone"
                          dataKey={k}
                          stackId="1"
                          stroke={c}
                          strokeWidth={1.5}
                          fill={`url(#grad-${k})`}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="تأخیر استنتاج"
              description={latencySeries.hasPercentiles ? 'میانگین، P50 و P95' : 'میانگین (چندک‌ها در این بازه گزارش نشده‌اند)'}
            >
              {latencySeries.rows.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
                  در این بازه سنجه‌ای ثبت نشده است
                </div>
              ) : (
                <div dir="ltr" className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={latencySeries.rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="ts"
                        tick={{ fill: '#71717a', fontSize: 11 }}
                        tickFormatter={(v: string) => jalaliTime(v, false)}
                        tickLine={false}
                        axisLine={{ stroke: '#3f3f46' }}
                        minTickGap={40}
                      />
                      <YAxis
                        tick={{ fill: '#71717a', fontSize: 11 }}
                        tickFormatter={(v: number) => fmt.num(v)}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(v) => jalaliTime(String(v))}
                        formatter={(value: number | string, name) => [
                          `${fmt.num(Number(value))} میلی‌ثانیه`,
                          name === 'avg' ? 'میانگین' : name === 'p50' ? 'P50' : 'P95',
                        ]}
                      />
                      <Legend
                        formatter={(value) => (
                          <span style={{ color: '#a1a1aa', fontSize: 12 }}>
                            {value === 'avg' ? 'میانگین' : value === 'p50' ? 'P50' : 'P95'}
                          </span>
                        )}
                      />
                      <Line type="monotone" dataKey="avg" stroke="#a1a1aa" strokeWidth={1.75} dot={false} />
                      {latencySeries.hasPercentiles && (
                        <>
                          <Line type="monotone" dataKey="p50" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />
                          <Line type="monotone" dataKey="p95" stroke="#10b981" strokeWidth={1.5} dot={false} connectNulls />
                        </>
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>

            <SectionCard title="نرخ فریم منبع در برابر پردازش" description="میانگین در هر سطل زمانی">
              {fpsSeries.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
                  در این بازه سنجه‌ای ثبت نشده است
                </div>
              ) : (
                <div dir="ltr" className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={fpsSeries} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="ts"
                        tick={{ fill: '#71717a', fontSize: 11 }}
                        tickFormatter={(v: string) => jalaliTime(v, false)}
                        tickLine={false}
                        axisLine={{ stroke: '#3f3f46' }}
                        minTickGap={40}
                      />
                      <YAxis
                        tick={{ fill: '#71717a', fontSize: 11 }}
                        tickFormatter={(v: number) => fmt.num(v)}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(v) => jalaliTime(String(v))}
                        formatter={(value: number | string, name) => [
                          `${fmt.num(Number(value))} فریم بر ثانیه`,
                          name === 'source' ? 'منبع' : 'پردازش',
                        ]}
                      />
                      <Legend
                        formatter={(value) => (
                          <span style={{ color: '#a1a1aa', fontSize: 12 }}>
                            {value === 'source' ? 'نرخ فریم منبع' : 'نرخ فریم پردازش'}
                          </span>
                        )}
                      />
                      <Line type="monotone" dataKey="source" stroke="#a1a1aa" strokeWidth={1.75} dot={false} />
                      <Line type="monotone" dataKey="processed" stroke="#10b981" strokeWidth={1.75} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>

            <SectionCard title="رویدادها بر اساس نوع" description="شمارش کل در بازهٔ انتخابی">
              {eventsByType.error ? (
                <p className="py-6 text-center text-sm text-rose-400">{eventsByType.error}</p>
              ) : (eventsByType.data ?? []).every((e) => e.count === 0) ? (
                <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
                  در این بازه رویدادی ثبت نشده است
                </div>
              ) : (
                <div dir="ltr" className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={eventChartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="type"
                        tick={{ fill: '#a1a1aa', fontSize: 10.5 }}
                        tickLine={false}
                        axisLine={{ stroke: '#3f3f46' }}
                      />
                      <YAxis
                        tick={{ fill: '#71717a', fontSize: 11 }}
                        tickFormatter={(v: number) => fmt.num(v)}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        cursor={{ fill: 'rgba(63,63,70,0.15)' }}
                        formatter={(value: number | string) => [`${fmt.num(Number(value))} رویداد`, 'شمارش']}
                      />
                      <Bar dataKey="count" fill="#2dd4bf" radius={[4, 4, 0, 0]} maxBarSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard title="نشست‌های اخیر" description="مدت اجرا و بازدهٔ پردازش">
            {sessions.error && !sessions.data ? (
              <p className="py-6 text-center text-sm text-rose-400">{sessions.error}</p>
            ) : (sessions.data?.items ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">هنوز نشستی اجرا نشده است</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-400">استریم</TableHead>
                    <TableHead className="text-zinc-400">وضعیت</TableHead>
                    <TableHead className="text-zinc-400">مدت</TableHead>
                    <TableHead className="text-zinc-400">پردازش‌شده</TableHead>
                    <TableHead className="text-zinc-400">حذف‌شده</TableHead>
                    <TableHead className="text-zinc-400">بازده</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sessions.data?.items ?? []).map((s) => {
                    const total2 = s.framesProcessed + s.framesDropped;
                    const ratio = total2 > 0 ? s.framesProcessed / total2 : null;
                    return (
                      <TableRow key={s.id} className="border-zinc-800/70">
                        <TableCell className="max-w-32 truncate text-zinc-300">
                          {streamNameById.get(s.streamId) ?? s.streamId}
                        </TableCell>
                        <TableCell>
                          <span title={stateLabelFa(s.state)} className="text-xs text-zinc-400">
                            <SessionStateBadge state={s.state} />
                          </span>
                        </TableCell>
                        <TableCell className="tnum text-zinc-300">
                          {fmt.dur(
                            (s.endedAt ? Date.parse(s.endedAt) : Date.now()) - Date.parse(s.startedAt),
                          )}
                        </TableCell>
                        <TableCell className="tnum text-zinc-300">{fmt.num(s.framesProcessed)}</TableCell>
                        <TableCell className="tnum text-zinc-300">{fmt.num(s.framesDropped)}</TableCell>
                        <TableCell>
                          {ratio !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
                                <div
                                  className="h-full rounded-full bg-emerald-500"
                                  style={{ width: `${Math.round(ratio * 100)}%` }}
                                />
                              </div>
                              <span className="tnum text-xs text-zinc-300">{fmt.pct(ratio)}</span>
                            </div>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
