// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// کلاینت REST تایپ‌دار — پایهٔ نسبی «/api/v1»، مهلت ۸ ثانیه، خطاهای فارسی.

import type {
  Detection,
  DetectionQuery,
  EventItem,
  EventQuery,
  Health,
  LabelCount,
  LiveMetric,
  MetricsQuery,
  MetricsResponse,
  Model,
  ModelInput,
  Paginated,
  QueryParams,
  SessionRow,
  Settings,
  Stream,
  StreamDetail,
  StreamInput,
  StreamWithSession,
} from './types';
import {
  normalizeLiveMetrics,
  normalizeModel,
  normalizeSettings,
  normalizeStream,
  normalizeStreamDetail,
} from './normalize';

const BASE = '/api/v1';
const TIMEOUT_MS = 8000;

export class ApiRequestError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
  }
}

/** پیام فارسی پیش‌فرض برای کدهای شناخته‌شدهٔ خطا. */
function codeMessageFa(code: string): string | null {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'داده‌های ارسالی معتبر نیست؛ مقادیر را بررسی کنید.';
    case 'NOT_FOUND':
      return 'موردی که دنبالش هستید پیدا نشد.';
    case 'CONFLICT':
      return 'این مورد از قبل وجود دارد؛ نام دیگری انتخاب کنید.';
    case 'PAYLOAD_TOO_LARGE':
      return 'حجم داده‌ها بیش از حد مجاز است.';
    case 'RATE_LIMITED':
      return 'تعداد درخواست‌ها زیاد شده است؛ کمی بعد دوباره تلاش کنید.';
    case 'ENGINE_UNAVAILABLE':
      return 'سرویس پردازش در دسترس نیست.';
    case 'SESSION_ACTIVE':
      return 'برای این استریم یک نشست فعال وجود دارد.';
    default:
      return null;
  }
}

function statusMessageFa(status: number): string {
  switch (status) {
    case 400:
      return 'درخواست نامعتبر بود؛ مقادیر را بررسی کنید.';
    case 404:
      return 'موردی که دنبالش هستید پیدا نشد.';
    case 409:
      return 'این عملیات با وضعیت فعلی سازگار نیست.';
    case 413:
      return 'حجم داده‌ها بیش از حد مجاز است.';
    case 429:
      return 'تعداد درخواست‌ها زیاد شده است؛ کمی بعد دوباره تلاش کنید.';
    case 500:
      return 'خطای داخلی سرور رخ داد.';
    case 503:
      return 'سرویس در حال حاضر در دسترس نیست.';
    default:
      return 'خطایی در ارتباط با سرور رخ داد.';
  }
}

function buildUrl(path: string, params?: QueryParams): string {
  const url = `${BASE}${path}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.append(key, String(value));
  }
  const q = qs.toString();
  return q ? `${url}?${q}` : url;
}

async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function raiseForError(res: Response): Promise<void> {
  if (res.ok) return;
  const body = (await parseJsonBody(res)) as { error?: { code?: string; message?: string } } | null;
  const code = body?.error?.code ?? `HTTP_${res.status}`;
  const serverMessage = body?.error?.message;
  const message = serverMessage ?? codeMessageFa(code) ?? statusMessageFa(res.status);
  throw new ApiRequestError(code, message, res.status);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  params?: QueryParams;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.params), {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiRequestError('TIMEOUT', 'پاسخی از سرور در مهلت مقرر دریافت نشد.');
    }
    throw new ApiRequestError('NETWORK', 'ارتباط با سرور برقرار نشد.');
  } finally {
    clearTimeout(timer);
  }
  await raiseForError(res);
  if (res.status === 204) return undefined as T;
  const data = (await parseJsonBody(res)) as T;
  return data ?? (undefined as T);
}

export const api = {
  health(): Promise<Health> {
    return request<Health>('/health');
  },

  streams(): Promise<{ items: StreamWithSession[] }> {
    return request<{ items: unknown[] }>('/streams').then((res) => ({
      items: (res?.items ?? []).map(normalizeStream),
    }));
  },

  stream(id: string): Promise<StreamDetail> {
    return request<unknown>(`/streams/${encodeURIComponent(id)}`).then(normalizeStreamDetail);
  },

  createStream(input: StreamInput): Promise<Stream> {
    return request<unknown>('/streams', { method: 'POST', body: input }).then(normalizeStream);
  },

  patchStream(id: string, input: Partial<StreamInput>): Promise<Stream> {
    return request<unknown>(`/streams/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    }).then(normalizeStream);
  },

  deleteStream(id: string): Promise<void> {
    return request<void>(`/streams/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  startStream(id: string): Promise<unknown> {
    return request<unknown>(`/streams/${encodeURIComponent(id)}/start`, { method: 'POST' });
  },

  stopStream(id: string): Promise<unknown> {
    return request<unknown>(`/streams/${encodeURIComponent(id)}/stop`, { method: 'POST' });
  },

  detections(query: DetectionQuery = {}): Promise<Paginated<Detection>> {
    return request<Paginated<Detection>>('/detections', { params: query });
  },

  detectionLabels(): Promise<LabelCount[]> {
    return request<LabelCount[]>('/detections/labels');
  },

  events(query: EventQuery = {}): Promise<Paginated<EventItem>> {
    return request<Paginated<EventItem>>('/events', { params: query });
  },

  metrics(query: MetricsQuery = {}): Promise<MetricsResponse> {
    return request<MetricsResponse>('/metrics', { params: query });
  },

  liveMetrics(): Promise<{ items: LiveMetric[] }> {
    return request<unknown>('/metrics', { params: { live: 1 } }).then(normalizeLiveMetrics);
  },

  models(): Promise<{ items: Model[] }> {
    return request<{ items: unknown[] }>('/models').then((res) => ({
      items: (res?.items ?? []).map(normalizeModel),
    }));
  },

  createModel(input: ModelInput): Promise<Model> {
    // سرور فعلی فیلد «classesJson» را اعتبارسنجی می‌کند؛ «classes» هم برای
    // قرارداد اسمی همراه می‌شود (فیلدهای ناشناخته سمت سرور نادیده گرفته می‌شوند).
    return request<Model>('/models', {
      method: 'POST',
      body: { ...input, classesJson: input.classes },
    });
  },

  patchModel(id: string, body: { isActive: boolean }): Promise<Model> {
    return request<unknown>(`/models/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    }).then(normalizeModel);
  },

  sessions(
    query: { streamId?: string; state?: string; page?: number; pageSize?: number } = {},
  ): Promise<Paginated<SessionRow>> {
    return request<Paginated<SessionRow>>('/sessions', { params: query });
  },

  settings(): Promise<Settings> {
    return request<unknown>('/settings').then(normalizeSettings);
  },

  patchSettings(input: Settings): Promise<Settings> {
    return request<unknown>('/settings', { method: 'PATCH', body: input }).then(normalizeSettings);
  },

  /** نشانی گزارش CSV برای دانلود مستقیم (بدون fetch). */
  reportsCsvUrl(query: { streamId?: string; from?: string; to?: string } = {}): string {
    const params: QueryParams = { format: 'csv', ...query };
    return buildUrl('/reports', params);
  },
};

/** تبدیل هر خطایی به پیام فارسی قابل نمایش. */
export function errMessageFa(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'خطای ناشناخته‌ای رخ داد.';
}
