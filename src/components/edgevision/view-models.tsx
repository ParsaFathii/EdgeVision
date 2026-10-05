// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// مدل‌ها — رجیستری تنظیمات مدل‌های نصب‌شده + فعال‌سازی و ثبت مدل.

'use client';

import { useEffect, useState } from 'react';
import { Boxes, Info, Loader2, Plus } from 'lucide-react';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useFmt } from '@/hooks/edgevision/use-num';
import { usePolling } from '@/hooks/edgevision/use-polling';
import { api, errMessageFa } from '@/lib/edgevision/api';
import type { Model } from '@/lib/edgevision/types';
import { ClassChip } from './shared/badges';
import { Lift, PageHeader } from './shared/cards';
import { EmptyState, ErrorView, LoadingView } from './shared/state-views';
import { btn } from './shared/styles';

const TASK_FA: Record<string, string> = {
  detection: 'تشخیص اشیا',
  tracking: 'ردیابی',
  classification: 'دسته‌بندی',
  segmentation: 'بخش‌بندی',
};

const DEVICE_FA: Record<string, string> = {
  CPU: 'پردازنده',
  GPU: 'کارت گرافیک',
  NPU: 'پردازندهٔ عصبی',
};

const CLASSES = ['PEDESTRIAN', 'VEHICLE', 'CYCLIST'];

const modelSchema = z.object({
  name: z.string().trim().min(2, 'نام مدل باید حداقل ۲ نویسه باشد').max(64, 'نام مدل حداکثر ۶۴ نویسه است'),
  task: z.string().min(1, 'نوع وظیفه را انتخاب کنید'),
  format: z.string().min(1, 'قالب مدل را انتخاب کنید'),
  device: z.string().min(1, 'دستگاه هدف را انتخاب کنید'),
  inputShape: z
    .string()
    .trim()
    .min(3, 'شکل ورودی را وارد کنید')
    .regex(/^[0-9xX×,\s]+$/, 'شکل ورودی فقط عدد و x و کاما می‌پذیرد'),
  classes: z.array(z.string()).min(1, 'حداقل یک دسته را انتخاب کنید'),
  sizeBytes: z
    .number({ error: 'حجم فایل را به بایت وارد کنید' })
    .int('حجم فایل باید عدد صحیح باشد')
    .min(1, 'حجم فایل باید مثبت باشد')
    .max(50_000_000_000, 'حجم فایل بیش از حد مجاز است'),
  license: z.string().min(1, 'مجوز را انتخاب کنید'),
  description: z.string().trim().max(300, 'توضیحات حداکثر ۳۰۰ نویسه است'),
});

interface ModelForm {
  name: string;
  task: string;
  format: string;
  device: string;
  inputShape: string;
  classes: string[];
  sizeBytes: string;
  license: string;
  description: string;
}

const EMPTY_FORM: ModelForm = {
  name: '',
  task: 'detection',
  format: 'ONNX',
  device: 'CPU',
  inputShape: '1x3x640x640',
  classes: ['PEDESTRIAN', 'VEHICLE', 'CYCLIST'],
  sizeBytes: '',
  license: 'Apache-2.0',
  description: '',
};

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs leading-5 text-rose-400">{msg}</p>;
}

