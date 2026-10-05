// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// اتصال بلادرنگ (socket.io) — دقیقاً مطابق الگوی سندباکس:
// io('/?XTransformPort=3003', { transports: ['websocket','polling'], ... })
// اتصال یکتا (singleton) + ثبت‌نام مجدد خودکار اشتراک‌ها پس از هر (باز)اتصال.

'use client';

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import { normalizeMetric } from './normalize';
import type {
  EventMsg,
  FrameMsg,
  HelloMsg,
  LiveMetric,
  SessionMsg,
} from './types';

export type SocketConnState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface SocketStore {
  status: SocketConnState;
  hello: HelloMsg | null;
  rttMs: number | null;
  setStore: (patch: Partial<Omit<SocketStore, 'setStore'>>) => void;
}

export const useSocketStore = create<SocketStore>((set) => ({
  status: 'connecting',
  hello: null,
  rttMs: null,
  setStore: (patch) => set(patch),
}));

export interface StreamHandlers {
  onFrame?: (frame: FrameMsg) => void;
  onMetrics?: (metric: LiveMetric) => void;
  onEvent?: (event: EventMsg) => void;
  onSession?: (session: SessionMsg) => void;
}

interface Registration {
  /** null یعنی شنوندهٔ همهٔ رویدادها (بدون اشتراک اضافه). */
  streams: string[] | null;
  handlers: StreamHandlers;
}

let socket: Socket | null = null;
const registrations = new Set<Registration>();
const wanted = new Set<string>();
let lastPingAt = 0;

function emitSubscribe(streams: string[]): void {
  if (socket && socket.connected && streams.length > 0) {
    socket.emit('subscribe', { streams });
  }
}

function emitUnsubscribe(streams: string[]): void {
  if (socket && socket.connected && streams.length > 0) {
    socket.emit('unsubscribe', { streams });
  }
}

/** بازارسال اشتراک‌های فعلی — روی هر اتصال (موفق) فراخوانی می‌شود. */
function resubscribeAll(): void {
  emitSubscribe([...wanted]);
}

function register(reg: Registration): () => void {
  const added: string[] = [];
  for (const s of reg.streams ?? []) {
    if (s !== '' && !wanted.has(s)) {
      wanted.add(s);
      added.push(s);
    }
  }
  registrations.add(reg);
  if (added.length > 0) emitSubscribe(added);
  return () => {
    registrations.delete(reg);
    const removed: string[] = [];
    for (const s of reg.streams ?? []) {
      let stillWanted = false;
      for (const other of registrations) {
        if (other.streams && other.streams.includes(s)) {
          stillWanted = true;
          break;
        }
      }
      if (!stillWanted && wanted.has(s)) {
        wanted.delete(s);
        removed.push(s);
      }
    }
    if (removed.length > 0) emitUnsubscribe(removed);
  };
}

function dispatch(streamId: string, invoke: (h: StreamHandlers) => void): void {
  for (const reg of registrations) {
    if (reg.streams === null || reg.streams.includes(streamId)) {
      invoke(reg.handlers);
    }
  }
}

// — — — اعتبارسنجی پیام‌های ورودی: unknown + محدودسازی نوع (بدون any) — —

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStreamId(data: unknown): string | null {
  if (!isRecord(data) || typeof data.streamId !== 'string' || data.streamId === '') return null;
  return data.streamId;
}

/** پیام «frame» — فیلدهای حیاتی بررسی و بقیه مطابق قرارداد نگه داشته می‌شوند. */
function parseFrame(data: unknown): FrameMsg | null {
  if (!isRecord(data)) return null;
  if (typeof data.frameIndex !== 'number' || !Array.isArray(data.objects) || !Array.isArray(data.detections)) {
    return null;
  }
  return data as unknown as FrameMsg;
}

/** پیام «event» — نوع و شناسهٔ استریم الزامی است. */
function parseEventMsg(data: unknown): EventMsg | null {
  if (!isRecord(data) || typeof data.type !== 'string') return null;
  return data as unknown as EventMsg;
}

/** پیام «session» — وضعیت نشست الزامی است. */
function parseSessionMsg(data: unknown): SessionMsg | null {
  if (!isRecord(data) || typeof data.state !== 'string') return null;
  return data as unknown as SessionMsg;
}

