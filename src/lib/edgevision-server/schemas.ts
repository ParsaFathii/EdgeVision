// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { z } from "zod";

/**
 * Zod schemas mirroring the engine-service validation rules (Persian
 * messages; the service re-validates as the source of truth).
 */

export const EVENT_TYPES = [
  "LINE_CROSS",
  "ROI_ENTER",
  "ROI_EXIT",
  "SESSION_END",
  "ERROR",
  "STATE_CHANGE",
] as const;

export const sceneSchema = z.enum(
  ["STREET", "INTERSECTION", "PARKING"],
  "صحنه باید یکی از STREET، INTERSECTION یا PARKING باشد",
);

const classSchema = z.enum(
  ["PEDESTRIAN", "VEHICLE", "CYCLIST"],
  "فیلتر کلاس فقط می‌تواند شامل PEDESTRIAN، VEHICLE یا CYCLIST باشد",
);

const unitCoord = (msg: string) =>
  z.number(msg).min(0, msg).max(1, msg);

export const roiSchema = z
  .object({
    x: unitCoord("مختصات ROI باید عددی بین 0 و 1 باشد"),
    y: unitCoord("مختصات ROI باید عددی بین 0 و 1 باشد"),
    w: z
      .number("مختصات ROI باید عددی بین 0 و 1 باشد")
      .min(0, "مختصات ROI باید عددی بین 0 و 1 باشد")
      .max(1, "مختصات ROI باید عددی بین 0 و 1 باشد")
      .refine((v) => v > 0, "عرض و ارتفاع ROI باید بزرگ‌تر از صفر باشد"),
    h: z
      .number("مختصات ROI باید عددی بین 0 و 1 باشد")
      .min(0, "مختصات ROI باید عددی بین 0 و 1 باشد")
      .max(1, "مختصات ROI باید عددی بین 0 و 1 باشد")
      .refine((v) => v > 0, "عرض و ارتفاع ROI باید بزرگ‌تر از صفر باشد"),
  })
  .nullable();

export const lineSchema = z
  .object({
    x1: unitCoord("مختصات خط باید عددی بین 0 و 1 باشد"),
    y1: unitCoord("مختصات خط باید عددی بین 0 و 1 باشد"),
    x2: unitCoord("مختصات خط باید عددی بین 0 و 1 باشد"),
    y2: unitCoord("مختصات خط باید عددی بین 0 و 1 باشد"),
  })
  .nullable();

/** Base schema WITHOUT the classFilter default (defaults would leak into
 *  PATCH payloads and wipe stored values). */
const streamBaseSchema = z.object({
  name: z
    .string("نام استریم باید رشته باشد")
    .trim()
    .min(1, "نام استریم باید بین 1 و 80 نویسه باشد")
    .max(80, "نام استریم باید بین 1 و 80 نویسه باشد"),
  scene: sceneSchema,
  width: z
    .number("عرض تصویر باید عدد باشد")
    .int("عرض تصویر باید عدد صحیح باشد")
    .min(320, "عرض تصویر باید بین 320 و 1920 باشد")
    .max(1920, "عرض تصویر باید بین 320 و 1920 باشد"),
  height: z
    .number("ارتفاع تصویر باید عدد باشد")
    .int("ارتفاع تصویر باید عدد صحیح باشد")
    .min(240, "ارتفاع تصویر باید بین 240 و 1080 باشد")
    .max(1080, "ارتفاع تصویر باید بین 240 و 1080 باشد"),
  targetFps: z
    .number("نرخ فریم باید عدد باشد")
    .min(1, "نرخ فریم باید بین 1 و 30 باشد")
    .max(30, "نرخ فریم باید بین 1 و 30 باشد"),
  objectCount: z
    .number("تعداد اشیا باید عدد باشد")
    .int("تعداد اشیا باید عدد صحیح باشد")
    .min(3, "تعداد اشیا باید بین 3 و 20 باشد")
    .max(20, "تعداد اشیا باید بین 3 و 20 باشد"),
  confidenceThreshold: z
    .number("آستانه اطمینان باید عدد باشد")
    .min(0.05, "آستانه اطمینان باید بین 0.05 و 0.95 باشد")
    .max(0.95, "آستانه اطمینان باید بین 0.05 و 0.95 باشد"),
  classFilter: z.array(classSchema),
  roi: roiSchema.optional(),
  line: lineSchema.optional(),
  queueCapacity: z
    .number("ظرفیت صف باید عدد باشد")
    .int("ظرفیت صف باید عدد صحیح باشد")
    .min(5, "ظرفیت صف باید بین 5 و 200 باشد")
    .max(200, "ظرفیت صف باید بین 5 و 200 باشد"),
  gridCols: z
    .number("ستون‌های شبکه باید عدد باشد")
    .int("ستون‌های شبکه باید عدد صحیح باشد")
    .min(16, "ستون‌های شبکه باید بین 16 و 80 باشد")
    .max(80, "ستون‌های شبکه باید بین 16 و 80 باشد"),
  gridRows: z
    .number("سطرهای شبکه باید عدد باشد")
    .int("سطرهای شبکه باید عدد صحیح باشد")
    .min(9, "سطرهای شبکه باید بین 9 و 48 باشد")
    .max(48, "سطرهای شبکه باید بین 9 و 48 باشد"),
  emitStride: z
    .number("گام انتشار فریم باید عدد باشد")
    .int("گام انتشار فریم باید عدد صحیح باشد")
    .min(1, "گام انتشار فریم باید بین 1 و 10 باشد")
    .max(10, "گام انتشار فریم باید بین 1 و 10 باشد"),
});