export function ViewModels() {
  const { toast } = useToast();
  const fmt = useFmt();
  const models = usePolling(() => api.models(), { intervalMs: 15000 });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ModelForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    if (dialogOpen) {
      setForm(EMPTY_FORM);
      setErrors({});
    }
  }, [dialogOpen]);

  const toggleActive = async (m: Model, next: boolean) => {
    setTogglingId(m.id);
    try {
      await api.patchModel(m.id, { isActive: next });
      toast({
        title: next ? 'مدل فعال شد' : 'مدل غیرفعال شد',
        description: `وضعیت «${m.name}» به‌روزرسانی شد.`,
      });
      models.refresh();
    } catch (err) {
      toast({ title: 'تغییر وضعیت ممکن نشد', description: errMessageFa(err), variant: 'destructive' });
      models.refresh();
    } finally {
      setTogglingId(null);
    }
  };

  const submit = async () => {
    const size = Number(form.sizeBytes.trim());
    const parsed = modelSchema.safeParse({
      name: form.name,
      task: form.task,
      format: form.format,
      device: form.device,
      inputShape: form.inputShape,
      classes: form.classes,
      sizeBytes: Number.isFinite(size) && form.sizeBytes.trim() !== '' ? size : NaN,
      license: form.license,
      description: form.description,
    });
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.length > 0 ? String(issue.path[0]) : '_';
        if (!map[key]) map[key] = issue.message;
      }
      setErrors(map);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const created = await api.createModel(parsed.data);
      toast({ title: 'مدل ثبت شد', description: `«${created.name}» به رجیستری اضافه شد.` });
      setDialogOpen(false);
      models.refresh();
    } catch (err) {
      toast({ title: 'ثبت مدل ممکن نشد', description: errMessageFa(err), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (models.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="مدل‌ها" description="رجیستری مدل‌های استنتاج نصب‌شده" />
        <LoadingView />
      </div>
    );
  }

  if (!models.data && models.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="مدل‌ها" />
        <ErrorView message={models.error} onRetry={models.refresh} />
      </div>
    );
  }

  const items = models.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="مدل‌ها"
        description="رجیستری مدل‌های استنتاج نصب‌شده"
        actions={
          <Button onClick={() => setDialogOpen(true)} className={`min-h-11 ${btn.primary}`}>
            <Plus className="size-4" aria-hidden="true" />
            ثبت مدل
          </Button>
        }
      />

      <Alert className="border-amber-900/50 bg-amber-950/20 text-amber-200">
        <Info className="size-4 !text-amber-400" aria-hidden="true" />
        <AlertTitle className="text-sm font-medium text-amber-200">یادداشت صادقانه</AlertTitle>
        <AlertDescription className="text-sm leading-6 text-amber-200/80">
          فایل‌های وزن مدل‌ها در بسته توزیع نمی‌شوند؛ این رجیستری فقط تنظیمات مدل‌های نصب‌شده را نگه می‌دارد.
        </AlertDescription>
      </Alert>

      {items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="هنوز مدلی ثبت نشده است"
          description="اگر موتور با مدل پیش‌فرض کار می‌کند، مشخصاتش را این‌جا ثبت کنید تا در رجیستری دیده شود."
          action={
            <Button onClick={() => setDialogOpen(true)} className={`min-h-11 ${btn.primary}`}>
              <Plus className="size-4" aria-hidden="true" />
              ثبت مدل
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((m) => (
            <Lift key={m.id} className="h-full">
              <Card className="flex h-full flex-col border-zinc-800 bg-zinc-900/70 transition-colors hover:border-zinc-700">
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate font-medium text-zinc-100">{m.name}</h3>
                    <label className="flex shrink-0 items-center gap-2 text-xs text-zinc-400">
                      {togglingId === m.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Switch
                          checked={m.isActive}
                          onCheckedChange={(v) => toggleActive(m, v)}
                          aria-label={`فعال‌سازی ${m.name}`}
                        />
                      )}
                      فعال
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 text-xs text-zinc-300">
                      {TASK_FA[m.task] ?? m.task}
                    </span>
                    <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 font-mono text-xs text-zinc-300" dir="ltr">
                      {m.format}
                    </span>
                    <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 text-xs text-zinc-300">
                      {DEVICE_FA[m.device] ?? m.device}
                    </span>
                    <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 text-xs text-zinc-400">{m.license}</span>
                  </div>

                  <div className="space-y-1 text-xs text-zinc-500">
                    <p>
                      شکل ورودی:{' '}
                      <span className="tnum font-mono text-zinc-300" dir="ltr">{m.inputShape}</span>
                    </p>
                    <p className="tnum">حجم: <span className="text-zinc-300">{fmt.bytes(m.sizeBytes)}</span></p>
                    <p className="flex flex-wrap items-center gap-1">
                      دسته‌ها:
                      {m.classes.length > 0 ? (
                        m.classes.map((c) => <ClassChip key={c} label={c} />)
                      ) : (
                        <span className="text-zinc-600">ثبت نشده</span>
                      )}
                    </p>
                  </div>

                  {m.description && (
                    <p className="thin-scroll max-h-24 overflow-y-auto text-sm leading-6 text-zinc-400">
                      {m.description}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Lift>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="thin-scroll max-h-[92vh] overflow-y-auto border-zinc-800 bg-zinc-950 sm:max-w-lg">
          <DialogHeader className="text-start">
            <DialogTitle className="text-zinc-50">ثبت مدل</DialogTitle>
            <DialogDescription className="text-zinc-500">
              مشخصات مدل نصب‌شده را وارد کنید. فایل وزن آپلود نمی‌شود.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="model-name" className="text-zinc-300">نام مدل</Label>
              <Input
                id="model-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثلاً: yolo11n"
                className="bg-zinc-900 text-zinc-100"
              />
              <FieldError msg={errors.name} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">وظیفه</Label>
              <Select value={form.task} onValueChange={(v) => setForm((f) => ({ ...f, task: v }))} dir="rtl">
                <SelectTrigger className="w-full bg-zinc-900 text-zinc-100"><SelectValue /></SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                  {Object.entries(TASK_FA).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError msg={errors.task} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">قالب</Label>
              <Select value={form.format} onValueChange={(v) => setForm((f) => ({ ...f, format: v }))} dir="rtl">
                <SelectTrigger className="w-full bg-zinc-900 text-zinc-100"><SelectValue /></SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                  {['ONNX', 'TensorRT', 'OpenVINO'].map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError msg={errors.format} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">دستگاه هدف</Label>
              <Select value={form.device} onValueChange={(v) => setForm((f) => ({ ...f, device: v }))} dir="rtl">
                <SelectTrigger className="w-full bg-zinc-900 text-zinc-100"><SelectValue /></SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                  {Object.entries(DEVICE_FA).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError msg={errors.device} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">مجوز</Label>
              <Select value={form.license} onValueChange={(v) => setForm((f) => ({ ...f, license: v }))} dir="rtl">
                <SelectTrigger className="w-full bg-zinc-900 text-zinc-100"><SelectValue /></SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                  {['Apache-2.0', 'MIT', 'BSD-3-Clause', 'GPL-3.0', 'AGPL-3.0', 'proprietary'].map((v) => (
                    <SelectItem key={v} value={v}>{v === 'proprietary' ? 'اختصاصی' : v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError msg={errors.license} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="model-shape" className="text-zinc-300">شکل ورودی</Label>
              <Input
                id="model-shape"
                dir="ltr"
                className="bg-zinc-900 font-mono text-zinc-100"
                value={form.inputShape}
                onChange={(e) => setForm((f) => ({ ...f, inputShape: e.target.value }))}
                placeholder="1x3x640x640"
              />
              <FieldError msg={errors.inputShape} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="model-size" className="text-zinc-300">حجم فایل (بایت)</Label>
              <Input
                id="model-size"
                type="number"
                dir="ltr"
                className="bg-zinc-900 text-zinc-100"
                value={form.sizeBytes}
                onChange={(e) => setForm((f) => ({ ...f, sizeBytes: e.target.value }))}
                placeholder="مثلاً 5600000"
              />
              <p className="tnum text-[11px] text-zinc-500">
                {form.sizeBytes.trim() !== '' && Number.isFinite(Number(form.sizeBytes))
                  ? `≈ ${fmt.bytes(Number(form.sizeBytes))}`
                  : 'معادل مگابایت خودکار نمایش داده می‌شود'}
              </p>
              <FieldError msg={errors.sizeBytes} />
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-300">دسته‌ها</Label>
              <div className="flex flex-wrap gap-4">
                {CLASSES.map((c) => (
                  <label key={c} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-zinc-300">
                    <Checkbox
                      checked={form.classes.includes(c)}
                      onCheckedChange={() =>
                        setForm((f) => ({
                          ...f,
                          classes: f.classes.includes(c)
                            ? f.classes.filter((x) => x !== c)
                            : [...f.classes, c],
                        }))
                      }
                      aria-label={c === 'PEDESTRIAN' ? 'عابر پیاده' : c === 'VEHICLE' ? 'خودرو' : 'دوچرخه‌سوار'}
                    />
                    {c === 'PEDESTRIAN' ? 'عابر پیاده' : c === 'VEHICLE' ? 'خودرو' : 'دوچرخه‌سوار'}
                  </label>
                ))}
              </div>
              <FieldError msg={errors.classes} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="model-desc" className="text-zinc-300">توضیحات</Label>
              <Textarea
                id="model-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="توضیح کوتاه دربارهٔ مدل، منبع یا نحوهٔ نصب…"
                className="min-h-20 bg-zinc-900 text-zinc-100"
              />
              <FieldError msg={errors.description} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)} className={`min-h-11 ${btn.ghost}`}>
              انصراف
            </Button>
            <Button onClick={submit} disabled={submitting} className={`min-h-11 ${btn.primary}`}>
              {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              ثبت مدل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
