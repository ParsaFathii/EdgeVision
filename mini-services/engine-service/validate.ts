// EdgeVision — engine orchestration service
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { SETTINGS_RANGES } from "./settings";

/** Result of a defensive validation pass (errors are Persian, user-facing). */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

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

export interface StreamInput {
  name: string;
  scene: string;
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

export const SCENES = ["STREET", "INTERSECTION", "PARKING"] as const;
export const CLASSES = ["PEDESTRIAN", "VEHICLE", "CYCLIST"] as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function intInRange(
  v: unknown,
  min: number,
  max: number,
  msg: string,
): string | null {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max)
    return msg;
  return null;
}

function numInRange(
  v: unknown,
  min: number,
  max: number,
  msg: string,
): string | null {
  if (!isNum(v) || v < min || v > max) return msg;
  return null;
}

function checkRoi(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) return "ROI باید شیئی با مختصات x، y، w و h باشد";
  const { x, y, w, h } = v;
  for (const c of [x, y, w, h]) {
    if (!isNum(c) || c < 0 || c > 1)
      return "مختصات ROI باید عددی بین 0 و 1 باشد";
  }
  if (!isNum(w) || w <= 0 || !isNum(h) || h <= 0)
    return "عرض و ارتفاع ROI باید بزرگ‌تر از صفر باشد";
  return null;
}

function checkLine(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) return "خط باید شیئی با مختصات x1، y1، x2 و y2 باشد";
  for (const c of [v.x1, v.y1, v.x2, v.y2]) {
    if (!isNum(c) || c < 0 || c > 1)
      return "مختصات خط باید عددی بین 0 و 1 باشد";
  }
  return null;
}

function checkClassFilter(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v))
    return "فیلتر کلاس باید آرایه‌ای از نام کلاس‌ها باشد";
  for (const c of v) {
    if (typeof c !== "string" || !(CLASSES as readonly string[]).includes(c))
      return "فیلتر کلاس فقط می‌تواند شامل PEDESTRIAN، VEHICLE یا CYCLIST باشد";
  }
  return null;
}

/** Field checks shared by create and patch, keyed by request field name. */
type FieldSpec = {
  key: keyof StreamInput;
  required: boolean;
  check: (v: unknown) => string | null;
};

const SPECS: FieldSpec[] = [
  {
    key: "name",
    required: true,
    check: (v) =>
      typeof v !== "string" || v.trim().length < 1 || v.trim().length > 80
        ? "نام استریم باید بین 1 و 80 نویسه باشد"
        : null,
  },
  {
    key: "scene",
    required: true,
    check: (v) =>
      typeof v !== "string" || !(SCENES as readonly string[]).includes(v)
        ? "صحنه باید یکی از STREET، INTERSECTION یا PARKING باشد"
        : null,
  },
  {
    key: "width",
    required: true,
    check: (v) =>
      intInRange(v, 320, 1920, "عرض تصویر باید بین 320 و 1920 باشد"),
  },
  {
    key: "height",
    required: true,
    check: (v) =>
      intInRange(v, 240, 1080, "ارتفاع تصویر باید بین 240 و 1080 باشد"),
  },
  {
    key: "targetFps",
    required: true,
    check: (v) => numInRange(v, 1, 30, "نرخ فریم باید بین 1 و 30 باشد"),
  },
  {
    key: "objectCount",
    required: true,
    check: (v) => intInRange(v, 3, 20, "تعداد اشیا باید بین 3 و 20 باشد"),
  },
  {
    key: "confidenceThreshold",
    required: true,
    check: (v) =>
      numInRange(v, 0.05, 0.95, "آستانه اطمینان باید بین 0.05 و 0.95 باشد"),
  },
  { key: "classFilter", required: false, check: checkClassFilter },
  { key: "roi", required: false, check: checkRoi },
  { key: "line", required: false, check: checkLine },
  {
    key: "queueCapacity",
    required: true,
    check: (v) => intInRange(v, 5, 200, "ظرفیت صف باید بین 5 و 200 باشد"),
  },
  {
    key: "gridCols",
    required: true,
    check: (v) => intInRange(v, 16, 80, "ستون‌های شبکه باید بین 16 و 80 باشد"),
  },
  {
    key: "gridRows",
    required: true,
    check: (v) => intInRange(v, 9, 48, "سطرهای شبکه باید بین 9 و 48 باشد"),
  },
  {
    key: "emitStride",
    required: true,
    check: (v) =>
      intInRange(v, 1, 10, "گام انتشار فریم باید بین 1 و 10 باشد"),
  },
];

