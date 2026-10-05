// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// گفت‌وگوی افزودن/ویرایش استریم — همهٔ فیلدها + پیش‌نمایش زندهٔ ناحیهٔ پایش و خط عبور.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronsDownUp, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { api, errMessageFa } from '@/lib/edgevision/api';
import type { Roi, SceneKind, Settings, Stream, StreamInput } from '@/lib/edgevision/types';
import { useFmt } from '@/hooks/edgevision/use-num';
import { btn } from './shared/styles';

const CLASSES: { value: string; label: string }[] = [
  { value: 'PEDESTRIAN', label: 'عابر پیاده' },
  { value: 'VEHICLE', label: 'خودرو' },
  { value: 'CYCLIST', label: 'دوچرخه‌سوار' },
];

const SCENES: { value: SceneKind; label: string }[] = [
  { value: 'STREET', label: 'خیابان' },
  { value: 'INTERSECTION', label: 'چهارراه' },
  { value: 'PARKING', label: 'پارکینگ' },
];

const num01 = (label: string) =>
  z
    .number()
    .min(0, `${label} باید بین ۰ و ۱ باشد`)
    .max(1, `${label} باید بین ۰ و ۱ باشد`);

const roiSchema = z
  .object({
    x: num01('مختصات افقی'),
    y: num01('مختصات عمودی'),
    w: z.number().min(0.01, 'عرض ناحیه باید بیش از صفر باشد').max(1),
    h: z.number().min(0.01, 'ارتفاع ناحیه باید بیش از صفر باشد').max(1),
  })
  .refine((r) => r.x + r.w <= 1.001 && r.y + r.h <= 1.001, {
    message: 'ناحیهٔ پایش از کادر تصویر بیرون می‌زند',
    path: ['w'],
  });

const lineSchema = z.object({
  x1: num01('نقطهٔ شروع'),
  y1: num01('نقطهٔ شروع'),
  x2: num01('نقطهٔ پایان'),
  y2: num01('نقطهٔ پایان'),
});

const streamInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'نام استریم نمی‌تواند خالی باشد')
    .max(80, 'نام استریم حداکثر ۸۰ نویسه است'),
  scene: z.enum(['STREET', 'INTERSECTION', 'PARKING'], { error: 'صحنه را انتخاب کنید' }),
  sourceType: z.string().min(1, 'نوع منبع را انتخاب کنید'),
  width: z.number().int().min(320, 'عرض باید بین ۳۲۰ و ۱۹۲۰ باشد').max(1920, 'عرض باید بین ۳۲۰ و ۱۹۲۰ باشد'),
  height: z
    .number()
    .int()
    .min(240, 'ارتفاع باید بین ۲۴۰ و ۱۰۸۰ باشد')
    .max(1080, 'ارتفاع باید بین ۲۴۰ و ۱۰۸۰ باشد'),
  targetFps: z.number().int().min(1, 'نرخ فریم باید بین ۱ و ۳۰ باشد').max(30, 'نرخ فریم باید بین ۱ و ۳۰ باشد'),
  objectCount: z
    .number()
    .int()
    .min(3, 'تعداد اشیا باید بین ۳ و ۲۰ باشد')
    .max(20, 'تعداد اشیا باید بین ۳ و ۲۰ باشد'),
  confidenceThreshold: z
    .number()
    .min(0.05, 'حد آستانهٔ اطمینان باید حداقل ۰٫۰۵ باشد')
    .max(0.95, 'حد آستانهٔ اطمینان حداکثر ۰٫۹۵ است'),
  classFilter: z.array(z.enum(['PEDESTRIAN', 'VEHICLE', 'CYCLIST'])).min(1, 'حداقل یک دسته را انتخاب کنید'),
  roi: roiSchema.nullable(),
  line: lineSchema.nullable(),
  queueCapacity: z.number().int().min(5, 'ظرفیت صف باید بین ۵ و ۲۰۰ باشد').max(200, 'ظرفیت صف باید بین ۵ و ۲۰۰ باشد'),
  gridCols: z
    .number()
    .int()
    .min(16, 'ستون‌های شبکه باید بین ۱۶ و ۸۰ باشد')
    .max(80, 'ستون‌های شبکه باید بین ۱۶ و ۸۰ باشد'),
  gridRows: z
    .number()
    .int()
    .min(9, 'ردیف‌های شبکه باید بین ۹ و ۴۸ باشد')
    .max(48, 'ردیف‌های شبکه باید بین ۹ و ۴۸ باشد'),
  emitStride: z.number().int().min(1, 'گام ارسال باید بین ۱ و ۱۰ باشد').max(10, 'گام ارسال باید بین ۱ و ۱۰ باشد'),
});

