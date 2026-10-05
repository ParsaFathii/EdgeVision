// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// کاوشگر تشخیص — فیلترها، جدول صفحه‌بندی‌شده، هیستوگرام اطمینان و دریافت CSV.

'use client';

import { useMemo, useState } from 'react';
import { Crosshair, Download, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
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
import { classLabelFa, jalali, jalaliTime } from '@/lib/edgevision/format';
import { ClassChip } from './shared/badges';
import { PageHeader, SectionCard } from './shared/cards';
import { EmptyState, ErrorView, LoadingView } from './shared/state-views';
import { ALL_STREAMS, StreamSelect, TimeRangeSelect, Pager, rangeFrom } from './shared/selects';
import { btn } from './shared/styles';
import type { Nav } from './shared/nav';

const PAGE_SIZE = 15;

export function ViewDetections({ nav }: { nav: Nav }) {
  const fmt = useFmt();
  const [streamId, setStreamId] = useState<string>(ALL_STREAMS);
  const [label, setLabel] = useState<string>('all');
  const [minConfidence, setMinConfidence] = useState(0);
  const [range, setRange] = useState<'15m' | '1h' | '6h' | '24h' | 'all'>('24h');
  const [trackId, setTrackId] = useState('');
  const [sort, setSort] = useState<'ts' | 'confidence'>('ts');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const streams = usePolling(() => api.streams(), { intervalMs: 10000 });
  const labels = usePolling(() => api.detectionLabels(), { intervalMs: 30000 });

  const filterKey = JSON.stringify({ streamId, label, minConfidence, range, trackId, sort, order, page });
  const detections = usePolling(
    () =>
      api.detections({
        streamId: streamId === ALL_STREAMS ? undefined : streamId,
        label: label === 'all' ? undefined : label,
        minConfidence: minConfidence > 0 ? minConfidence : undefined,
        trackId: trackId.trim() !== '' ? trackId.trim() : undefined,
        from: rangeFrom(range),
        to: undefined,
        page,
        pageSize: PAGE_SIZE,
        sort,
        order,
      }),
    { intervalMs: 5000, key: filterKey },
  );

  const items = detections.data?.items ?? [];
  const total = detections.data?.total ?? 0;
  const avgConf = useMemo(
    () => (items.length > 0 ? items.reduce((a, d) => a + d.confidence, 0) / items.length : null),
    [items],
  );

  const histogram = useMemo(() => {
    const bins = Array.from({ length: 10 }, () => 0);
    for (const d of items) {
      const idx = Math.min(9, Math.max(0, Math.floor(d.confidence * 10)));
      bins[idx] += 1;
    }
    const max = Math.max(1, ...bins);
    return { bins, max };
  }, [items]);

  const csvHref = api.reportsCsvUrl({
    streamId: streamId === ALL_STREAMS ? undefined : streamId,
    from: rangeFrom(range),
  });

  const changeFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  // Select های shadcn مقدار را به‌صورت string تحویل می‌دهند؛ پیش از تنظیم فیلتر، مقدار مجاز را می‌سنجیم.
  const sortFromSelect = (v: string) => {
    if (v === 'ts' || v === 'confidence') changeFilter(setSort)(v);
  };
  const orderFromSelect = (v: string) => {
    if (v === 'asc' || v === 'desc') changeFilter(setOrder)(v);
  };

  if (streams.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="کاوشگر تشخیص" description="جست‌وجو در همهٔ تشخیص‌های ثبت‌شده" />
        <LoadingView />
      </div>
    );
  }

  if (!streams.data && streams.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="کاوشگر تشخیص" />
        <ErrorView message={streams.error} onRetry={streams.refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="کاوشگر تشخیص"
        description="جست‌وجو در همهٔ تشخیص‌های ثبت‌شده"
        actions={
          <Button asChild variant="outline" className={`min-h-11 ${btn.outline}`}>
            <a href={csvHref} download aria-label="دریافت گزارش CSV">
              <Download className="size-4" aria-hidden="true" />
              دریافت CSV
            </a>
          </Button>
        }
      />

      <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-zinc-400">استریم</Label>
          <StreamSelect
            streams={streams.data?.items ?? []}
            value={streamId}
            onChange={changeFilter(setStreamId)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-zinc-400">برچسب</Label>
          <Select value={label} onValueChange={changeFilter(setLabel)} dir="rtl">
            <SelectTrigger className="w-full bg-zinc-900 text-zinc-200" aria-label="برچسب">
              <SelectValue placeholder="همهٔ برچسب‌ها" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
              <SelectItem value="all">همهٔ برچسب‌ها</SelectItem>
              {(labels.data ?? []).map((l) => (
                <SelectItem key={l.label} value={l.label}>
                  {classLabelFa(l.label)} ({fmt.num(l.count)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-zinc-400">بازهٔ زمانی</Label>
          <TimeRangeSelect value={range} onChange={changeFilter(setRange)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="det-track" className="text-zinc-400">شناسهٔ مسیر</Label>
          <Input
            id="det-track"
            dir="ltr"
            inputMode="numeric"
            placeholder="مثلاً 12"
            value={trackId}
            onChange={(e) => {
              setTrackId(e.target.value);
              setPage(1);
            }}
            className="bg-zinc-900 text-zinc-100"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="det-conf" className="text-zinc-400">حداقل اطمینان</Label>
            <span className="tnum text-sm text-emerald-400">{fmt.pct(minConfidence)}</span>
          </div>
          <Slider
            id="det-conf"
            min={0}
            max={1}
            step={0.05}
            value={[minConfidence]}
            onValueChange={([v]) => {
              setMinConfidence(v);
              setPage(1);
            }}
            className="py-2"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-zinc-400">ترتیب بر اساس</Label>
          <Select value={sort} onValueChange={sortFromSelect} dir="rtl">
            <SelectTrigger className="w-full bg-zinc-900 text-zinc-200" aria-label="ترتیب بر اساس">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
              <SelectItem value="ts">زمان</SelectItem>
              <SelectItem value="confidence">اطمینان</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-zinc-400">جهت</Label>
          <Select value={order} onValueChange={orderFromSelect} dir="rtl">
            <SelectTrigger className="w-full bg-zinc-900 text-zinc-200" aria-label="جهت ترتیب">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
              <SelectItem value="desc">نزولی</SelectItem>
              <SelectItem value="asc">صعودی</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md border border-zinc-800 bg-zinc-900/70 px-2.5 py-1 text-zinc-300">
          تعداد کل: <span className="tnum text-zinc-100">{detections.data ? fmt.num(total) : '—'}</span>
        </span>
        <span className="rounded-md border border-zinc-800 bg-zinc-900/70 px-2.5 py-1 text-zinc-300">
          میانگین اطمینان صفحه:{' '}
          <span className="tnum text-zinc-100">{avgConf !== null ? fmt.pct(avgConf) : '—'}</span>
        </span>
        {labels.error && (
          <span className="text-amber-500/90">فهرست برچسب‌ها دریافت نشد</span>
        )}
      </div>

      <SectionCard title="نتیجهٔ جست‌وجو" description="به‌روزرسانی هر ۵ ثانیه">
        {detections.loading && !detections.data ? (
          <LoadingView label="در حال جست‌وجو…" />
        ) : detections.error && !detections.data ? (
          <ErrorView message={detections.error} onRetry={detections.refresh} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Search}
            title="هیچ تشخیصی با این فیلترها پیدا نشد"
            description={
              (streams.data?.items ?? []).length === 0
                ? 'هنوز هیچ استریمی ثبت نشده است؛ ابتدا یک استریم بسازید و اجرا کنید.'
                : 'شرایط فیلتر را کمی شل‌تر کنید یا استریمی را اجرا کنید تا داده ثبت شود.'
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
                  <TableHead className="text-zinc-400">زمان</TableHead>
                  <TableHead className="text-zinc-400">برچسب</TableHead>
                  <TableHead className="text-zinc-400">اطمینان</TableHead>
                  <TableHead className="text-zinc-400">شناسهٔ مسیر</TableHead>
                  <TableHead className="text-zinc-400">فریم</TableHead>
                  <TableHead className="text-zinc-400">مختصات جعبه</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((d) => (
                  <TableRow key={d.id} className="border-zinc-800/70">
                    <TableCell className="tnum text-zinc-300" title={jalali(d.ts)}>
                      {jalaliTime(d.ts)}
                    </TableCell>
                    <TableCell>
                      <ClassChip label={d.label} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.min(100, Math.max(2, d.confidence * 100))}%` }}
                          />
                        </div>
                        <span className="tnum text-xs text-zinc-300">{fmt.pct(d.confidence)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="tnum text-zinc-300">
                      {d.trackId !== null ? `مسیر ${fmt.num(d.trackId)}` : '—'}
                    </TableCell>
                    <TableCell className="tnum text-zinc-400">{fmt.num(d.frameIndex)}</TableCell>
                    <TableCell className="tnum font-mono text-xs text-zinc-500" dir="ltr">
                      {d.x.toFixed(2)}, {d.y.toFixed(2)}, {d.w.toFixed(2)}, {d.h.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </SectionCard>

      {items.length > 0 && (
        <SectionCard
          title="توزیع اطمینان"
          description={`هیستوگرام ${fmt.num(items.length)} تشخیصِ صفحهٔ فعلی`}
        >
          <div dir="ltr" className="flex h-24 items-end gap-1.5" role="img" aria-label="هیستوگرام اطمینان تشخیص‌ها">
            {histogram.bins.map((count, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${fmt.num(count)} مورد بین ${fmt.pct(i / 10)} و ${fmt.pct((i + 1) / 10)}`}>
                <div
                  className="w-full rounded-t-sm bg-emerald-600/70"
                  style={{ height: `${Math.max(2, (count / histogram.max) * 100)}%` }}
                />
                <span className="tnum text-[10px] text-zinc-600">{fmt.num(i / 10, { maximumFractionDigits: 1 })}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
            <Crosshair className="size-3.5" aria-hidden="true" />
            محور افقی: بازهٔ اطمینان از ۰ تا ۱
          </p>
        </SectionCard>
      )}
    </div>
  );
}
