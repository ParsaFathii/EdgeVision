// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// انواع دادهٔ مشترک داشبورد — دقیقاً مطابق قرارداد ثابت‌شدهٔ API و WebSocket.

export type SceneKind = 'STREET' | 'INTERSECTION' | 'PARKING';
export type StreamStatus = 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR';
export type SessionState =
  | 'STARTING'
  | 'RUNNING'
  | 'DEGRADED'
  | 'STOPPING'
  | 'STOPPED'
  | 'ERROR';
export type EventKind = 'LINE_CROSS' | 'ROI_ENTER' | 'ROI_EXIT' | 'SESSION_END' | 'ERROR';
export type ObjectClass = 'PEDESTRIAN' | 'VEHICLE' | 'CYCLIST';

export interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** پیکربندی استریم (ورودی POST/PATCH) — بدون id و وضعیت و زمان‌ها. */
export interface StreamInput {
  name: string;
  scene: SceneKind;
  sourceType: string;
  width: number;
  height: number;
  targetFps: number;
  objectCount: number;
  confidenceThreshold: number;
  classFilter: string[];
  roi: Roi | null;
  line: Line | null;
  queueCapacity: number;
  gridCols: number;
  gridRows: number;
  emitStride: number;
}

export interface Stream extends StreamInput {
  id: string;
  status: StreamStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveSession {
  sessionId: string;
  state: SessionState;
  startedAt: string;
  framesProcessed: number;
  detectionsTotal: number;
}

export interface LatencyStats {
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
}

/** آخرین سنجهٔ یک نشست (هم شکل پیام «metrics» سوکت و هم آیتم‌های live=1). */
export interface LiveMetric {
  streamId: string;
  sessionId: string;
  ts: string | number;
  sourceFps: number;
  processedFps: number;
  latency: LatencyStats;
  queueDepth: number;
  queueCapacity: number;
  droppedTotal: number;
  cpuPercent: number | null;
  memoryMb: number | null;
  framesProcessed: number;
  detectionsTotal: number;
  uptimeMs: number;
}

export interface StreamDetail extends StreamWithSession {
  lastMetric: LiveMetric | null;
}

export interface StreamWithSession extends Stream {
  activeSession: ActiveSession | null;
}

export interface Detection {
  id: string;
  sessionId: string;
  streamId: string;
  frameIndex: number;
  ts: string;
  label: string;
  confidence: number;
  trackId: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelCount {
  label: string;
  count: number;
}

export interface EventItem {
  id: string;
  sessionId: string;
  streamId: string;
  type: EventKind;
  trackId: number | null;
  label: string | null;
  payload: Record<string, unknown> | null;
  ts: string;
}

export interface MetricBucket {
  ts: string;
  avgSourceFps?: number;
  avgProcessedFps?: number;
  avgLatencyMs?: number;
  maxQueueDepth?: number;
  avgCpuPercent?: number | null;
  /** فیلدهای اختیاری — اگر سرویس چندک‌ها را هم بفرستد استفاده می‌شوند. */
  p50Ms?: number;
  p95Ms?: number;
  detectionsTotal?: number;
  [key: string]: unknown;
}

export interface MetricsResponse {
  buckets: MetricBucket[];
  summary: Record<string, number> | null;
}

export interface Model {
  id: string;
  name: string;
  task: string;
  format: string;
  device: string;
  inputShape: string;
  classes: string[];
  sizeBytes: number;
  license: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface ModelInput {
  name: string;
  task: string;
  format: string;
  device: string;
  inputShape: string;
  classes: string[];
  sizeBytes: number;
  license: string;
  description: string;
}

export interface SessionRow {
  id: string;
  streamId: string;
  state: SessionState;
  reason: string | null;
  startedAt: string;
  endedAt: string | null;
  framesProcessed: number;
  framesDropped: number;
  detectionsTotal: number;
  eventsTotal: number;
}

export interface Settings {
  defaultGridCols: number;
  defaultGridRows: number;
  defaultQueueCapacity: number;
  defaultEmitStride: number;
}

export interface Health {
  status: 'ok' | 'degraded';
  db: boolean;
  engine: boolean;
  engineBinary: boolean;
  activeSessions: number;
  version: string;
  uptimeSec: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// — — — پیام‌های WebSocket — — —

export interface FrameObject {
  oid: string | number;
  t: ObjectClass;
  /** مختصات گوشهٔ بالا-چپ، نرمال‌شده (۰..۱). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameDetection {
  trackId: number;
  label: ObjectClass | string;
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameMsg {
  streamId: string;
  sessionId: string;
  frameIndex: number;
  ts: string | number;
  latencyMs: number | null;
  objects: FrameObject[];
  detections: FrameDetection[];
}

export interface EventMsg {
  streamId: string;
  sessionId: string;
  type: EventKind;
  ts: string | number;
  trackId?: number;
  label?: string;
  payload?: unknown;
}

export interface SessionMsg {
  streamId: string;
  sessionId: string;
  state: SessionState;
  reason?: string;
}

export interface HelloActiveSession {
  streamId: string;
  sessionId: string;
  state: SessionState;
  startedAt: string;
}

export interface HelloMsg {
  version: string;
  engineBinary: boolean;
  activeSessions: HelloActiveSession[];
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface DetectionQuery extends QueryParams {
  streamId?: string;
  label?: string;
  minConfidence?: number;
  trackId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: 'ts' | 'confidence';
  order?: 'asc' | 'desc';
}

export interface EventQuery extends QueryParams {
  streamId?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface MetricsQuery extends QueryParams {
  streamId?: string;
  from?: string;
  to?: string;
  bucket?: '1s' | '5s' | '30s' | '1m';
}
