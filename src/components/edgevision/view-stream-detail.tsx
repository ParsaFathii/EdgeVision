// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// جزئیات استریم — صحنهٔ زنده، سنجه‌های لحظه‌ای، فید تشخیص و رویداد،
// تاریخچهٔ نشست‌ها و خلاصهٔ پیکربندی.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Cpu,
  Gauge,
  HardDrive,
  Loader2,
  MemoryStick,
  Play,
  Settings2,
  Square,
  Timer,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useFmt } from '@/hooks/edgevision/use-num';
import { usePolling } from '@/hooks/edgevision/use-polling';
import { api, errMessageFa } from '@/lib/edgevision/api';
import { eventSentenceFa } from '@/lib/edgevision/events';
import { jalali, jalaliTime, relativeTime } from '@/lib/edgevision/format';
import { useStreamEvents } from '@/lib/edgevision/socket';
import type {
  Detection,
  EventItem,
  FrameMsg,
  LiveMetric,
  StreamDetail,
} from '@/lib/edgevision/types';
import { ClassChip, EventTypeBadge, SessionStateBadge, StreamStatusBadge } from './shared/badges';
import { MetricCard, PageHeader, SectionCard } from './shared/cards';
import { ErrorView, LoadingView } from './shared/state-views';
import { btn } from './shared/styles';
import type { Nav } from './shared/nav';
import { LiveScene } from './live-scene';
import { StreamEditor } from './stream-editor';

const ACTIVE_STATES = ['RUNNING', 'STARTING', 'DEGRADED'];

interface DetFeedItem {
  key: string;
  ts: number;
  label: string;
  conf: number;
  trackId: number | null;
  frameIndex: number;
}

interface EvFeedItem {
  key: string;
  type: string;
  trackId: number | null;
  label: string | null;
  payload: Record<string, unknown> | null;
  ts: number;
}

function tsNum(t: string | number | null | undefined): number {
  if (t === null || t === undefined) return Date.now();
  if (typeof t === 'number') return t;
  const p = Date.parse(t);
  return Number.isNaN(p) ? Date.now() : p;
}

function detFromApi(d: Detection): DetFeedItem {
  return {
    key: d.id,
    ts: tsNum(d.ts),
    label: d.label,
    conf: d.confidence,
    trackId: d.trackId ?? null,
    frameIndex: d.frameIndex,
  };
}

function evFromApi(e: EventItem): EvFeedItem {
  return {
    key: e.id,
    type: e.type,
    trackId: e.trackId ?? null,
    label: e.label ?? null,
    payload: e.payload ?? null,
    ts: tsNum(e.ts),
  };
}

