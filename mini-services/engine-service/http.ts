// EdgeVision — engine orchestration service
// Copyright © 2026 Parsa Fathi — Apache-2.0

import type { Database } from "bun:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { engineBinaryExists, type SessionManager } from "./sessions";
import {
  saveSettings,
  type ServiceSettings,
  SETTINGS_RANGES,
} from "./settings";
import {
  validateModelActivate,
  validateModelCreate,
  validateSettingsPatch,
  validateStreamCreate,
  validateStreamPatch,
  rowToStreamInput,
  type ModelInput,
  type StreamInput,
} from "./validate";
import { isoNow } from "./db";

const INTERNAL_TOKEN =
  process.env.EV_INTERNAL_TOKEN && process.env.EV_INTERNAL_TOKEN.length > 0
    ? process.env.EV_INTERNAL_TOKEN
    : "edgevision-local";

const BODY_LIMIT_BYTES = 256 * 1024;

export interface InternalDeps {
  db: Database;
  manager: SessionManager;
  settings: ServiceSettings;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: string[],
): void {
  sendJson(res, status, details ? { code, message, details } : { code, message });
}

type BodyResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; code: string; message: string };

async function readJsonBody(req: IncomingMessage): Promise<BodyResult> {
  const chunks: Buffer[] = [];
  let size = 0;
  let failed: "too_large" | "error" | null = null;
  await new Promise<void>((resolve) => {
    req.on("data", (chunk: Buffer) => {
      if (failed) return; // drain quietly after a failure was detected
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        failed = "too_large";
        // Respond 413 without waiting for the rest of the body; swallow
        // remaining chunks so the socket is not destroyed mid-response.
        req.removeAllListeners("data");
        req.on("data", () => {});
        resolve();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve());
    req.on("error", () => {
      failed = failed ?? "error";
      resolve();
    });
  });
  if (failed === "too_large") {
    return {
      ok: false,
      status: 413,
      code: "BODY_TOO_LARGE",
      message: "حجم درخواست بیش از حد مجاز است",
    };
  }
  if (failed === "error") {
    return {
      ok: false,
      status: 400,
      code: "BODY_READ_FAILED",
      message: "خواندن بدنه درخواست ناموفق بود",
    };
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim().length === 0) return { ok: true, data: {} };
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      status: 400,
      code: "INVALID_JSON",
      message: "بدنه درخواست باید JSON معتبر باشد",
    };
  }
}

