// EdgeVision — engine orchestration service
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ServiceSettings {
  defaultGridCols: number;
  defaultGridRows: number;
  defaultQueueCapacity: number;
  defaultEmitStride: number;
  /** Persist every Nth metrics line to the DB. Fixed at 2 for now. */
  metricsPersistEvery: number;
}

const SETTINGS_FILE = join(import.meta.dir, "settings.json");

export const DEFAULT_SETTINGS: ServiceSettings = {
  defaultGridCols: 40,
  defaultGridRows: 24,
  defaultQueueCapacity: 30,
  defaultEmitStride: 2,
  metricsPersistEvery: 2,
};

/** Ranges shared with the /internal/settings PATCH validation. */
export const SETTINGS_RANGES = {
  defaultGridCols: { min: 16, max: 80 },
  defaultGridRows: { min: 9, max: 48 },
  defaultQueueCapacity: { min: 5, max: 200 },
  defaultEmitStride: { min: 1, max: 10 },
} as const;

/**
 * Load settings from settings.json (runtime artifact next to this module),
 * falling back to defaults for missing/invalid fields.
 */
export function loadSettings(): ServiceSettings {
  try {
    const raw = readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ServiceSettings>;
    return { ...DEFAULT_SETTINGS, ...sanitise(parsed) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function sanitise(p: Partial<ServiceSettings>): Partial<ServiceSettings> {
  const out: Partial<ServiceSettings> = {};
  for (const key of [
    "defaultGridCols",
    "defaultGridRows",
    "defaultQueueCapacity",
    "defaultEmitStride",
  ] as const) {
    const v = p[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.trunc(v);
  }
  return out;
}

/** Persist the mutable part of settings to settings.json (best effort). */
export function saveSettings(s: ServiceSettings): void {
  const payload = {
    defaultGridCols: s.defaultGridCols,
    defaultGridRows: s.defaultGridRows,
    defaultQueueCapacity: s.defaultQueueCapacity,
    defaultEmitStride: s.defaultEmitStride,
  };
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.error("[engine-service] failed to persist settings.json:", err);
  }
}
