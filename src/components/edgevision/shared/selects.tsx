// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// انتخابگرهای مشترک: استریم، بازهٔ زمانی + صفحه‌بندی.

'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFmt } from '@/hooks/edgevision/use-num';
import type { StreamWithSession } from '@/lib/edgevision/types';
import { btn } from './styles';

/** مقدار «همهٔ استریم‌ها». */
export const ALL_STREAMS = 'all';

export function StreamSelect({
  streams,
  value,
  onChange,
  ariaLabel = 'انتخاب استریم',
  allLabel = 'همهٔ استریم‌ها',
}: {
  streams: StreamWithSession[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
  allLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} dir="rtl">
      <SelectTrigger aria-label={ariaLabel} className="min-w-44 bg-zinc-900 text-zinc-200">
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
        <SelectItem value={ALL_STREAMS}>{allLabel}</SelectItem>
        {streams.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export type TimeRange = '15m' | '1h' | '6h' | '24h' | 'all';

export const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '15m', label: '۱۵ دقیقه' },
  { value: '1h', label: '۱ ساعت' },
  { value: '6h', label: '۶ ساعت' },
  { value: '24h', label: '۲۴ ساعت' },
  { value: 'all', label: 'همه' },
];

export function TimeRangeSelect({
  value,
  onChange,
  withAll = true,
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
  withAll?: boolean;
}) {
  const options = withAll ? TIME_RANGES : TIME_RANGES.filter((r) => r.value !== 'all');
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TimeRange)} dir="rtl">
      <SelectTrigger aria-label="بازهٔ زمانی" className="min-w-32 bg-zinc-900 text-zinc-200">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
        {options.map((r) => (
          <SelectItem key={r.value} value={r.value}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** ISO مربوط به ابتدای بازه (یا undefined برای «همه»). */
export function rangeFrom(range: TimeRange): string | undefined {
  if (range === 'all') return undefined;
  const minutes = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 }[range];
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** بازهٔ مناسب برای سرور سنجه‌ها. */
export function bucketForRange(range: TimeRange): '1s' | '5s' | '30s' | '1m' {
  switch (range) {
    case '15m':
      return '5s';
    case '1h':
      return '30s';
    default:
      return '1m';
  }
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const fmt = useFmt();
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const hasPrev = page > 1;
  const hasNext = page < pages;
  return (
    <div className="flex items-center justify-between gap-2 pt-2">
      <p className="text-xs text-zinc-500">
        صفحهٔ {fmt.num(page)} از {fmt.num(pages)} · {fmt.num(total)} ردیف
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrev}
          onClick={() => onPage(page - 1)}
          aria-label="صفحهٔ قبل"
          className={`min-h-11 min-w-11 ${btn.outline}`}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext}
          onClick={() => onPage(page + 1)}
          aria-label="صفحهٔ بعد"
          className={`min-h-11 min-w-11 ${btn.outline}`}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