function streamRowToApi(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    scene: row.scene,
    sourceType: row.source_type,
    width: row.width,
    height: row.height,
    targetFps: row.target_fps,
    objectCount: row.object_count,
    confidenceThreshold: row.confidence_threshold,
    classFilterJson: row.class_filter_json,
    roiJson: row.roi_json,
    lineJson: row.line_json,
    queueCapacity: row.queue_capacity,
    gridCols: row.grid_cols,
    gridRows: row.grid_rows,
    emitStride: row.emit_stride,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function modelRowToApi(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    task: row.task,
    format: row.format,
    device: row.device,
    inputShape: row.input_shape,
    classesJson: row.classes_json,
    sizeBytes: row.size_bytes,
    license: row.license,
    description: row.description,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertStream(
  db: Database,
  input: StreamInput,
): Record<string, unknown> {
  const id = crypto.randomUUID();
  const now = isoNow();
  db.prepare(
    `INSERT INTO streams (id, name, scene, source_type, width, height, target_fps,
       object_count, confidence_threshold, class_filter_json, roi_json, line_json,
       queue_capacity, grid_cols, grid_rows, emit_stride, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IDLE', ?, ?)`,
  ).run(
    id,
    input.name,
    input.scene,
    "SYNTHETIC",
    input.width,
    input.height,
    input.targetFps,
    input.objectCount,
    input.confidenceThreshold,
    JSON.stringify(input.classFilter),
    input.roi ? JSON.stringify(input.roi) : null,
    input.line ? JSON.stringify(input.line) : null,
    input.queueCapacity,
    input.gridCols,
    input.gridRows,
    input.emitStride,
    now,
    now,
  );
  const row = db.prepare("SELECT * FROM streams WHERE id = ?").get(id) as
    | Record<string, unknown>
    | null;
  return streamRowToApi(row ?? { id });
}

function updateStream(
  db: Database,
  id: string,
  input: StreamInput,
): Record<string, unknown> | null {
  const now = isoNow();
  const changes = db
    .prepare(
      `UPDATE streams SET name = ?, scene = ?, width = ?, height = ?, target_fps = ?,
         object_count = ?, confidence_threshold = ?, class_filter_json = ?, roi_json = ?,
         line_json = ?, queue_capacity = ?, grid_cols = ?, grid_rows = ?, emit_stride = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.name,
      input.scene,
      input.width,
      input.height,
      input.targetFps,
      input.objectCount,
      input.confidenceThreshold,
      JSON.stringify(input.classFilter),
      input.roi ? JSON.stringify(input.roi) : null,
      input.line ? JSON.stringify(input.line) : null,
      input.queueCapacity,
      input.gridCols,
      input.gridRows,
      input.emitStride,
      now,
      id,
    ).changes;
  if (changes === 0) return null;
  const row = db.prepare("SELECT * FROM streams WHERE id = ?").get(id) as
    | Record<string, unknown>
    | null;
  return row ? streamRowToApi(row) : null;
}

function insertModel(db: Database, input: ModelInput): Record<string, unknown> {
  const id = crypto.randomUUID();
  const now = isoNow();
  db.prepare(
    `INSERT INTO models (id, name, task, format, device, input_shape, classes_json,
       size_bytes, license, description, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    input.name,
    input.task,
    input.format,
    input.device,
    input.inputShape,
    JSON.stringify(input.classes),
    input.sizeBytes,
    input.license,
    input.description,
    now,
    now,
  );
  const row = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as
    | Record<string, unknown>
    | null;
  return modelRowToApi(row ?? { id });
}

/**
 * Create the /internal/* HTTP request handler. This handler is attached to
 * the node:http server BEFORE socket.io attaches, so engine.io requests
 * (which carry its query params) never reach it.
 */
export function createInternalHandler(deps: InternalDeps): (
  req: IncomingMessage,
  res: ServerResponse,
) => void {
  const { db, manager, settings } = deps;

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://engine-service.local");
    const path = decodeURIComponent(url.pathname);

    if (!path.startsWith("/internal/")) {
      sendError(res, 404, "NOT_FOUND", "مسیر داخلی یافت نشد");
      return;
    }

    const token = req.headers["x-internal-token"];
    if (token !== INTERNAL_TOKEN) {
      sendError(res, 401, "UNAUTHORIZED", "توکن داخلی نامعتبر است");
      return;
    }

    const method = (req.method ?? "GET").toUpperCase();
    const segments = path.split("/").filter(Boolean); // ["internal", ...]

    // ---- GET /internal/health ----
    if (method === "GET" && path === "/internal/health") {
      let dbOk = false;
      try {
        db.prepare("SELECT 1 AS ok").get();
        dbOk = true;
      } catch {
        dbOk = false;
      }
      sendJson(res, 200, {
        ok: dbOk,
        db: dbOk,
        engineBinary: engineBinaryExists(),
        activeSessions: manager.snapshot().length,
        version: "1.0.0",
      });
      return;
    }

    // ---- GET /internal/snapshot ----
    if (method === "GET" && path === "/internal/snapshot") {
      sendJson(res, 200, { sessions: manager.snapshot() });
      return;
    }

    // ---- POST /internal/streams ----
    if (method === "POST" && path === "/internal/streams") {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        return;
      }
      const validated = validateStreamCreate(body.data);
      if (!validated.ok) {
        sendJson(res, 400, {
          message: "داده‌های ورودی نامعتبر است",
          details: validated.errors,
        });
        return;
      }
      const row = insertStream(db, validated.value);
      sendJson(res, 201, row);
      return;
    }

    // ---- /internal/streams/:id[/start|/stop] ----
    if (
      segments.length >= 3 &&
      segments[0] === "internal" &&
      segments[1] === "streams"
    ) {
      const id = segments[2];
      if (segments.length === 3) {
        const row = db
          .prepare("SELECT * FROM streams WHERE id = ?")
          .get(id) as Record<string, unknown> | null;

        if (method === "PATCH") {
          if (!row) {
            sendError(res, 404, "STREAM_NOT_FOUND", "استریم مورد نظر یافت نشد");
            return;
          }
          if (manager.snapshot().some((s) => s.streamId === id)) {
            sendError(
              res,
              409,
              "STREAM_ACTIVE",
              "استریم فعال را نمی‌توان ویرایش کرد",
            );
            return;
          }
          const body = await readJsonBody(req);
          if (!body.ok) {
            sendError(res, body.status, body.code, body.message);
            return;
          }
          const validated = validateStreamPatch(
            body.data,
            rowToStreamInput(row),
          );
          if (!validated.ok) {
            sendJson(res, 400, {
              message: "داده‌های ورودی نامعتبر است",
              details: validated.errors,
            });
            return;
          }
          const updated = updateStream(db, id, validated.value);
          sendJson(res, 200, updated);
          return;
        }

        if (method === "DELETE") {
          if (!row) {
            sendError(res, 404, "STREAM_NOT_FOUND", "استریم مورد نظر یافت نشد");
            return;
          }
          if (manager.snapshot().some((s) => s.streamId === id)) {
            sendError(
              res,
              409,
              "STREAM_ACTIVE",
              "ابتدا نشست فعال را متوقف کنید",
            );
            return;
          }
          const tx = db.transaction(() => {
            db.prepare("DELETE FROM detections WHERE stream_id = ?").run(id);
            db.prepare("DELETE FROM events WHERE stream_id = ?").run(id);
            db.prepare("DELETE FROM metrics WHERE stream_id = ?").run(id);
            db.prepare("DELETE FROM sessions WHERE stream_id = ?").run(id);
            db.prepare("DELETE FROM streams WHERE id = ?").run(id);
          });
          tx();
          sendJson(res, 200, { ok: true });
          return;
        }
      } else if (segments.length === 4) {
        if (method === "POST" && segments[3] === "start") {
          const result = await manager.start(id);
          if (result.ok) sendJson(res, 200, { ok: true, session: result.value });
          else
            sendError(res, result.status, result.code, result.message);
          return;
        }
        if (method === "POST" && segments[3] === "stop") {
          const result = await manager.stop(id);
          if (result.ok) sendJson(res, 200, { ok: true, session: result.value });
          else sendError(res, result.status, result.code, result.message);
          return;
        }
      }
    }

    // ---- POST /internal/models ----
    if (method === "POST" && path === "/internal/models") {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        return;
      }
      const validated = validateModelCreate(body.data);
      if (!validated.ok) {
        sendJson(res, 400, {
          message: "داده‌های ورودی نامعتبر است",
          details: validated.errors,
        });
        return;
      }
      const dup = db
        .prepare("SELECT id FROM models WHERE name = ?")
        .get(validated.value.name);
      if (dup) {
        sendError(res, 409, "MODEL_DUPLICATE", "مدلی با این نام ثبت شده است");
        return;
      }
      sendJson(res, 201, insertModel(db, validated.value));
      return;
    }

    // ---- PATCH /internal/models/:id ----
    if (
      method === "PATCH" &&
      segments.length === 3 &&
      segments[0] === "internal" &&
      segments[1] === "models"
    ) {
      const id = segments[2];
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        return;
      }
      const validated = validateModelActivate(body.data);
      if (!validated.ok) {
        sendJson(res, 400, {
          message: "داده‌های ورودی نامعتبر است",
          details: validated.errors,
        });
        return;
      }
      const row = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as
        | Record<string, unknown>
        | null;
      if (!row) {
        sendError(res, 404, "MODEL_NOT_FOUND", "مدل مورد نظر یافت نشد");
        return;
      }
      const now = isoNow();
      const tx = db.transaction(() => {
        db.prepare("UPDATE models SET is_active = 0, updated_at = ?").run(now);
        if (validated.value.isActive)
          db
            .prepare("UPDATE models SET is_active = 1, updated_at = ? WHERE id = ?")
            .run(now, id);
      });
      tx();
      const updated = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as
        | Record<string, unknown>
        | null;
      sendJson(res, 200, updated ? modelRowToApi(updated) : { ok: true });
      return;
    }

    // ---- GET/PATCH /internal/settings ----
    if (path === "/internal/settings") {
      if (method === "GET") {
        sendJson(res, 200, {
          defaultGridCols: settings.defaultGridCols,
          defaultGridRows: settings.defaultGridRows,
          defaultQueueCapacity: settings.defaultQueueCapacity,
          defaultEmitStride: settings.defaultEmitStride,
          metricsPersistEvery: settings.metricsPersistEvery,
        });
        return;
      }
      if (method === "PATCH") {
        const body = await readJsonBody(req);
        if (!body.ok) {
          sendError(res, body.status, body.code, body.message);
          return;
        }
        const validated = validateSettingsPatch(body.data);
        if (!validated.ok) {
          sendJson(res, 400, {
            message: "داده‌های ورودی نامعتبر است",
            details: validated.errors,
          });
          return;
        }
        Object.assign(settings, validated.value);
        saveSettings(settings);
        console.log(
          `[engine-service] settings updated: ${JSON.stringify(validated.value)} (ranges ${JSON.stringify(SETTINGS_RANGES)})`,
        );
        sendJson(res, 200, {
          defaultGridCols: settings.defaultGridCols,
          defaultGridRows: settings.defaultGridRows,
          defaultQueueCapacity: settings.defaultQueueCapacity,
          defaultEmitStride: settings.defaultEmitStride,
          metricsPersistEvery: settings.metricsPersistEvery,
        });
        return;
      }
    }

    sendError(res, 404, "NOT_FOUND", "مسیر داخلی یافت نشد");
  };

  return (req, res) => {
    void handle(req, res).catch((err) => {
      console.error("[engine-service] internal handler error:", err);
      if (!res.headersSent) {
        sendError(res, 500, "INTERNAL", "خطای داخلی سرور");
      } else {
        res.end();
      }
    });
  };
}