export function ViewStreamDetail({ streamId, nav }: { streamId: string; nav: Nav }) {
  const { toast } = useToast();
  const fmt = useFmt();

  const detail = usePolling(() => api.stream(streamId), { intervalMs: 5000, key: streamId });
  const detections = usePolling(
    () => api.detections({ streamId, pageSize: 12, sort: 'ts', order: 'desc' }),
    { intervalMs: 10000, key: streamId },
  );
  const events = usePolling(() => api.events({ streamId, pageSize: 8 }), {
    intervalMs: 10000,
    key: streamId,
  });
  const sessions = usePolling(
    () => api.sessions({ streamId, page: 1, pageSize: 5 }),
    { intervalMs: 15000, key: streamId },
  );

  const [frame, setFrame] = useState<FrameMsg | null>(null);
  const [lastFrameAt, setLastFrameAt] = useState(0);
  const [stale, setStale] = useState(false);
  const [metric, setMetric] = useState<LiveMetric | null>(null);
  const [detFeed, setDetFeed] = useState<DetFeedItem[]>([]);
  const [evFeed, setEvFeed] = useState<EvFeedItem[]>([]);
  const [objectDirs, setObjectDirs] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const seenSession = useRef<string | null>(null);
  const lastPos = useRef<Map<string, number>>(new Map());
  const lastDirs = useRef<Record<string, number>>({});

  const stream = detail.data as StreamDetail | null;
  const sessionActive = stream?.activeSession
    ? ACTIVE_STATES.includes(stream.activeSession.state)
    : false;
  const running =
    sessionActive || stream?.status === 'RUNNING' || stream?.status === 'STARTING';

  // مقدار اولیهٔ فیدها از API
  useEffect(() => {
    if (detections.data) setDetFeed(detections.data.items.map(detFromApi));
  }, [detections.data]);

  useEffect(() => {
    if (events.data) setEvFeed(events.data.items.map(evFromApi));
  }, [events.data]);

  // سنجهٔ اولیه از lastMetric تا رسیدن اولین پیام سوکت
  useEffect(() => {
    if (stream?.lastMetric && !metric) setMetric(stream.lastMetric);
  }, [stream?.lastMetric, metric]);

  useStreamEvents([streamId], {
    onFrame: (f) => {
      setFrame(f);
      setLastFrameAt(Date.now());
      // جهت حرکت اشیا از موقعیت فریم قبل (در هندلر رویداد — نه رندر).
      const nextDirs: Record<string, number> = {};
      for (const o of f.objects ?? []) {
        const prev = lastPos.current.get(String(o.oid));
        const dx = prev !== undefined ? Math.sign(o.x - prev) || lastDirs.current[String(o.oid)] || 0 : 0;
        nextDirs[String(o.oid)] = dx;
        lastPos.current.set(String(o.oid), o.x);
      }
      lastDirs.current = nextDirs;
      setObjectDirs(nextDirs);
      if (f.detections?.length) {
        const items: DetFeedItem[] = f.detections.map((d) => ({
          key: `f${f.frameIndex}-${d.trackId}`,
          ts: tsNum(f.ts),
          label: String(d.label),
          conf: d.conf,
          trackId: d.trackId ?? null,
          frameIndex: f.frameIndex,
        }));
        setDetFeed((prev) => {
          const keys = new Set(items.map((i) => i.key));
          return [...items, ...prev.filter((p) => !keys.has(p.key))].slice(0, 12);
        });
      }
    },
    onMetrics: (m) => setMetric(m),
    onEvent: (e) => {
      setEvFeed((prev) =>
        [
          {
            key: `s${tsNum(e.ts)}-${e.type}`,
            type: e.type,
            trackId: e.trackId ?? null,
            label: e.label ?? null,
            payload: (e.payload ?? null) as Record<string, unknown> | null,
            ts: tsNum(e.ts),
          },
          ...prev,
        ].slice(0, 8),
      );
    },
    onSession: (s) => {
      if (s.state === 'ERROR') {
        toast({
          title: 'خطا در نشست پردازش',
          description: s.reason ?? 'نشست این استریم با خطا متوقف شد.',
          variant: 'destructive',
        });
      }
      if (seenSession.current && seenSession.current !== s.sessionId && running) {
        detail.refresh();
        sessions.refresh();
      }
      seenSession.current = s.sessionId;
    },
  });

  // تشخیص «داده‌های کهنه» — بیش از ۵ ثانیه بدون فریم
  useEffect(() => {
    const id = setInterval(() => {
      setStale(running && lastFrameAt > 0 && Date.now() - lastFrameAt > 5000);
    }, 1000);
    return () => clearInterval(id);
  }, [running, lastFrameAt]);

  const start = async () => {
    setBusy(true);
    try {
      await api.startStream(streamId);
      toast({ title: 'پردازش آغاز شد', description: `پردازش «${stream?.name ?? ''}» آغاز شد.` });
      setFrame(null);
      setLastFrameAt(0);
      lastPos.current = new Map();
      lastDirs.current = {};
      setObjectDirs({});
      detail.refresh();
    } catch (err) {
      toast({ title: 'شروع پردازش ممکن نشد', description: errMessageFa(err), variant: 'destructive' });
      detail.refresh();
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setStopConfirm(false);
    setBusy(true);
    try {
      await api.stopStream(streamId);
      toast({ title: 'پردازش متوقف شد', description: 'نشست فعال این استریم متوقف شد.' });
      detail.refresh();
      sessions.refresh();
    } catch (err) {
      toast({ title: 'توقف پردازش ممکن نشد', description: errMessageFa(err), variant: 'destructive' });
      detail.refresh();
    } finally {
      setBusy(false);
    }
  };

  // متریک اولیهٔ API ظرفیت صف را ذخیره نمی‌کند؛ از پیکربندی خود استریم می‌گیریم.
  const effectiveQueueCap =
    metric !== null && metric.queueCapacity > 0
      ? metric.queueCapacity
      : (stream?.queueCapacity ?? 0);

  const queueWarn =
    metric !== null && effectiveQueueCap > 0 && metric.queueDepth / effectiveQueueCap > 0.9;

  const confBar = useMemo(
    () => (conf: number) => (
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${Math.min(100, Math.max(2, conf * 100))}%` }}
        />
      </div>
    ),
    [],
  );

  if (detail.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="جزئیات استریم" />
        <LoadingView />
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="space-y-6">
        <PageHeader title="جزئیات استریم" />
        <ErrorView
          message={detail.error ?? 'استریم مورد نظر یافت نشد.'}
          onRetry={detail.refresh}
          hint={
            detail.error?.includes('پیدا نشد') ? (
              <Button variant="outline" onClick={() => nav.navigate('streams')} className={`mt-3 min-h-11 ${btn.outline}`}>
                <ArrowRight className="size-4" aria-hidden="true" />
                بازگشت به استریم‌ها
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={stream.name}
        description={`صحنهٔ ${stream.scene === 'STREET' ? 'خیابان' : stream.scene === 'INTERSECTION' ? 'چهارراه' : 'پارکینگ'} · ${fmt.num(stream.width)}×${fmt.num(stream.height)} · ${fmt.num(stream.targetFps)} فریم بر ثانیه`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StreamStatusBadge status={stream.status} />
            {running ? (
              <Button variant="outline" disabled={busy} onClick={() => setStopConfirm(true)} className={`min-h-11 ${btn.outline}`}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Square className="size-4" aria-hidden="true" />}
                توقف پردازش
              </Button>
            ) : (
              <Button disabled={busy} onClick={start} className={`min-h-11 ${btn.primary}`}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                شروع پردازش
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditorOpen(true)} className={`min-h-11 ${btn.outline}`}>
              <Settings2 className="size-4" aria-hidden="true" />
              ویرایش
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LiveScene stream={stream} frame={frame} running={running} stale={stale} objectDirs={objectDirs} />
        </div>

        <div className="grid grid-cols-2 gap-3 self-start">
          <MetricCard
            label="نرخ فریم منبع"
            value={metric ? `${fmt.num(Math.round(metric.sourceFps))}` : '—'}
            sub="فریم بر ثانیه"
          />
          <MetricCard
            label="نرخ فریم پردازش"
            value={metric ? `${fmt.num(Math.round(metric.processedFps))}` : '—'}
            sub="فریم بر ثانیه"
          />
          <MetricCard
            label="تأخیر استنتاج"
            value={metric ? `${fmt.num(Math.round(metric.latency?.avgMs ?? 0))}` : '—'}
            sub={
              metric
                ? `کمینه ${fmt.num(Math.round(metric.latency?.minMs ?? 0))} · بیشینه ${fmt.num(Math.round(metric.latency?.maxMs ?? 0))} · P95 ${fmt.num(Math.round(metric.latency?.p95Ms ?? 0))}`
                : 'میلی‌ثانیه'
            }
          />
          <MetricCard
            label="عمق صف"
            value={metric ? fmt.num(metric.queueDepth) : '—'}
            sub={effectiveQueueCap > 0 ? `از ظرفیت ${fmt.num(effectiveQueueCap)}` : undefined}
            warn={queueWarn}
          />
          <MetricCard
            label="فریم‌های حذف‌شده"
            value={metric ? fmt.num(metric.droppedTotal ?? 0) : '—'}
            sub="به‌دلیل پر بودن صف"
            warn={metric ? (metric.droppedTotal ?? 0) > 0 : false}
          />
          <MetricCard
            label="پردازنده"
            value={
              metric
                ? metric.cpuPercent !== null && metric.cpuPercent !== undefined
                  ? fmt.pct(metric.cpuPercent / 100)
                  : '—'
                : '—'
            }
            sub="به‌دست موتور"
          />
          <MetricCard
            label="حافظه"
            value={metric ? (metric.memoryMb !== null && metric.memoryMb !== undefined ? `${fmt.num(Math.round(metric.memoryMb))}` : '—') : '—'}
            sub="مگابایت"
          />
          <MetricCard
            label="فریم‌های پردازش‌شده"
            value={metric ? fmt.num(metric.framesProcessed ?? 0) : '—'}
            sub="از ابتدای نشست"
          />
          <MetricCard
            label="مدت اجرا"
            value={metric ? fmt.dur(metric.uptimeMs ?? 0) : '—'}
            sub={stream.activeSession ? `از ${jalaliTime(stream.activeSession.startedAt, false)}` : undefined}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <SectionCard
          title="تشخیص‌های اخیر"
          description="۱۲ مورد آخر — به‌روزرسانی زنده"
        >
          {detFeed.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">هنوز داده‌ای ثبت نشده است</p>
          ) : (
            <ul className="thin-scroll max-h-96 divide-y divide-zinc-800/70 overflow-y-auto">
              {detFeed.map((d) => (
                <li key={d.key} className="flex items-center gap-3 py-2">
                  <span className="tnum w-16 shrink-0 text-xs text-zinc-500">{jalaliTime(d.ts)}</span>
                  <ClassChip label={d.label} />
                  {confBar(d.conf)}
                  <span className="tnum text-xs text-zinc-400">٪{fmt.num(Math.round(d.conf * 100))}</span>
                  <span className="text-xs text-zinc-500">
                    {d.trackId !== null ? `مسیر ${fmt.num(d.trackId)}` : '—'}
                  </span>
                  <span className="tnum ms-auto text-xs text-zinc-600">فریم {fmt.num(d.frameIndex)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="رویدادهای اخیر" description="۸ مورد آخر — به‌روزرسانی زنده">
          {evFeed.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">هنوز داده‌ای ثبت نشده است</p>
          ) : (
            <ul className="thin-scroll max-h-96 divide-y divide-zinc-800/70 overflow-y-auto">
              {evFeed.map((e) => (
                <li key={e.key} className="flex items-start gap-3 py-2">
                  <EventTypeBadge type={e.type} />
                  <p className="min-w-0 flex-1 text-sm leading-6 text-zinc-300">{eventSentenceFa(e)}</p>
                  <span className="tnum shrink-0 text-xs text-zinc-500" title={jalaliTime(e.ts)}>
                    {relativeTime(e.ts)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* min-w-0 اجازه می‌دهد کارت‌ها در موبایل به عرض viewport جمع شوند و جدول داخل overflow-x-auto خودش اسکرول بخورد */}
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <SectionCard title="نشست‌های اخیر" description="۵ نشست آخر این استریم">
          {sessions.error && !sessions.data ? (
            <p className="py-6 text-center text-sm text-rose-400">{sessions.error}</p>
          ) : (sessions.data?.items ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">هنوز برای این استریم نشستی اجرا نشده است</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">وضعیت</TableHead>
                  <TableHead className="text-zinc-400">شروع</TableHead>
                  <TableHead className="text-zinc-400">مدت</TableHead>
                  <TableHead className="text-zinc-400">فریم‌ها</TableHead>
                  <TableHead className="text-zinc-400">تشخیص‌ها</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sessions.data?.items ?? []).map((s) => (
                  <TableRow key={s.id} className="border-zinc-800/70">
                    <TableCell><SessionStateBadge state={s.state} /></TableCell>
                    <TableCell className="tnum text-zinc-300">{jalaliTime(s.startedAt, false)}</TableCell>
                    <TableCell className="tnum text-zinc-300">
                      {fmt.dur((tsNum(s.endedAt ?? Date.now()) - tsNum(s.startedAt)))}
                    </TableCell>
                    <TableCell className="tnum text-zinc-300">{fmt.num(s.framesProcessed)}</TableCell>
                    <TableCell className="tnum text-zinc-300">{fmt.num(s.detectionsTotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard
          title="پیکربندی"
          description="تنظیمات فعلی استریم"
          action={
            <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)} className={`min-h-11 ${btn.outline}`}>
              <Settings2 className="size-4" aria-hidden="true" />
              ویرایش
            </Button>
          }
        >
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2 border-b border-zinc-800/60 pb-1.5">
              <dt className="text-zinc-500">نام</dt>
              <dd className="truncate text-zinc-200">{stream.name}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-zinc-800/60 pb-1.5">
              <dt className="text-zinc-500">آستانهٔ اطمینان</dt>
              <dd className="tnum text-zinc-200">{fmt.pct(stream.confidenceThreshold, 2)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-zinc-800/60 pb-1.5">
              <dt className="text-zinc-500">دسته‌های پیگیری</dt>
              <dd className="text-zinc-200">
                {stream.classFilter.map((c) => (
                  <ClassChip key={c} label={c} />
                ))}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-zinc-800/60 pb-1.5">
              <dt className="text-zinc-500">تعداد اشیا</dt>
              <dd className="tnum text-zinc-200">{fmt.num(stream.objectCount)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-zinc-800/60 pb-1.5">
              <dt className="text-zinc-500">ناحیهٔ پایش</dt>
              <dd className="tnum text-zinc-200" dir="ltr">
                {stream.roi
                  ? `${stream.roi.x.toFixed(2)}, ${stream.roi.y.toFixed(2)}, ${stream.roi.w.toFixed(2)}, ${stream.roi.h.toFixed(2)}`
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-zinc-800/60 pb-1.5">
              <dt className="text-zinc-500">خط عبور</dt>
              <dd className="tnum text-zinc-200" dir="ltr">
                {stream.line
                  ? `${stream.line.x1.toFixed(2)}, ${stream.line.y1.toFixed(2)} → ${stream.line.x2.toFixed(2)}, ${stream.line.y2.toFixed(2)}`
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-zinc-800/60 pb-1.5">
              <dt className="text-zinc-500">ظرفیت صف</dt>
              <dd className="tnum text-zinc-200">{fmt.num(stream.queueCapacity)} فریم</dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-zinc-800/60 pb-1.5">
              <dt className="text-zinc-500">شبکهٔ استنتاج</dt>
              <dd className="tnum text-zinc-200">
                {fmt.num(stream.gridCols)}×{fmt.num(stream.gridRows)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-zinc-800/60 pb-1.5">
              <dt className="text-zinc-500">گام ارسال فریم</dt>
              <dd className="tnum text-zinc-200">{fmt.num(stream.emitStride)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-zinc-800/60 pb-1.5">
              <dt className="text-zinc-500">آخرین به‌روزرسانی</dt>
              <dd className="tnum text-zinc-200">{jalali(stream.updatedAt)}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1"><Timer className="size-3.5" aria-hidden="true" /> تأخیرها بر حسب میلی‌ثانیه</span>
            <span className="flex items-center gap-1"><Gauge className="size-3.5" aria-hidden="true" /> سنجه‌ها هر ۲ ثانیه از موتور</span>
            <span className="flex items-center gap-1"><Cpu className="size-3.5" aria-hidden="true" /> پردازندهٔ موتور</span>
            <span className="flex items-center gap-1"><MemoryStick className="size-3.5" aria-hidden="true" /> حافظهٔ فرایند</span>
            <span className="flex items-center gap-1"><HardDrive className="size-3.5" aria-hidden="true" /> صف فریم محدود</span>
          </div>
        </SectionCard>
      </div>

      <AlertDialog open={stopConfirm} onOpenChange={setStopConfirm}>
        <AlertDialogContent className="border-zinc-800 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-50">توقف پردازش</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              نشست فعال این استریم متوقف شود؟ داده‌های ثبت‌شده حفظ می‌شوند اما پایش زنده قطع خواهد شد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className={`min-h-11 ${btn.outline}`}>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={stop} className={`min-h-11 ${btn.danger}`}>
              توقف پردازش
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StreamEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        mode="edit"
        stream={stream}
        defaults={null}
        onSaved={() => detail.refresh()}
      />
    </div>
  );
}
