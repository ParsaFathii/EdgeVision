// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// نمای کلی — شاخص‌ها، سنجه‌های زندهٔ نشست‌ها، رویدادهای اخیر و نمودار نرخ فریم.

'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  BellRing,
  Crosshair,
  Gauge,
  Loader2,
  Radio,
  Zap,
} from 'lucide-react';
import {
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
import { useToast } from '@/hooks/use-toast';
import { useFmt } from '@/hooks/edgevision/use-num';
import { usePolling } from '@/hooks/edgevision/use-polling';
import { api, errMessageFa } from '@/lib/edgevision/api';
import { eventSentenceFa } from '@/lib/edgevision/events';
import { jalaliTime, relativeTime } from '@/lib/edgevision/format';
import { useStreamEvents } from '@/lib/edgevision/socket';
import type { LiveMetric, StreamInput, StreamWithSession } from '@/lib/edgevision/types';
import { EventTypeBadge, SessionStateBadge } from './shared/badges';
import { Lift, PageHeader, SectionCard, StatCard } from './shared/cards';
import { LoadingView, ErrorView, EmptyState } from './shared/state-views';
import { btn } from './shared/styles';
import type { Nav } from './shared/nav';

const ACTIVE_STATES = ['RUNNING', 'STARTING', 'DEGRADED'];

function isActive(s: StreamWithSession): boolean {
  if (s.activeSession && ACTIVE_STATES.includes(s.activeSession.state)) return true;
  // اگر activeSession فراموش شده باشد، از خودِ وضعیت استریم پی می‌بریم.
  return s.status === 'RUNNING' || s.status === 'STARTING';
}

const QUICK_START_INPUT = {
  name: 'استریم خیابان اصلی',
  scene: 'STREET' as const,
  sourceType: 'SYNTHETIC',
  width: 640,
  height: 360,
  targetFps: 15,
  objectCount: 8,
  confidenceThreshold: 0.35,
  classFilter: ['PEDESTRIAN', 'VEHICLE', 'CYCLIST'],
  roi: { x: 0.25, y: 0.15, w: 0.5, h: 0.6 },
  line: { x1: 0.5, y1: 0.1, x2: 0.5, y2: 0.9 },
  queueCapacity: 30,
  gridCols: 40,
  gridRows: 24,
  emitStride: 2,
};

export function ViewOverview({ nav }: { nav: Nav }) {
  const { toast } = useToast();
  const fmt = useFmt();
  const [quickBusy, setQuickBusy] = useState(false);
  const [socketMetrics, setSocketMetrics] = useState<Record<string, LiveMetric>>({});

  const streams = usePolling(() => api.streams(), { intervalMs: 5000 });
  const settings = usePolling(() => api.settings(), {});
  const detectionsTotal = usePolling(() => api.detections({ page: 1, pageSize: 1 }), { intervalMs: 10000 });
  const events24h = usePolling(
    () => api.events({ from: new Date(Date.now() - 24 * 3600_000).toISOString(), page: 1, pageSize: 1 }),
    { intervalMs: 10000 },
  );
  const liveMetrics = usePolling(() => api.liveMetrics(), { intervalMs: 5000 });
  const recentEvents = usePolling(() => api.events({ pageSize: 8 }), { intervalMs: 10000 });
  const chartMetrics = usePolling(
    () => api.metrics({ from: new Date(Date.now() - 15 * 60_000).toISOString(), bucket: '30s' }),
    { intervalMs: 15000 },
  );

  const streamList = streams.data?.items ?? [];
  const activeStreamIds = useMemo(
    () => streamList.filter(isActive).map((s) => s.id),
    [streamList],
  );

  useStreamEvents(activeStreamIds, {
    onMetrics: (m) => setSocketMetrics((prev) => ({ ...prev, [m.streamId]: m })),
    onSession: (s) => {
      if (s.state === 'STOPPED' || s.state === 'ERROR') {
        streams.refresh();
        liveMetrics.refresh();
      }
    },
  });

  // سنجهٔ هر استریم: آخرین مقدار سوکت یا آخرین مقدار API.
  const metricByStream = useMemo(() => {
    const map = new Map<string, LiveMetric>();
    for (const m of liveMetrics.data?.items ?? []) map.set(m.streamId, m);
    for (const m of Object.values(socketMetrics)) map.set(m.streamId, m);
    return map;
  }, [liveMetrics.data, socketMetrics]);

  const activeSessions = liveMetrics.data?.items?.length ?? streamList.filter(isActive).length;

  const chartData = useMemo(
    () =>
      (chartMetrics.data?.buckets ?? []).map((b) => ({
        ts: b.ts,
        source: b.avgSourceFps ?? 0,
        processed: b.avgProcessedFps ?? 0,
      })),
    [chartMetrics.data],
  );

  const handleQuickStart = async () => {
    setQuickBusy(true);
    try {
      const input: StreamInput = {
        ...QUICK_START_INPUT,
        queueCapacity: settings.data?.defaultQueueCapacity ?? QUICK_START_INPUT.queueCapacity,
        gridCols: settings.data?.defaultGridCols ?? QUICK_START_INPUT.gridCols,
        gridRows: settings.data?.defaultGridRows ?? QUICK_START_INPUT.gridRows,
        emitStride: settings.data?.defaultEmitStride ?? QUICK_START_INPUT.emitStride,
      };
      const created = await api.createStream(input);
      try {
        await api.startStream(created.id);
        toast({
          title: 'راه‌اندازی سریع انجام شد',
          description: `استریم «${created.name}» ایجاد و پردازش آن آغاز شد.`,
        });
      } catch (startErr) {
        toast({
          title: 'پردازش آغاز نشد',
          description: errMessageFa(startErr),
          variant: 'destructive',
        });
      }
      nav.navigate('stream-detail', { streamId: created.id });
      streams.refresh();
    } catch (err) {
      toast({ title: 'ایجاد استریم ممکن نشد', description: errMessageFa(err), variant: 'destructive' });
    } finally {
      setQuickBusy(false);
    }
  };

  const quickStartButton = (
    <Button onClick={handleQuickStart} disabled={quickBusy} className={`min-h-11 ${btn.primary}`}>
      {quickBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Zap className="size-4" aria-hidden="true" />}
      راه‌اندازی سریع
    </Button>
  );

  if (streams.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="نمای کلی" description="وضعیت کلی پلتفرم در یک نگاه" />
        <LoadingView />
      </div>
    );
  }

  if (!streams.data && streams.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="نمای کلی" />
        <ErrorView message={streams.error} onRetry={streams.refresh} />
      </div>
    );
  }

  if (streamList.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="نمای کلی"
          description="وضعیت کلی پلتفرم در یک نگاه"
          actions={quickStartButton}
        />
        <EmptyState
          icon={Radio}
          title="هنوز هیچ استریمی ثبت نشده است"
          description="اولین منبع ویدئویی خود را اضافه کنید یا با «راه‌اندازی سریع» یک استریم نمونه با تنظیمات پیشنهادی بسازید."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {quickStartButton}
              <Button variant="outline" onClick={() => nav.navigate('streams')} className={`min-h-11 ${btn.outline}`}>
               رفتن به استریم‌ها
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const streamNameById = new Map(streamList.map((s) => [s.id, s.name]));
  const liveMetricCards = [...metricByStream.values()];

  return (
    <div className="space-y-6">
      <PageHeader
        title="نمای کلی"
        description="وضعیت کلی پلتفرم در یک نگاه"
        actions={quickStartButton}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Radio}
          label="استریم‌های فعال"
          value={fmt.num(streamList.filter(isActive).length)}
          sub={`از ${fmt.num(streamList.length)} استریم ثبت‌شده`}
          tone="live"
        />
        <StatCard
          icon={Activity}
          label="نشست‌های در حال اجرا"
          value={fmt.num(activeSessions)}
          sub="پردازش زندهٔ فریم‌ها"
        />
        <StatCard
          icon={Crosshair}
          label="مجموع تشخیص‌ها"
          value={detectionsTotal.data ? fmt.num(detectionsTotal.data.total) : '—'}
          sub={detectionsTotal.error ? 'دریافت نشد' : 'از ابتدای کار سرویس'}
        />
        <StatCard
          icon={BellRing}
          label="رویدادهای ۲۴ ساعت گذشته"
          value={events24h.data ? fmt.num(events24h.data.total) : '—'}
          sub={events24h.error ? 'دریافت نشد' : 'عبور، ورود و خروج'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <SectionCard
          title="نرخ فریم منبع و پردازش"
          description="۱۵ دقیقهٔ اخیر — گام ۳۰ ثانیه"
          className="lg:col-span-3"
        >
          {chartData.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
              هنوز داده‌ای برای نمایش نیست؛ یک استریم را اجرا کنید
            </div>
          ) : (
            <div dir="ltr" className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
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
                    tickFormatter={(v: number) => fmt.num(Math.round(v))}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#18181b',
                      border: '1px solid #3f3f46',
                      borderRadius: 8,
                      fontSize: 12,
                      direction: 'rtl',
                    }}
                    labelFormatter={(v) => jalaliTime(String(v))}
                    formatter={(value: number | string, name) => [
                      `${fmt.num(Number(value))} فریم بر ثانیه`,
                      name === 'source' ? 'نرخ فریم منبع' : 'نرخ فریم پردازش',
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

        <SectionCard
          title="نشست‌های زنده"
          description="سنجه‌های لحظه‌ای هر نشست فعال"
          className="lg:col-span-2"
          contentClassName="space-y-3"
        >
          {liveMetricCards.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-zinc-800 px-6 text-center text-sm text-zinc-500">
              در حال حاضر نشست فعالی در حال اجرا نیست
            </div>
          ) : (
            <div className="thin-scroll max-h-96 space-y-3 overflow-y-auto pl-1">
              {liveMetricCards.map((m) => {
                const stream = streamList.find((s) => s.id === m.streamId);
                // متریک دریافتی از API ممکن است ظرفیت صف نداشته باشد؛ از خود استریم می‌گیریم.
                const queueCap =
                  m.queueCapacity > 0 ? m.queueCapacity : (stream?.queueCapacity ?? 0);
                return (
                  <Lift key={m.streamId}>
                    <button
                      type="button"
                      onClick={() =>
                        nav.navigate('stream-detail', {
                          streamId: m.streamId,
                          streamName: stream?.name,
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-start transition-colors hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-zinc-100">
                          {streamNameById.get(m.streamId) ?? m.streamId}
                        </p>
                        <SessionStateBadge state={stream?.activeSession?.state ?? 'RUNNING'} />
                      </div>
                      <div className="tnum mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-400">
                        <span>
                          پردازش: <span className="text-zinc-200">{fmt.num(Math.round(m.processedFps))}</span> فریم بر ثانیه
                        </span>
                        <span>
                          منبع: <span className="text-zinc-200">{fmt.num(Math.round(m.sourceFps))}</span> فریم بر ثانیه
                        </span>
                        <span>
                          تأخیر: <span className="text-zinc-200">{fmt.num(Math.round(m.latency?.avgMs ?? 0))}</span> میلی‌ثانیه
                        </span>
                        <span>
                          صف: <span className="text-zinc-200">{fmt.num(m.queueDepth)}</span>
                          {queueCap > 0 ? ` از ${fmt.num(queueCap)}` : ''}
                        </span>
                      </div>
                    </button>
                  </Lift>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="رویدادهای اخیر" description="۸ رویداد آخر — نوسازی هر ۱۰ ثانیه">
        {recentEvents.error && !recentEvents.data ? (
          <p className="py-6 text-center text-sm text-rose-400">{recentEvents.error}</p>
        ) : (recentEvents.data?.items ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">هنوز داده‌ای ثبت نشده است</p>
        ) : (
          <ul className="thin-scroll max-h-96 divide-y divide-zinc-800/70 overflow-y-auto">
            {(recentEvents.data?.items ?? []).map((ev) => (
              <li key={ev.id} className="flex items-center gap-3 py-2.5">
                <EventTypeBadge type={ev.type} />
                <p className="min-w-0 flex-1 truncate text-sm text-zinc-300">
                  {eventSentenceFa(ev)}
                  <span className="ms-2 text-xs text-zinc-600">
                    {streamNameById.get(ev.streamId) ?? ''}
                  </span>
                </p>
                <span className="tnum shrink-0 text-xs text-zinc-500" title={jalaliTime(ev.ts)}>
                  {relativeTime(ev.ts)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {streams.error && (
        <p className="flex items-center gap-2 text-xs text-amber-500/90">
          <Gauge className="size-3.5" aria-hidden="true" />
          نوسازی آخرین فهرست استریم‌ها ناموفق بود: {streams.error}
        </p>
      )}
    </div>
  );
}