function runSpecs(
  body: Record<string, unknown>,
  specs: FieldSpec[],
): { value: Record<string, unknown>; errors: string[] } {
  const value: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const spec of specs) {
    const present = Object.prototype.hasOwnProperty.call(body, spec.key);
    if (!present) {
      if (spec.required) errors.push(`فیلد ${spec.key} الزامی است`);
      continue;
    }
    const err = spec.check(body[spec.key]);
    if (err) {
      errors.push(err);
      continue;
    }
    value[spec.key] = body[spec.key];
  }
  return { value, errors };
}

/** Validate a full stream-creation payload. */
export function validateStreamCreate(
  body: unknown,
): ValidationResult<StreamInput> {
  if (!isObj(body))
    return { ok: false, errors: ["بدنه درخواست باید شیء JSON باشد"] };
  const { value, errors } = runSpecs(body, SPECS);
  if (errors.length) return { ok: false, errors };
  const v = value as Record<string, unknown>;
  return {
    ok: true,
    value: {
      name: String(v.name).trim(),
      scene: String(v.scene),
      width: v.width as number,
      height: v.height as number,
      targetFps: v.targetFps as number,
      objectCount: v.objectCount as number,
      confidenceThreshold: v.confidenceThreshold as number,
      classFilter: Array.isArray(v.classFilter)
        ? [...new Set(v.classFilter as string[])]
        : [],
      roi: (v.roi ?? null) as Roi | null,
      line: (v.line ?? null) as Line | null,
      queueCapacity: v.queueCapacity as number,
      gridCols: v.gridCols as number,
      gridRows: v.gridRows as number,
      emitStride: v.emitStride as number,
    },
  };
}

/** Specs with every field optional (for PATCH merges). */
const PATCH_SPECS: FieldSpec[] = SPECS.map((s) => ({ ...s, required: false }));

/** Validate a partial stream-update payload: only present fields are checked,
 * the rest are inherited from the existing row. */
export function validateStreamPatch(
  body: unknown,
  existing: StreamInput,
): ValidationResult<StreamInput> {
  if (!isObj(body))
    return { ok: false, errors: ["بدنه درخواست باید شیء JSON باشد"] };
  const { value, errors } = runSpecs(body, PATCH_SPECS);
  if (errors.length) return { ok: false, errors };
  const merged: StreamInput = { ...existing };
  const v = value as Record<string, unknown>;
  if (v.name !== undefined) merged.name = String(v.name).trim();
  if (v.scene !== undefined) merged.scene = String(v.scene);
  if (v.width !== undefined) merged.width = v.width as number;
  if (v.height !== undefined) merged.height = v.height as number;
  if (v.targetFps !== undefined) merged.targetFps = v.targetFps as number;
  if (v.objectCount !== undefined) merged.objectCount = v.objectCount as number;
  if (v.confidenceThreshold !== undefined)
    merged.confidenceThreshold = v.confidenceThreshold as number;
  if (v.classFilter !== undefined)
    merged.classFilter = Array.isArray(v.classFilter)
      ? [...new Set(v.classFilter as string[])]
      : [];
  // explicit null clears roi/line
  if (v.roi !== undefined) merged.roi = (v.roi ?? null) as Roi | null;
  if (v.line !== undefined) merged.line = (v.line ?? null) as Line | null;
  if (v.queueCapacity !== undefined)
    merged.queueCapacity = v.queueCapacity as number;
  if (v.gridCols !== undefined) merged.gridCols = v.gridCols as number;
  if (v.gridRows !== undefined) merged.gridRows = v.gridRows as number;
  if (v.emitStride !== undefined) merged.emitStride = v.emitStride as number;
  return { ok: true, value: merged };
}

/** Read a stream row (raw SQL) into the normalised StreamInput shape. */
export function rowToStreamInput(row: Record<string, unknown>): StreamInput {
  let classFilter: string[] = [];
  try {
    const parsed = JSON.parse(String(row.class_filter_json ?? "[]"));
    if (Array.isArray(parsed)) classFilter = parsed as string[];
  } catch {
    classFilter = [];
  }
  const parseObj = (s: unknown): Roi | Line | null => {
    if (typeof s !== "string" || !s) return null;
    try {
      return JSON.parse(s) as Roi | Line;
    } catch {
      return null;
    }
  };
  return {
    name: String(row.name ?? ""),
    scene: String(row.scene ?? "STREET"),
    width: row.width as number,
    height: row.height as number,
    targetFps: row.target_fps as number,
    objectCount: row.object_count as number,
    confidenceThreshold: row.confidence_threshold as number,
    classFilter,
    roi: parseObj(row.roi_json) as Roi | null,
    line: parseObj(row.line_json) as Line | null,
    queueCapacity: row.queue_capacity as number,
    gridCols: row.grid_cols as number,
    gridRows: row.grid_rows as number,
    emitStride: row.emit_stride as number,
  };
}

