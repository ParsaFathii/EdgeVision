// EdgeVision — engine orchestration service
// Copyright © 2026 Parsa Fathi — Apache-2.0

import type { Database } from "bun:sqlite";
import { isoNow } from "./db";

/**
 * Idempotently seed the model registry (INSERT OR IGNORE on the primary
 * key, which equals the model name so reboots never duplicate rows).
 */
export function seedModels(db: Database): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO models
       (id, name, task, format, device, input_shape, classes_json,
        size_bytes, license, description, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = isoNow();
  const classes = JSON.stringify(["PEDESTRIAN", "VEHICLE", "CYCLIST"]);
  stmt.run(
    "edgevision-detect-s",
    "edgevision-detect-s",
    "OBJECT_DETECTION",
    "ONNX",
    "CPU",
    "1x3x416x416",
    classes,
    7_580_000,
    "Apache-2.0",
    "مدل سبک تشخیص اشیا برای پردازنده — چیدمان YOLOv8",
    1,
    now,
    now,
  );
  stmt.run(
    "edgevision-detect-m",
    "edgevision-detect-m",
    "OBJECT_DETECTION",
    "ONNX",
    "CPU",
    "1x3x640x640",
    classes,
    25_900_000,
    "Apache-2.0",
    "مدل متوسط با دقت بالاتر برای پردازنده",
    0,
    now,
    now,
  );
}