interface FormState {
  name: string;
  scene: SceneKind;
  sourceType: string;
  width: string;
  height: string;
  targetFps: string;
  objectCount: string;
  confidenceThreshold: number;
  classFilter: string[];
  roiEnabled: boolean;
  roi: { x: string; y: string; w: string; h: string };
  lineEnabled: boolean;
  line: { x1: string; y1: string; x2: string; y2: string };
  queueCapacity: string;
  gridCols: string;
  gridRows: string;
  emitStride: string;
}

function initialState(stream: Stream | null | undefined, defaults: Settings | null): FormState {
  const roi = stream?.roi ?? null;
  const line = stream?.line ?? null;
  return {
    name: stream?.name ?? '',
    scene: stream?.scene ?? 'STREET',
    sourceType: stream?.sourceType ?? 'SYNTHETIC',
    width: String(stream?.width ?? 640),
    height: String(stream?.height ?? 360),
    targetFps: String(stream?.targetFps ?? 15),
    objectCount: String(stream?.objectCount ?? 8),
    confidenceThreshold: stream?.confidenceThreshold ?? 0.35,
    classFilter: stream?.classFilter?.length ? stream.classFilter : ['PEDESTRIAN', 'VEHICLE', 'CYCLIST'],
    roiEnabled: roi !== null,
    roi: {
      x: String(roi?.x ?? 0.25),
      y: String(roi?.y ?? 0.15),
      w: String(roi?.w ?? 0.5),
      h: String(roi?.h ?? 0.6),
    },
    lineEnabled: line !== null,
    line: {
      x1: String(line?.x1 ?? 0.5),
      y1: String(line?.y1 ?? 0.1),
      x2: String(line?.x2 ?? 0.5),
      y2: String(line?.y2 ?? 0.9),
    },
    queueCapacity: String(stream?.queueCapacity ?? defaults?.defaultQueueCapacity ?? 30),
    gridCols: String(stream?.gridCols ?? defaults?.defaultGridCols ?? 40),
    gridRows: String(stream?.gridRows ?? defaults?.defaultGridRows ?? 24),
    emitStride: String(stream?.emitStride ?? defaults?.defaultEmitStride ?? 2),
  };
}

function parseNum(s: string): number | null {
  const v = Number(s.trim());
  return s.trim() !== '' && Number.isFinite(v) ? v : null;
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs leading-5 text-rose-400">{msg}</p>;
}

/** پیش‌نمایش کوچک ناحیهٔ پایش و خط عبور روی کادر ۶۴۰×۳۶۰. */
function RoiPreview({ form }: { form: FormState }) {
  const roi = form.roiEnabled
    ? {
        x: Math.min(1, Math.max(0, parseNum(form.roi.x) ?? 0)),
        y: Math.min(1, Math.max(0, parseNum(form.roi.y) ?? 0)),
        w: Math.min(1, Math.max(0, parseNum(form.roi.w) ?? 0)),
        h: Math.min(1, Math.max(0, parseNum(form.roi.h) ?? 0)),
      }
    : null;
  const line = form.lineEnabled
    ? {
        x1: Math.min(1, Math.max(0, parseNum(form.line.x1) ?? 0)),
        y1: Math.min(1, Math.max(0, parseNum(form.line.y1) ?? 0)),
        x2: Math.min(1, Math.max(0, parseNum(form.line.x2) ?? 0)),
        y2: Math.min(1, Math.max(0, parseNum(form.line.y2) ?? 0)),
      }
    : null;
  return (
    <svg
      viewBox="0 0 640 360"
      aria-hidden="true"
      className="w-full max-w-[260px] rounded-md border border-zinc-800 bg-[#131316]"
      style={{ display: 'block', aspectRatio: '640 / 360' }}
    >
      <rect x={8} y={8} width={624} height={344} fill="none" stroke="#2b2b32" strokeWidth={2} />
      {roi && (
        <g>
          <rect
            x={roi.x * 640}
            y={roi.y * 360}
            width={roi.w * 640}
            height={roi.h * 360}
            fill="rgba(245,158,11,0.08)"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="8 6"
          />
          <text x={roi.x * 640 + 6} y={roi.y * 360 + 15} fill="#fbbf24" fontSize={12}>
            ناحیهٔ پایش
          </text>
        </g>
      )}
      {line && (
        <g>
          <line
            x1={line.x1 * 640}
            y1={line.y1 * 360}
            x2={line.x2 * 640}
            y2={line.y2 * 360}
            stroke="#2dd4bf"
            strokeWidth={2.5}
            strokeDasharray="10 7"
          />
          <text
            x={(line.x1 + line.x2) * 320}
            y={(line.y1 + line.y2) * 180 - 8}
            fill="#5eead4"
            fontSize={12}
            textAnchor="middle"
          >
            خط عبور
          </text>
        </g>
      )}
    </svg>
  );
}

