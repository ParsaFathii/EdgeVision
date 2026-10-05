// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// لایهٔ مقاوم‌سازی پاسخ‌های API — قرارداد اسمی را اعمال می‌کند و
// شکل‌های نزدیک (فیلدهای *Json، متریکِ تخت، sessions به‌جای items) را هم می‌پذیرد.

import type {
  LatencyStats,
  LiveMetric,
  Model,
  Roi,
  Settings,
  StreamDetail,
  StreamWithSession,
  Line,
} from './types';

function parseMaybeJson<T>(value: unknown): T | null {
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  if (value !== null && value !== undefined && typeof value === 'object') {
    return value as T;
  }
  return null;
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function numOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function strOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** تأخیر — هم شکل تخت (latencyAvgMs…) و هم تودرتو (latency.avgMs…). */
function normalizeLatency(raw: Record<string, unknown>, nested: unknown): LatencyStats {
  const n = (nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : null) ?? {};
  const avg = numOrNull(n.avgMs) ?? numOrNull(raw.latencyAvgMs) ?? numOrNull(raw.avgLatencyMs) ?? 0;
  return {
    avgMs: avg,
    minMs: numOrNull(n.minMs) ?? numOrNull(raw.latencyMinMs) ?? avg,
    maxMs: numOrNull(n.maxMs) ?? numOrNull(raw.latencyMaxMs) ?? avg,
    p50Ms: numOrNull(n.p50Ms) ?? numOrNull(raw.latencyP50Ms) ?? avg,
    p95Ms: numOrNull(n.p95Ms) ?? numOrNull(raw.latencyP95Ms) ?? avg,
  };
}

/** متریک زنده — متر tolerant برای هر دو شکل گزارش‌شده. */
export function normalizeMetric(raw: unknown): LiveMetric | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    streamId: strOr(r.streamId),
    sessionId: strOr(r.sessionId),
    ts: (r.ts as string | number | undefined) ?? Date.now(),
    sourceFps: num(r.sourceFps),
    processedFps: num(r.processedFps),
    latency: normalizeLatency(r, r.latency),
    queueDepth: num(r.queueDepth),
    queueCapacity: num(r.queueCapacity),
    droppedTotal: num(r.droppedTotal),
    cpuPercent: numOrNull(r.cpuPercent),
    memoryMb: numOrNull(r.memoryMb),
    framesProcessed: num(r.framesProcessed),
    detectionsTotal: num(r.detectionsTotal),
    uptimeMs: num(r.uptimeMs),
  };
}

