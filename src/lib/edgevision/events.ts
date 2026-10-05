// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// ساخت جملهٔ فارسی طبیعی برای هر رویداد.

import { classLabelFa, eventTypeFa, faNumber } from './format';
import type { EventKind } from './types';

export interface EventLike {
  type: EventKind | string;
  trackId?: number | null;
  label?: string | null;
  payload?: Record<string, unknown> | null;
}

function readDirection(payload: Record<string, unknown> | null | undefined): 'ltr' | 'rtl' | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload.direction ?? payload.dir;
  if (typeof raw !== 'string') return null;
  const v = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (v.includes('left_to_right') || v === 'l2r' || v === 'ltr' || v === 'lr' || v === 'left') {
    return 'ltr';
  }
  if (v.includes('right_to_left') || v === 'r2l' || v === 'rtl' || v === 'rl' || v === 'right') {
    return 'rtl';
  }
  return null;
}

function readString(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const v = payload[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** جملهٔ توصیفی فارسی برای یک رویداد. */
export function eventSentenceFa(ev: EventLike): string {
  const label = ev.label ? classLabelFa(ev.label) : '';
  const track = ev.trackId !== null && ev.trackId !== undefined ? `مسیر ${faNumber(ev.trackId)}` : '';
  const who = label && track ? `${label} (${track})` : label || track || 'شیء';

  switch (ev.type) {
    case 'LINE_CROSS': {
      const dir = readDirection(ev.payload);
      const dirText = dir === 'ltr' ? ' — جهت چپ به راست' : dir === 'rtl' ? ' — جهت راست به چپ' : '';
      return `${who} از خط عبور کرد${dirText}`;
    }
    case 'ROI_ENTER':
      return `${who} وارد ناحیهٔ پایش شد`;
    case 'ROI_EXIT':
      return `${who} از ناحیهٔ پایش خارج شد`;
    case 'SESSION_END': {
      const reason = readString(ev.payload, 'reason') ?? readString(ev.payload, 'stopReason');
      return `نشست به پایان رسید${reason ? ` — دلیل: ${reason}` : ''}`;
    }
    case 'ERROR': {
      const message = readString(ev.payload, 'message') ?? readString(ev.payload, 'error');
      return `خطا در پردازش رخ داد${message ? `: ${message}` : ''}`;
    }
    default:
      return `رویداد «${eventTypeFa(ev.type)}» رخ داد`;
  }
}