export interface StreamEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  stream?: Stream | null;
  defaults?: Settings | null;
  onSaved: (stream: Stream) => void;
}

export function StreamEditor({ open, onOpenChange, mode, stream, defaults, onSaved }: StreamEditorProps) {
  const { toast } = useToast();
  const fmt = useFmt();
  const [form, setForm] = useState<FormState>(() => initialState(stream, defaults ?? null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initialState(stream, defaults ?? null));
      setErrors({});
      setAdvanced(false);
    }
  }, [open, stream, defaults]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const toggleClass = (value: string) => {
    setForm((f) => ({
      ...f,
      classFilter: f.classFilter.includes(value)
        ? f.classFilter.filter((c) => c !== value)
        : [...f.classFilter, value],
    }));
  };

  const buildInput = (): StreamInput | { __invalid: Record<string, string> } => {
    const width = parseNum(form.width);
    const height = parseNum(form.height);
    const targetFps = parseNum(form.targetFps);
    const objectCount = parseNum(form.objectCount);
    const queueCapacity = parseNum(form.queueCapacity);
    const gridCols = parseNum(form.gridCols);
    const gridRows = parseNum(form.gridRows);
    const emitStride = parseNum(form.emitStride);

    const manual: Record<string, string> = {};
    const numMap: Record<string, number | null> = {
      width,
      height,
      targetFps,
      objectCount,
      queueCapacity,
      gridCols,
      gridRows,
      emitStride,
    };
    for (const [k, v] of Object.entries(numMap)) {
      if (v === null) manual[k] = 'یک عدد معتبر وارد کنید';
    }

    let roi: Roi | null = null;
    if (form.roiEnabled) {
      const x = parseNum(form.roi.x);
      const y = parseNum(form.roi.y);
      const w = parseNum(form.roi.w);
      const h = parseNum(form.roi.h);
      if (x === null || y === null || w === null || h === null) {
        manual.roi = 'مختصات ناحیهٔ پایش باید عدد باشد';
      } else {
        roi = { x, y, w, h };
      }
    }

    let line: StreamInput['line'] = null;
    if (form.lineEnabled) {
      const x1 = parseNum(form.line.x1);
      const y1 = parseNum(form.line.y1);
      const x2 = parseNum(form.line.x2);
      const y2 = parseNum(form.line.y2);
      if (x1 === null || y1 === null || x2 === null || y2 === null) {
        manual.line = 'مختصات خط عبور باید عدد باشد';
      } else {
        line = { x1, y1, x2, y2 };
      }
    }

    if (Object.keys(manual).length > 0) return { __invalid: manual };

    const parsed = streamInputSchema.safeParse({
      name: form.name,
      scene: form.scene,
      sourceType: form.sourceType,
      width,
      height,
      targetFps,
      objectCount,
      confidenceThreshold: form.confidenceThreshold,
      classFilter: form.classFilter,
      roi,
      line,
      queueCapacity,
      gridCols,
      gridRows,
      emitStride,
    } as StreamInput);

    if (!parsed.success) {
      const zodErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.length > 0 ? String(issue.path[0]) : '_';
        if (!zodErrors[key]) zodErrors[key] = issue.message;
      }
      return { __invalid: zodErrors };
    }
    return parsed.data as StreamInput;
  };

  const handleSubmit = async () => {
    const input = buildInput();
    if ('__invalid' in input) {
      setErrors(input.__invalid);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const saved =
        mode === 'create' ? await api.createStream(input) : await api.patchStream(stream?.id ?? '', input);
      toast({
        title: mode === 'create' ? 'استریم ایجاد شد' : 'تغییرات ذخیره شد',
        description: mode === 'create' ? `استریم «${saved.name}» ثبت شد.` : `تنظیمات «${saved.name}» به‌روزرسانی شد.`,
      });
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: mode === 'create' ? 'استریم ایجاد نشد' : 'ذخیره تغییرات ممکن نشد',
        description: errMessageFa(err),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const numInputCls = 'bg-zinc-900 text-zinc-100';

  const preview = useMemo(() => <RoiPreview form={form} />, [form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="thin-scroll max-h-[92vh] overflow-y-auto border-zinc-800 bg-zinc-950 sm:max-w-2xl">
        <DialogHeader className="text-start">
          <DialogTitle className="text-zinc-50">
            {mode === 'create' ? 'افزودن استریم' : `ویرایش «${stream?.name ?? ''}»`}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            {mode === 'create'
              ? 'منبع ویدئویی جدید با پیکربندی دلخواه ثبت کنید.'
              : 'پیکربندی استریم را تغییر دهید. برای اعمال روی نشست فعال، ابتدا پردازش را متوقف کنید.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="stream-name" className="text-zinc-300">نام استریم</Label>
            <Input
              id="stream-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="مثلاً: دوربین تقاطع ولی‌عصر"
              className="bg-zinc-900 text-zinc-100"
            />
            <FieldError msg={errors.name} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-zinc-300">صحنهٔ شبیه‌سازی</Label>
            <Select value={form.scene} onValueChange={(v) => set('scene', v as SceneKind)} dir="rtl">
              <SelectTrigger className="w-full bg-zinc-900 text-zinc-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                {SCENES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError msg={errors.scene} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-zinc-300">نوع منبع</Label>
            <Select value={form.sourceType} onValueChange={(v) => set('sourceType', v)} dir="rtl">
              <SelectTrigger className="w-full bg-zinc-900 text-zinc-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                <SelectItem value="SYNTHETIC">مصنوعی (شبیه‌سازی‌شده)</SelectItem>
                <SelectItem value="VIDEO">فایل ویدئویی</SelectItem>
              </SelectContent>
            </Select>
            <FieldError msg={errors.sourceType} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="stream-width" className="text-zinc-300">عرض (پیکسل)</Label>
            <Input
              id="stream-width"
              type="number"
              dir="ltr"
              className={numInputCls}
              value={form.width}
              onChange={(e) => set('width', e.target.value)}
            />
            <FieldError msg={errors.width} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="stream-height" className="text-zinc-300">ارتفاع (پیکسل)</Label>
            <Input
              id="stream-height"
              type="number"
              dir="ltr"
              className={numInputCls}
              value={form.height}
              onChange={(e) => set('height', e.target.value)}
            />
            <FieldError msg={errors.height} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="stream-fps" className="text-zinc-300">نرخ فریم هدف</Label>
            <Input
              id="stream-fps"
              type="number"
              dir="ltr"
              className={numInputCls}
              value={form.targetFps}
              onChange={(e) => set('targetFps', e.target.value)}
            />
            <FieldError msg={errors.targetFps} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="stream-objects" className="text-zinc-300">تعداد اشیا در صحنه</Label>
            <Input
              id="stream-objects"
              type="number"
              dir="ltr"
              className={numInputCls}
              value={form.objectCount}
              onChange={(e) => set('objectCount', e.target.value)}
            />
            <FieldError msg={errors.objectCount} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="stream-conf" className="text-zinc-300">حد آستانهٔ اطمینان</Label>
              <span className="tnum text-sm text-emerald-400">{fmt.pct(form.confidenceThreshold, 2)}</span>
            </div>
            <Slider
              id="stream-conf"
              min={0.05}
              max={0.95}
              step={0.05}
              value={[form.confidenceThreshold]}
              onValueChange={([v]) => set('confidenceThreshold', v)}
              className="py-2"
            />
            <FieldError msg={errors.confidenceThreshold} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label className="text-zinc-300">دسته‌های مورد پیگیری</Label>
            <div className="flex flex-wrap gap-4">
              {CLASSES.map((c) => (
                <label key={c.value} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <Checkbox
                    checked={form.classFilter.includes(c.value)}
                    onCheckedChange={() => toggleClass(c.value)}
                    aria-label={c.label}
                  />
                  {c.label}
                </label>
              ))}
            </div>
            <FieldError msg={errors.classFilter} />
          </div>

          <div className="space-y-3 sm:col-span-2 sm:grid sm:grid-cols-2 sm:gap-4">
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <label className="flex min-h-11 items-center justify-between gap-2 text-sm text-zinc-300">
                <span className="flex items-center gap-2">
                  <span className="inline-block size-2 rounded-sm border border-amber-400 bg-amber-500/20" aria-hidden="true" />
                  ناحیهٔ پایش (ROI)
                </span>
                <Switch
                  checked={form.roiEnabled}
                  onCheckedChange={(v) => set('roiEnabled', v)}
                  aria-label="فعال‌سازی ناحیهٔ پایش"
                />
              </label>
              {form.roiEnabled && (
                <div className="grid grid-cols-2 gap-2">
                  {(['x', 'y', 'w', 'h'] as const).map((k) => (
                    <div key={k} className="space-y-1">
                      <Label className="text-xs text-zinc-500">
                        {{ x: 'x', y: 'y', w: 'عرض', h: 'ارتفاع' }[k]}
                      </Label>
                      <Input
                        type="number"
                        dir="ltr"
                        step="0.01"
                        min={0}
                        max={1}
                        className={`${numInputCls} h-8`}
                        value={form.roi[k]}
                        onChange={(e) => set('roi', { ...form.roi, [k]: e.target.value })}
                        aria-label={`مختصات ${k} ناحیهٔ پایش`}
                      />
                    </div>
                  ))}
                  <div className="col-span-2"><FieldError msg={errors.roi} /></div>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <label className="flex min-h-11 items-center justify-between gap-2 text-sm text-zinc-300">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-3 w-0.5 bg-teal-400" aria-hidden="true" />
                  خط عبور
                </span>
                <Switch
                  checked={form.lineEnabled}
                  onCheckedChange={(v) => set('lineEnabled', v)}
                  aria-label="فعال‌سازی خط عبور"
                />
              </label>
              {form.lineEnabled && (
                <div className="grid grid-cols-2 gap-2">
                  {(['x1', 'y1', 'x2', 'y2'] as const).map((k) => (
                    <div key={k} className="space-y-1">
                      <Label className="text-xs text-zinc-500">{k}</Label>
                      <Input
                        type="number"
                        dir="ltr"
                        step="0.01"
                        min={0}
                        max={1}
                        className={`${numInputCls} h-8`}
                        value={form.line[k]}
                        onChange={(e) => set('line', { ...form.line, [k]: e.target.value })}
                        aria-label={`مختصات ${k} خط عبور`}
                      />
                    </div>
                  ))}
                  <div className="col-span-2"><FieldError msg={errors.line} /></div>
                </div>
              )}
            </div>

            <div className="sm:col-span-2">{preview}</div>
          </div>

          <Collapsible open={advanced} onOpenChange={setAdvanced} className="sm:col-span-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className={`min-h-11 w-full justify-between ${btn.ghost}`}>
                <span>تنظیمات پیشرفتهٔ موتور</span>
                <ChevronsDownUp className="size-4" aria-hidden="true" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid grid-cols-2 gap-4 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="stream-queue" className="text-zinc-300">ظرفیت صف فریم</Label>
                <Input
                  id="stream-queue"
                  type="number"
                  dir="ltr"
                  className={numInputCls}
                  value={form.queueCapacity}
                  onChange={(e) => set('queueCapacity', e.target.value)}
                />
                <FieldError msg={errors.queueCapacity} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stream-stride" className="text-zinc-300">گام ارسال فریم</Label>
                <Input
                  id="stream-stride"
                  type="number"
                  dir="ltr"
                  className={numInputCls}
                  value={form.emitStride}
                  onChange={(e) => set('emitStride', e.target.value)}
                />
                <FieldError msg={errors.emitStride} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stream-gridcols" className="text-zinc-300">ستون‌های شبکهٔ استنتاج</Label>
                <Input
                  id="stream-gridcols"
                  type="number"
                  dir="ltr"
                  className={numInputCls}
                  value={form.gridCols}
                  onChange={(e) => set('gridCols', e.target.value)}
                />
                <FieldError msg={errors.gridCols} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stream-gridrows" className="text-zinc-300">ردیف‌های شبکهٔ استنتاج</Label>
                <Input
                  id="stream-gridrows"
                  type="number"
                  dir="ltr"
                  className={numInputCls}
                  value={form.gridRows}
                  onChange={(e) => set('gridRows', e.target.value)}
                />
                <FieldError msg={errors.gridRows} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className={`min-h-11 ${btn.ghost}`}>
            انصراف
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className={`min-h-11 ${btn.primary}`}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {mode === 'create' ? 'ثبت استریم' : 'ذخیرهٔ تغییرات'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