/** استریم — بازکردن فیلدهای JSON و شکل‌های جایگزین. */
export function normalizeStream(raw: unknown): StreamWithSession {
  const r = (raw ?? {}) as Record<string, unknown>;
  const classFilter =
    parseMaybeJson<string[]>(r.classFilterJson) ?? parseMaybeJson<string[]>(r.classFilter) ?? [];
  const roi = parseMaybeJson<Roi>(r.roiJson) ?? parseMaybeJson<Roi>(r.roi);
  const line = parseMaybeJson<Line>(r.lineJson) ?? parseMaybeJson<Line>(r.line);
  const active = (r.activeSession ?? null) as StreamWithSession['activeSession'];
  return {
    id: strOr(r.id),
    name: strOr(r.name, 'بدون نام'),
    scene: (['STREET', 'INTERSECTION', 'PARKING'].includes(String(r.scene))
      ? String(r.scene)
      : 'STREET') as StreamWithSession['scene'],
    sourceType: strOr(r.sourceType, 'SYNTHETIC'),
    width: num(r.width, 640),
    height: num(r.height, 360),
    targetFps: num(r.targetFps, 15),
    objectCount: num(r.objectCount, 8),
    confidenceThreshold: num(r.confidenceThreshold, 0.35),
    classFilter: Array.isArray(classFilter) ? classFilter : [],
    roi: roi && Number.isFinite(roi.x) ? roi : null,
    line: line && Number.isFinite(line.x1) ? line : null,
    queueCapacity: num(r.queueCapacity, 30),
    gridCols: num(r.gridCols, 40),
    gridRows: num(r.gridRows, 24),
    emitStride: num(r.emitStride, 2),
    status: (['IDLE', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR'].includes(String(r.status))
      ? String(r.status)
      : 'IDLE') as StreamWithStreamStatus,
    createdAt: strOr(r.createdAt, new Date().toISOString()),
    updatedAt: strOr(r.updatedAt, new Date().toISOString()),
    activeSession:
      active && typeof active === 'object'
        ? {
            sessionId: strOr(active.sessionId),
            // مقدار وضعیت از سرور می‌آید؛ اگر خارج از دامنهٔ شناخته‌شده بود، محافظه‌کارانه RUNNING در نظر می‌گیریم.
            state: (
              ['STARTING', 'RUNNING', 'DEGRADED', 'STOPPING', 'STOPPED', 'ERROR'] as const
            ).includes(active.state)
              ? active.state
              : 'RUNNING',
            startedAt: strOr(active.startedAt, new Date().toISOString()),
            framesProcessed: num(active.framesProcessed),
            detectionsTotal: num(active.detectionsTotal),
          }
        : null,
  };
}

type StreamWithStreamStatus = StreamWithSession['status'];

/** جزئیات استریم — lastMetric از هر دو نام ممکن. */
export function normalizeStreamDetail(raw: unknown): StreamDetail {
  const base = normalizeStream(raw);
  const r = (raw ?? {}) as Record<string, unknown>;
  const metric = normalizeMetric(r.lastMetric ?? r.latestMetric);
  return { ...base, lastMetric: metric };
}

export function normalizeModel(raw: unknown): Model {
  const r = (raw ?? {}) as Record<string, unknown>;
  const classes =
    parseMaybeJson<string[]>(r.classesJson) ?? parseMaybeJson<string[]>(r.classes) ?? [];
  return {
    id: strOr(r.id),
    name: strOr(r.name, 'بدون نام'),
    task: strOr(r.task),
    format: strOr(r.format),
    device: strOr(r.device),
    inputShape: strOr(r.inputShape, '—'),
    classes: Array.isArray(classes) ? classes : [],
    sizeBytes: num(r.sizeBytes),
    license: strOr(r.license, '—'),
    description: typeof r.description === 'string' ? r.description : null,
    isActive: r.isActive === true,
    createdAt: strOr(r.createdAt, new Date().toISOString()),
  };
}

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    defaultGridCols: num(r.defaultGridCols, 40),
    defaultGridRows: num(r.defaultGridRows, 24),
    defaultQueueCapacity: num(r.defaultQueueCapacity, 30),
    defaultEmitStride: num(r.defaultEmitStride, 2),
  };
}

/**
 * پاسخ متریک زنده — items (قرارداد) یا sessions (پیاده‌سازی فعلی که
 * آخرین متریکِ هر نشست را زیر کلید «metric» می‌فرستد و شمارنده‌ها را بالای آن).
 */
export function normalizeLiveMetrics(raw: unknown): { items: LiveMetric[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.items) ? r.items : Array.isArray(r.sessions) ? r.sessions : [];
  const items: LiveMetric[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const nested =
      e.metric && typeof e.metric === 'object' ? (e.metric as Record<string, unknown>) : null;
    const m: Record<string, unknown> = nested ? { ...nested } : { ...e };
    // فیلدهای سطح نشست (اگر تازه‌تر باشند) بر متریک تودرتو اولویت دارند.
    m.streamId ??= e.streamId;
    m.sessionId ??= e.sessionId;
    if (typeof e.framesProcessed === 'number') m.framesProcessed = e.framesProcessed;
    if (typeof e.detectionsTotal === 'number') m.detectionsTotal = e.detectionsTotal;
    const metric = normalizeMetric(m);
    if (metric) items.push(metric);
  }
  return { items };
}