export interface ModelInput {
  name: string;
  task: string;
  format: string;
  device: string;
  inputShape: string;
  classes: string[];
  sizeBytes: number | null;
  license: string | null;
  description: string | null;
}

/** Validate a model-registration payload (defaults applied for optionals). */
export function validateModelCreate(
  body: unknown,
): ValidationResult<ModelInput> {
  if (!isObj(body))
    return { ok: false, errors: ["بدنه درخواست باید شیء JSON باشد"] };
  const errors: string[] = [];
  const name = body.name;
  if (
    typeof name !== "string" ||
    name.trim().length < 1 ||
    name.trim().length > 80
  )
    errors.push("نام مدل باید بین 1 و 80 نویسه باشد");
  const inputShape = body.inputShape ?? body.input_shape;
  if (
    typeof inputShape !== "string" ||
    inputShape.trim().length < 1 ||
    inputShape.trim().length > 40
  )
    errors.push("شکل ورودی مدل نامعتبر است");
  const classes = body.classesJson ?? body.classes_json ?? body.classes;
  if (!Array.isArray(classes) || classes.length < 1 || classes.length > 20)
    errors.push("لیست کلاس‌ها باید آرایه‌ای بین 1 و 20 عضو باشد");
  else
    for (const c of classes)
      if (typeof c !== "string" || c.trim().length < 1 || c.length > 40)
        errors.push("نام کلاس‌ها باید رشته‌ای بین 1 و 40 نویسه باشد");
  let sizeBytes: number | null = null;
  if (body.sizeBytes !== undefined && body.sizeBytes !== null) {
    if (
      !Number.isInteger(body.sizeBytes) ||
      (body.sizeBytes as number) < 0
    )
      errors.push("حجم مدل باید عدد صحیح نامنفی باشد");
    else sizeBytes = body.sizeBytes as number;
  }
  const strField = (
    key: string,
    max: number,
    def: string | null,
  ): string | null | undefined => {
    const v = body[key];
    if (v === undefined || v === null) return def;
    if (typeof v !== "string" || v.length > max) {
      errors.push(`مقدار فیلد ${key} نامعتبر است`);
      return undefined;
    }
    return v;
  };
  const task = strField("task", 40, "OBJECT_DETECTION");
  const format = strField("format", 40, "ONNX");
  const device = strField("device", 40, "CPU");
  const license = strField("license", 100, null);
  const description = strField("description", 300, null);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: (name as string).trim(),
      task: (task ?? "OBJECT_DETECTION") as string,
      format: (format ?? "ONNX") as string,
      device: (device ?? "CPU") as string,
      inputShape: (inputShape as string).trim(),
      classes: (classes as string[]).map((c) => c.trim()),
      sizeBytes,
      license: (license ?? null) as string | null,
      description: (description ?? null) as string | null,
    },
  };
}

/** Validate {isActive: boolean} for model activation. */
export function validateModelActivate(
  body: unknown,
): ValidationResult<{ isActive: boolean }> {
  if (!isObj(body))
    return { ok: false, errors: ["بدنه درخواست باید شیء JSON باشد"] };
  if (typeof body.isActive !== "boolean")
    return { ok: false, errors: ["فیلد isActive باید از نوع بولی باشد"] };
  return { ok: true, value: { isActive: body.isActive } };
}

/** Validate a settings PATCH payload against the frozen ranges. */
export function validateSettingsPatch(
  body: unknown,
): ValidationResult<
  Partial<
    Pick<
      ServiceSettingsMutable,
      "defaultGridCols" | "defaultGridRows" | "defaultQueueCapacity" | "defaultEmitStride"
    >
  >
> {
  if (!isObj(body))
    return { ok: false, errors: ["بدنه درخواست باید شیء JSON باشد"] };
  const errors: string[] = [];
  const out: Record<string, number> = {};
  const labels: Record<string, string> = {
    defaultGridCols: "ستون‌های شبکه باید بین 16 و 80 باشد",
    defaultGridRows: "سطرهای شبکه باید بین 9 و 48 باشد",
    defaultQueueCapacity: "ظرفیت صف باید بین 5 و 200 باشد",
    defaultEmitStride: "گام انتشار فریم باید بین 1 و 10 باشد",
  };
  for (const key of Object.keys(SETTINGS_RANGES) as (keyof typeof SETTINGS_RANGES)[]) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const range = SETTINGS_RANGES[key];
    const v = body[key];
    if (
      !Number.isInteger(v) ||
      (v as number) < range.min ||
      (v as number) > range.max
    ) {
      errors.push(labels[key]);
      continue;
    }
    out[key] = v as number;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out };
}

type ServiceSettingsMutable = {
  defaultGridCols: number;
  defaultGridRows: number;
  defaultQueueCapacity: number;
  defaultEmitStride: number;
};