/** اتصال یکتا — بار اول روی اولین استفاده ساخته می‌شود. */
export function getSocket(): Socket {
  if (socket) return socket;
  socket = io('/?XTransformPort=3003', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    timeout: 10000,
  });

  socket.on('connect', () => {
    useSocketStore.getState().setStore({ status: 'connected' });
    // نکتهٔ حیاتی: روی هر (باز)اتصال، اشتراک‌های لازم دوباره ارسال می‌شوند.
    resubscribeAll();
  });

  socket.on('disconnect', (reason: string) => {
    useSocketStore
      .getState()
      .setStore({ status: reason === 'io client disconnect' ? 'disconnected' : 'reconnecting' });
  });

  socket.on('connect_error', () => {
    useSocketStore.getState().setStore({ status: 'reconnecting' });
  });

  socket.on('reconnect_attempt', () => {
    useSocketStore.getState().setStore({ status: 'reconnecting' });
  });

  socket.on('hello', (data: unknown) => {
    if (isRecord(data) && typeof data.version === 'string') {
      const active = Array.isArray(data.activeSessions) ? data.activeSessions : [];
      useSocketStore.getState().setStore({
        hello: { ...data, activeSessions: active } as unknown as HelloMsg,
      });
    }
  });

  socket.on('pong', () => {
    if (lastPingAt > 0) {
      useSocketStore.getState().setStore({ rttMs: Date.now() - lastPingAt });
    }
  });

  socket.on('frame', (data: unknown) => {
    const streamId = readStreamId(data);
    const frame = parseFrame(data);
    if (streamId && frame) {
      dispatch(streamId, (h) => h.onFrame?.(frame));
    }
  });

  socket.on('metrics', (data: unknown) => {
    const streamId = readStreamId(data);
    const metric = normalizeMetric(data); // هر دو شکل تخت و latency تودرتو را می‌پذیرد
    if (streamId && metric) {
      dispatch(streamId, (h) => h.onMetrics?.(metric));
    }
  });

  socket.on('event', (data: unknown) => {
    const streamId = readStreamId(data);
    const event = parseEventMsg(data);
    if (streamId && event) {
      dispatch(streamId, (h) => h.onEvent?.(event));
    }
  });

  socket.on('session', (data: unknown) => {
    const streamId = readStreamId(data);
    const session = parseSessionMsg(data);
    if (streamId && session) {
      dispatch(streamId, (h) => h.onSession?.(session));
    }
  });

  // سنجش زنده بودن اتصال — هر ۲۵ ثانیه یک «ping».
  window.setInterval(() => {
    if (socket && socket.connected) {
      lastPingAt = Date.now();
      socket.emit('ping');
    }
  }, 25000);

  return socket;
}

/** وضعیت اتصال + اتصال خودکار در اولین استفاده. */
export function useSocketStatus(): {
  status: SocketConnState;
  hello: HelloMsg | null;
  rttMs: number | null;
} {
  const status = useSocketStore((s) => s.status);
  const hello = useSocketStore((s) => s.hello);
  const rttMs = useSocketStore((s) => s.rttMs);
  useEffect(() => {
    getSocket();
  }, []);
  return { status, hello, rttMs };
}

/**
 * اشتراک رویدادهای یک یا چند استریم با مدیریت خودکار چرخهٔ عمر.
 * streams === null یعنی شنیدن همهٔ رویدادها (بدون ایجاد اشتراک جدید)؛
 * آرایهٔ خالی یعنی فقط رویدادهای عمومی که فعلاً از سمت سرور نمی‌آید.
 */
export function useStreamEvents(streams: string[] | null, handlers: StreamHandlers): void {
  const key = streams === null ? '*' : streams.join(',');
  const handlersRef = useRef<StreamHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    getSocket();
    // فهرست صرفاً از «key» بازسازی می‌شود تا هویت آرایهٔ ورودی در هر رندر
    // باعث ثبت‌نام مجدد نشود؛ «*» یعنی همهٔ رویدادها و «» یعنی هیچ استریمی.
    const list = key === '*' ? null : key === '' ? [] : key.split(',');
    const stable: StreamHandlers = {
      onFrame: (f) => handlersRef.current.onFrame?.(f),
      onMetrics: (m) => handlersRef.current.onMetrics?.(m),
      onEvent: (e) => handlersRef.current.onEvent?.(e),
      onSession: (s) => handlersRef.current.onSession?.(s),
    };
    const reg: Registration = { streams: list, handlers: stable };
    return register(reg);
  }, [key]);
}
