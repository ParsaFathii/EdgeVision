// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// تنظیمات — پیش‌فرض‌های موتور، ترجیحات نمایش و دربارهٔ EdgeVision.

'use client';

import { useEffect, useState } from 'react';
import { Info, Loader2, RotateCcw, Save } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useFmt } from '@/hooks/edgevision/use-num';
import { usePolling } from '@/hooks/edgevision/use-polling';
import { api, errMessageFa } from '@/lib/edgevision/api';
import { useDisplayPrefs } from '@/lib/edgevision/prefs';
import type { Settings } from '@/lib/edgevision/types';
import { PageHeader, SectionCard } from './shared/cards';
import { ErrorView, LoadingView } from './shared/state-views';
import { btn } from './shared/styles';

export function ViewSettings() {
  const { toast } = useToast();
  const fmt = useFmt();
  const settings = usePolling(() => api.settings(), { intervalMs: 30000 });
  const health = usePolling(() => api.health(), { intervalMs: 10000 });

  const prefs = useDisplayPrefs();
  useEffect(() => {
    prefs.hydrate();
  }, [prefs]);

  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data && form === null) {
      setForm({
        defaultGridCols: settings.data.defaultGridCols,
        defaultGridRows: settings.data.defaultGridRows,
        defaultQueueCapacity: settings.data.defaultQueueCapacity,
        defaultEmitStride: settings.data.defaultEmitStride,
      });
    }
  }, [settings.data, form]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const saved = await api.patchSettings(form);
      setForm({ ...saved });
      toast({ title: 'تنظیمات ذخیره شد', description: 'پیش‌فرض‌های موتور به‌روزرسانی شدند.' });
      settings.refresh();
    } catch (err) {
      toast({ title: 'ذخیره نشد', description: errMessageFa(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (settings.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="تنظیمات" description="پیش‌فرض‌های موتور و ترجیحات نمایش" />
        <LoadingView />
      </div>
    );
  }

  if (!settings.data && settings.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="تنظیمات" />
        <ErrorView message={settings.error} onRetry={settings.refresh} />
      </div>
    );
  }

  const dirty =
    form !== null &&
    settings.data !== null &&
    (form.defaultGridCols !== settings.data.defaultGridCols ||
      form.defaultGridRows !== settings.data.defaultGridRows ||
      form.defaultQueueCapacity !== settings.data.defaultQueueCapacity ||
      form.defaultEmitStride !== settings.data.defaultEmitStride);

  return (
    <div className="space-y-6">
      <PageHeader title="تنظیمات" description="پیش‌فرض‌های موتور و ترجیحات نمایش" />

      <SectionCard
        title="پیش‌فرض‌های موتور"
        description="برای استریم‌های جدید به کار می‌روند؛ استریم‌های موجود تغییری نمی‌کنند."
        action={
          <div className="flex items-center gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  settings.data &&
                  setForm({
                    defaultGridCols: settings.data.defaultGridCols,
                    defaultGridRows: settings.data.defaultGridRows,
                    defaultQueueCapacity: settings.data.defaultQueueCapacity,
                    defaultEmitStride: settings.data.defaultEmitStride,
                  })
                }
                className={`min-h-11 ${btn.ghost}`}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                بازگردانی
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={saving || !dirty} className={`min-h-11 ${btn.primary}`}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              ذخیره
            </Button>
          </div>
        }
      >
        {form && (
          <div className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="set-cols" className="text-zinc-300">ستون‌های شبکهٔ استنتاج</Label>
                  <span className="tnum text-sm text-emerald-400">{fmt.num(form.defaultGridCols)}</span>
                </div>
                <Slider
                  id="set-cols"
                  min={16}
                  max={80}
                  step={1}
                  value={[form.defaultGridCols]}
                  onValueChange={([v]) => setForm((f) => (f ? { ...f, defaultGridCols: v } : f))}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="set-rows" className="text-zinc-300">ردیف‌های شبکهٔ استنتاج</Label>
                  <span className="tnum text-sm text-emerald-400">{fmt.num(form.defaultGridRows)}</span>
                </div>
                <Slider
                  id="set-rows"
                  min={9}
                  max={48}
                  step={1}
                  value={[form.defaultGridRows]}
                  onValueChange={([v]) => setForm((f) => (f ? { ...f, defaultGridRows: v } : f))}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="set-queue" className="text-zinc-300">ظرفیت پیش‌فرض صف فریم</Label>
                  <span className="tnum text-sm text-emerald-400">{fmt.num(form.defaultQueueCapacity)}</span>
                </div>
                <Slider
                  id="set-queue"
                  min={5}
                  max={200}
                  step={1}
                  value={[form.defaultQueueCapacity]}
                  onValueChange={([v]) => setForm((f) => (f ? { ...f, defaultQueueCapacity: v } : f))}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="set-stride" className="text-zinc-300">گام ارسال فریم</Label>
                  <span className="tnum text-sm text-emerald-400">{fmt.num(form.defaultEmitStride)}</span>
                </div>
                <Slider
                  id="set-stride"
                  min={1}
                  max={10}
                  step={1}
                  value={[form.defaultEmitStride]}
                  onValueChange={([v]) => setForm((f) => (f ? { ...f, defaultEmitStride: v } : f))}
                />
              </div>
            </div>
            <p className="text-xs leading-6 text-zinc-500">
              هر استریم می‌تواند در گفت‌وگوی افزودن، مقدارهای خودش را داشته باشد؛ این مقادیر فقط نقطهٔ شروع پیش‌فرض‌اند.
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="نمایش"
        description="این ترجیحات فقط در همین مرورگر ذخیره می‌شوند."
      >
        <div className="space-y-4">
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-sm text-zinc-300">
            <span>
              اعداد فارسی
              <span className="mt-0.5 block text-xs text-zinc-500">
                نمایش ارقام سنجه‌ها با ارقام فارسی یا لاتین
              </span>
            </span>
            <Switch
              checked={prefs.faDigits}
              onCheckedChange={prefs.setFaDigits}
              aria-label="اعداد فارسی"
            />
          </label>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-sm text-zinc-300">
            <span>
              چیدمان فشرده
              <span className="mt-0.5 block text-xs text-zinc-500">
                کاهش فاصله‌ها برای نمایش اطلاعات بیشتر در صفحه
              </span>
            </span>
            <Switch
              checked={prefs.compact}
              onCheckedChange={prefs.setCompact}
              aria-label="چیدمان فشرده"
            />
          </label>
          <p className="text-xs text-zinc-600">
            نمونه: {prefs.faDigits ? '۱۲٬۳۴۵ فریم' : '12,345 فریم'} · {prefs.faDigits ? '٪۸۷' : '87%'}
          </p>
        </div>
      </SectionCard>

      <SectionCard title="دربارهٔ EdgeVision">
        <div className="space-y-4 text-sm leading-7 text-zinc-400">
          <p>
            <span className="font-medium text-zinc-200">EdgeVision</span> پلتفرم تحلیل ویدئوی بلادرنگ است؛
            موتور پردازش آن به‌صورت بومی با ++C نوشته شده، فریم‌ها را می‌گیرد، اشیا را تشخیص می‌دهد و
            مسیر آن‌ها را دنبال می‌کند. یک سرویس بلادرنگ نشست‌ها را مدیریت می‌کند و رویدادها و سنجه‌ها را
            از طریق WebSocket پخش می‌کند؛ REST API هم تاریخچه را برای همین داشبورد و کلاینت موبایل
            نگه می‌دارد.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
            <span>نسخه: {health.data?.version ?? '۱٫۰٫۰'}</span>
            <span>مجوز: Apache-2.0</span>
            <span>© ۲۰۲۶ پارسا فتحی</span>
            {health.data && (
              <span className="tnum">
                زمان فعالیت سرویس: {fmt.dur((health.data.uptimeSec ?? 0) * 1000)}
              </span>
            )}
          </div>
          {health.data && health.data.status === 'degraded' && (
            <Alert className="border-amber-900/50 bg-amber-950/20">
              <Info className="size-4 !text-amber-400" aria-hidden="true" />
              <AlertTitle className="text-sm font-medium text-amber-200">سرویس با افت کیفیت کار می‌کند</AlertTitle>
              <AlertDescription className="text-xs leading-6 text-amber-200/80">
                {health.data.engineBinary
                  ? 'موتور پردازش در دسترس است اما بعضی اجزا پاسخ کامل نمی‌دهند.'
                  : 'سرویس پردازش در دسترس نیست — باینری موتور پیدا نشد.'}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
