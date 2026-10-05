#!/usr/bin/env bash
# EdgeVision — start the realtime engine service, fully detached.
#
# Uses scripts/daemonize.py (double-fork) so the service keeps running after
# the launching shell/tool call exits — same lifecycle as the app itself.
#
# Usage:  bash scripts/start-engine-service.sh   (idempotent: does nothing if
#         the service already answers on :3003)
# Copyright © 2026 Parsa Fathi — Apache-2.0
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT/mini-services/engine-service"
LOG="$SERVICE_DIR/service.log"
TOKEN="${EV_INTERNAL_TOKEN:-edgevision-local}"

if curl -s --max-time 3 -H "x-internal-token: $TOKEN" http://127.0.0.1:3003/internal/health | rg -q '"ok":true'; then
  echo "engine-service is already running"
  exit 0
fi

python3 "$ROOT/scripts/daemonize.py" --cwd "$SERVICE_DIR" --log "$LOG" -- bun --hot index.ts

# Wait for readiness (up to ~10s).
for _ in $(seq 1 20); do
  if curl -s --max-time 2 -H "x-internal-token: $TOKEN" http://127.0.0.1:3003/internal/health | rg -q '"ok":true'; then
    echo "engine-service is up (port 3003)"
    exit 0
  fi
  sleep 0.5
done

echo "engine-service did not become healthy in time — check $LOG" >&2
exit 1