export const streamCreateSchema = streamBaseSchema.extend({
  classFilter: z.array(classSchema).default([]),
});

export const streamPatchSchema = streamBaseSchema.partial();

export const modelCreateSchema = z.object({
  name: z
    .string("نام مدل باید رشته باشد")
    .trim()
    .min(1, "نام مدل باید بین 1 و 80 نویسه باشد")
    .max(80, "نام مدل باید بین 1 و 80 نویسه باشد"),
  task: z.string("مقدار فیلد task نامعتبر است").max(40, "مقدار فیلد task نامعتبر است").optional(),
  format: z.string("مقدار فیلد format نامعتبر است").max(40, "مقدار فیلد format نامعتبر است").optional(),
  device: z.string("مقدار فیلد device نامعتبر است").max(40, "مقدار فیلد device نامعتبر است").optional(),
  inputShape: z
    .string("شکل ورودی مدل نامعتبر است")
    .trim()
    .min(1, "شکل ورودی مدل نامعتبر است")
    .max(40, "شکل ورودی مدل نامعتبر است"),
  classesJson: z
    .array(
      z.string("نام کلاس‌ها باید رشته‌ای بین 1 و 40 نویسه باشد").min(1, "نام کلاس‌ها باید رشته‌ای بین 1 و 40 نویسه باشد").max(40, "نام کلاس‌ها باید رشته‌ای بین 1 و 40 نویسه باشد"),
    )
    .min(1, "لیست کلاس‌ها باید آرایه‌ای بین 1 و 20 عضو باشد")
    .max(20, "لیست کلاس‌ها باید آرایه‌ای بین 1 و 20 عضو باشد"),
  sizeBytes: z
    .number("حجم مدل باید عدد صحیح نامنفی باشد")
    .int("حجم مدل باید عدد صحیح نامنفی باشد")
    .min(0, "حجم مدل باید عدد صحیح نامنفی باشد")
    .optional(),
  license: z.string("مقدار فیلد license نامعتبر است").max(100, "مقدار فیلد license نامعتبر است").optional(),
  description: z.string("مقدار فیلد description نامعتبر است").max(300, "مقدار فیلد description نامعتبر است").optional(),
});

export const modelActivateSchema = z.object({
  isActive: z.boolean("فیلد isActive باید از نوع بولی باشد"),
});

export const settingsPatchSchema = z.object({
  defaultGridCols: z
    .number("ستون‌های شبکه باید بین 16 و 80 باشد")
    .int("ستون‌های شبکه باید بین 16 و 80 باشد")
    .min(16, "ستون‌های شبکه باید بین 16 و 80 باشد")
    .max(80, "ستون‌های شبکه باید بین 16 و 80 باشد")
    .optional(),
  defaultGridRows: z
    .number("سطرهای شبکه باید بین 9 و 48 باشد")
    .int("سطرهای شبکه باید بین 9 و 48 باشد")
    .min(9, "سطرهای شبکه باید بین 9 و 48 باشد")
    .max(48, "سطرهای شبکه باید بین 9 و 48 باشد")
    .optional(),
  defaultQueueCapacity: z
    .number("ظرفیت صف باید بین 5 و 200 باشد")
    .int("ظرفیت صف باید بین 5 و 200 باشد")
    .min(5, "ظرفیت صف باید بین 5 و 200 باشد")
    .max(200, "ظرفیت صف باید بین 5 و 200 باشد")
    .optional(),
  defaultEmitStride: z
    .number("گام انتشار فریم باید بین 1 و 10 باشد")
    .int("گام انتشار فریم باید بین 1 و 10 باشد")
    .min(1, "گام انتشار فریم باید بین 1 و 10 باشد")
    .max(10, "گام انتشار فریم باید بین 1 و 10 باشد")
    .optional(),
});

/**
 * Convert zod issues into Persian detail strings: custom messages are kept
 * verbatim; generic type errors become «فیلد … الزامی است» /
 * «مقدار فیلد … نامعتبر است».
 */
export function zodDetails(error: z.ZodError, raw: unknown): string[] {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    const generic =
      issue.message.startsWith("Invalid input") ||
      issue.message.includes("received") ||
      issue.message.startsWith("Invalid enum value");
    if (!generic) return issue.message;
    const value = path ? obj[path] : undefined;
    if (value === undefined) return `فیلد ${path || "?"} الزامی است`;
    return `مقدار فیلد ${path || "?"} نامعتبر است`;
  });
}

/**
 * Parse a time query parameter that may be ISO-8601 or epoch milliseconds.
 * Returns null when absent and "invalid" when unparseable.
 */
export function parseTimeParam(
  value: string | null,
): Date | null | "invalid" {
  if (value === null || value.trim() === "") return null;
  const v = value.trim();
  if (/^\d{10,}$/.test(v)) return new Date(Number(v));
  if (/^\d{1,9}$/.test(v)) return new Date(Number(v) * 1000);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d;
}
