#!/usr/bin/env python3
# EdgeVision — native video analytics engine
# Copyright © 2026 Parsa Fathi — Apache-2.0
"""Black-box smoke harness for the native EdgeVision engine.

Spawns engine-cpp/build/edgevision-engine as a subprocess, reads its stdout
NDJSON in a background thread and validates EVERY line against the frozen
wire contract (json.loads + per-type schema: required keys, exact key order,
JSON types, value ranges, float precision <= 3 decimals, stdout purity —
any non-JSON line fails). Stdin commands are sent on a schedule with the
command log kept for transcript assertions, and each scenario asserts on the
whole transcript after the process exits.

Scenarios (see .agent-ctx/task-2a-engine-cpp.md, frozen contract):
  a. --version                       -> version line, exit 0
  b. invalid config (3 variants)     -> error CONFIG_INVALID + exit 2
  c. full STREET session (>= 10 s)   -> lifecycle, frames, metrics, events,
                                        ping/pong, set grid, graceful stop
  d. --class-filter VEHICLE          -> zero PEDESTRIAN/CYCLIST detections
  e. --confidence 0.9                -> every detection conf >= 0.9
  f. SIGTERM mid-run                 -> session_stopped reason "signal", exit 0
  g. queue 5 + grid 80x48 + 30 fps   -> droppedTotal > 0, pipeline keeps running

Usage:
  python3 engine-cpp/tools/engine_smoke.py                # run all scenarios
  python3 engine-cpp/tools/engine_smoke.py --binary PATH # alternate binary
  python3 engine-cpp/tools/engine_smoke.py --only c g    # subset
  python3 engine-cpp/tools/engine_smoke.py --repeat 3    # whole suite N times

Exit code = number of FAILED scenario runs (0 = all green).
"""

from __future__ import annotations

import argparse
import json
import re
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BIN = ROOT / "build" / "edgevision-engine"

CLASS_NAMES = ("PEDESTRIAN", "VEHICLE", "CYCLIST")
ENGINE_EVENT_TYPES = ("LINE_CROSS", "ROI_ENTER", "ROI_EXIT", "SESSION_END")
STOP_REASONS = ("user_stop", "eof", "signal")

# ---------------------------------------------------------------------------
# Frozen-contract schema tables: exact key order + JSON type per key.
# ---------------------------------------------------------------------------

T_INT = "int"    # JSON integer (bool excluded)
T_FLOAT = "float"  # JSON float (the engine always emits a decimal point)
T_STR = "str"
T_LIST = "list"
T_DICT = "dict"

LINE_SPECS: dict[str, list[tuple[str, str]]] = {
    "version": [("type", T_STR), ("version", T_STR)],
    "ready": [("type", T_STR), ("engine", T_STR), ("version", T_STR)],
    "session_started": [
        ("type", T_STR), ("sessionId", T_STR), ("streamId", T_STR), ("ts", T_INT),
    ],
    "state": [("type", T_STR), ("state", T_STR), ("ts", T_INT)],
    "frame": [
        ("type", T_STR), ("frameIndex", T_INT), ("ts", T_INT),
        ("latencyMs", T_FLOAT), ("objects", T_LIST), ("detections", T_LIST),
    ],
    "event": [("type", T_STR), ("ev", T_DICT)],
    "metrics": [
        ("type", T_STR), ("ts", T_INT), ("sourceFps", T_FLOAT),
        ("processedFps", T_FLOAT), ("latency", T_DICT), ("queueDepth", T_INT),
        ("queueCapacity", T_INT), ("droppedTotal", T_INT), ("cpuPercent", T_FLOAT),
        ("memoryMb", T_FLOAT), ("framesProcessed", T_INT),
        ("detectionsTotal", T_INT), ("uptimeMs", T_INT),
    ],
    "settings_applied": [
        ("type", T_STR), ("grid", T_STR), ("queueCapacity", T_INT),
        ("emitStride", T_INT), ("ts", T_INT),
    ],
    "pong": [("type", T_STR), ("ts", T_INT)],
    "session_stopped": [
        ("type", T_STR), ("reason", T_STR), ("ts", T_INT), ("summary", T_DICT),
    ],
    "error": [("type", T_STR), ("code", T_STR), ("message", T_STR), ("ts", T_INT)],
}

METRICS_LATENCY_KEYS = ["avgMs", "minMs", "maxMs", "p50Ms", "p95Ms"]
SUMMARY_KEYS = [
    "framesProcessed", "framesDropped", "detectionsTotal", "eventsTotal", "uptimeMs",
]
EV_KEYS = ["type", "ts", "trackId", "label", "payload"]
OBJECT_KEYS = ["oid", "t", "x", "y", "w", "h"]
DETECTION_KEYS = ["trackId", "label", "conf", "x", "y", "w", "h"]

FLOAT_PRECISION_RE = re.compile(r"\d+\.\d{4,}")
SANITIZER_RE = re.compile(
    r"AddressSanitizer|LeakSanitizer|UndefinedBehaviorSanitizer|runtime error:"
)


def _type_ok(value: Any, kind: str) -> bool:
    if kind == T_INT:
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == T_FLOAT:
        return isinstance(value, float) and not isinstance(value, bool)
    if kind == T_STR:
        return isinstance(value, str)
    if kind == T_LIST:
        return isinstance(value, list)
    if kind == T_DICT:
        return isinstance(value, dict)
    return False


def _check_keys(obj: dict, keys: list[str], where: str, errors: list[str]) -> None:
    if list(obj.keys()) != keys:
        errors.append(
            f"{where}: key order/set mismatch — expected {keys}, got {list(obj.keys())}"
        )


def _check_type(value: Any, kind: str, where: str, errors: list[str]) -> None:
    if not _type_ok(value, kind):
        got = type(value).__name__
        errors.append(f"{where}: expected {kind}, got {got} ({value!r})")


def _check_float_field(value: Any, where: str, errors: list[str],
                       lo: float | None = None, hi: float | None = None) -> None:
    _check_type(value, T_FLOAT, where, errors)
    if isinstance(value, float):
        if lo is not None and value < lo:
            errors.append(f"{where}: {value} < minimum {lo}")
        if hi is not None and value > hi:
            errors.append(f"{where}: {value} > maximum {hi}")


def validate_line(raw: str) -> tuple[dict | None, list[str]]:
    """Validate one raw stdout line against the frozen contract.

    Returns (parsed_object_or_None, list_of_error_strings). A non-JSON line
    (stdout purity violation) yields (None, [error]).
    """
    errors: list[str] = []
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, [f"stdout purity: line is not valid JSON ({exc}): {raw[:120]!r}"]
    if not isinstance(obj, dict):
        return None, [f"stdout purity: line is not a JSON object: {raw[:120]!r}"]

    if FLOAT_PRECISION_RE.search(raw):
        errors.append(f"float precision: >3 decimals in {raw[:120]!r}")

    ltype = obj.get("type")
    if not isinstance(ltype, str):
        errors.append("missing/invalid 'type' field")
        return obj, errors
    spec = LINE_SPECS.get(ltype)
    if spec is None:
        errors.append(f"unknown line type {ltype!r}")
        return obj, errors

    _check_keys(obj, [k for k, _ in spec], f"line[{ltype}]", errors)
    for key, kind in spec:
        if key not in obj:
            errors.append(f"line[{ltype}]: missing key {key!r}")
            continue
        _check_type(obj[key], kind, f"line[{ltype}].{key}", errors)

    if ltype == "ready":
        if obj.get("engine") != "edgevision-cpp":
            errors.append(f"ready.engine != 'edgevision-cpp': {obj.get('engine')!r}")
        if obj.get("version") != "1.0.0":
            errors.append(f"ready.version != '1.0.0': {obj.get('version')!r}")

    elif ltype == "state":
        if obj.get("state") not in ("RUNNING", "DEGRADED"):
            errors.append(f"state.state invalid: {obj.get('state')!r}")

    elif ltype == "frame":
        for i, o in enumerate(obj.get("objects", [])):
            where = f"frame.objects[{i}]"
            if not isinstance(o, dict):
                errors.append(f"{where}: not an object")
                continue
            _check_keys(o, OBJECT_KEYS, where, errors)
            if not _type_ok(o.get("oid"), T_INT):
                errors.append(f"{where}.oid: expected int")
            if o.get("t") not in CLASS_NAMES:
                errors.append(f"{where}.t: invalid class {o.get('t')!r}")
            for k in ("x", "y", "w", "h"):
                _check_float_field(o.get(k), f"{where}.{k}", errors, lo=-0.5, hi=1.5)
            if isinstance(o.get("w"), float) and o["w"] <= 0.0:
                errors.append(f"{where}.w: must be > 0")
            if isinstance(o.get("h"), float) and o["h"] <= 0.0:
                errors.append(f"{where}.h: must be > 0")
        for i, d in enumerate(obj.get("detections", [])):
            where = f"frame.detections[{i}]"
            if not isinstance(d, dict):
                errors.append(f"{where}: not an object")
                continue
            _check_keys(d, DETECTION_KEYS, where, errors)
            if not _type_ok(d.get("trackId"), T_INT):
                errors.append(f"{where}.trackId: expected int")
            elif d["trackId"] < 0:
                errors.append(f"{where}.trackId: negative")
            if d.get("label") not in CLASS_NAMES:
                errors.append(f"{where}.label: invalid label {d.get('label')!r}")
            _check_float_field(d.get("conf"), f"{where}.conf", errors, lo=0.0, hi=1.0)
            for k in ("x", "y", "w", "h"):
                _check_float_field(d.get(k), f"{where}.{k}", errors, lo=-0.5, hi=1.5)
            if isinstance(d.get("w"), float) and d["w"] <= 0.0:
                errors.append(f"{where}.w: must be > 0")
            if isinstance(d.get("h"), float) and d["h"] <= 0.0:
                errors.append(f"{where}.h: must be > 0")

    elif ltype == "event":
        ev = obj.get("ev")
        if not isinstance(ev, dict):
            errors.append("event.ev: not an object")
        else:
            _check_keys(ev, EV_KEYS, "event.ev", errors)
            if ev.get("type") not in ENGINE_EVENT_TYPES:
                errors.append(f"event.ev.type invalid: {ev.get('type')!r}")
            _check_type(ev.get("ts"), T_INT, "event.ev.ts", errors)
            _check_type(ev.get("trackId"), T_INT, "event.ev.trackId", errors)
            _check_type(ev.get("label"), T_STR, "event.ev.label", errors)
            _check_type(ev.get("payload"), T_DICT, "event.ev.payload", errors)
            if ev.get("type") == "LINE_CROSS":
                payload = ev.get("payload")
                if isinstance(payload, dict) and payload.get("direction") not in (
                    "L2R", "R2L", "T2B", "B2T",
                ):
                    errors.append(
                        f"LINE_CROSS payload.direction invalid: {payload.get('direction')!r}"
                    )
            if ev.get("type") == "SESSION_END":
                payload = ev.get("payload")
                if not isinstance(payload, dict) or set(payload.keys()) != set(SUMMARY_KEYS):
                    errors.append(
                        "SESSION_END payload keys mismatch: "
                        f"{list(payload.keys()) if isinstance(payload, dict) else 'n/a'}"
                    )

    elif ltype == "metrics":
        lat = obj.get("latency")
        if not isinstance(lat, dict):
            errors.append("metrics.latency: not an object")
        else:
            _check_keys(lat, METRICS_LATENCY_KEYS, "metrics.latency", errors)
            for k in METRICS_LATENCY_KEYS:
                _check_float_field(lat.get(k), f"metrics.latency.{k}", errors, lo=0.0)
        for k in ("sourceFps", "processedFps", "cpuPercent", "memoryMb"):
            _check_float_field(obj.get(k), f"metrics.{k}", errors, lo=0.0)
        if isinstance(obj.get("queueDepth"), int) and isinstance(
            obj.get("queueCapacity"), int
        ):
            if obj["queueDepth"] > obj["queueCapacity"]:
                errors.append(
                    f"metrics.queueDepth {obj['queueDepth']} > capacity {obj['queueCapacity']}"
                )

    elif ltype == "settings_applied":
        if not re.fullmatch(r"\d+x\d+", str(obj.get("grid", ""))):
            errors.append(f"settings_applied.grid malformed: {obj.get('grid')!r}")

    elif ltype == "session_stopped":
        if obj.get("reason") not in STOP_REASONS:
            errors.append(f"session_stopped.reason invalid: {obj.get('reason')!r}")
        summary = obj.get("summary")
        if isinstance(summary, dict):
            _check_keys(summary, SUMMARY_KEYS, "session_stopped.summary", errors)
            for k in SUMMARY_KEYS:
                _check_type(summary.get(k), T_INT, f"session_stopped.summary.{k}", errors)

    elif ltype == "error":
        if obj.get("code") not in ("CONFIG_INVALID", "INTERNAL"):
            errors.append(f"error.code invalid: {obj.get('code')!r}")

    return obj, errors


# ---------------------------------------------------------------------------
# Engine subprocess wrapper (reader thread + command log + transcript).
# ---------------------------------------------------------------------------


class EngineSession:
    """One engine run: spawns the binary, streams stdout through the schema
    validator in a background thread, records stdin commands, waits for exit."""

    def __init__(self, binary: Path, args: list[str], label: str):
        self.label = label
        self.binary = binary
        self.start_wall = time.time()
        self.proc = subprocess.Popen(
            [str(binary)] + args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.raw_lines: list[str] = []
        self.lines: list[dict | None] = []
        self.schema_errors: list[str] = []
        self.sanitizer_findings: list[str] = []
        self.commands: list[tuple[float, str]] = []  # (elapsed_s, command)
        self.stderr_tail: list[str] = []
        self._lock = threading.Lock()
        self._stdout_thread = threading.Thread(
            target=self._read_stdout, daemon=True, name=f"{label}-stdout"
        )
        self._stderr_thread = threading.Thread(
            target=self._read_stderr, daemon=True, name=f"{label}-stderr"
        )
        self._stdout_thread.start()
        self._stderr_thread.start()

    # -- reader threads ----------------------------------------------------

    def _read_stdout(self) -> None:
        assert self.proc.stdout is not None
        for raw in self.proc.stdout:
            line = raw.rstrip("\r\n")
            if not line:
                continue  # tolerate a stray blank line, still counts as pure
            obj, errors = validate_line(line)
            with self._lock:
                self.raw_lines.append(line)
                self.lines.append(obj)
                self.schema_errors.extend(errors)

    def _read_stderr(self) -> None:
        assert self.proc.stderr is not None
        for raw in self.proc.stderr:
            line = raw.rstrip("\r\n")
            if SANITIZER_RE.search(line):
                with self._lock:
                    self.sanitizer_findings.append(line)
            if line:
                with self._lock:
                    self.stderr_tail.append(line)
                    if len(self.stderr_tail) > 40:
                        del self.stderr_tail[0]

    # -- control -----------------------------------------------------------

    def send(self, command: str) -> None:
        assert self.proc.stdin is not None
        with self._lock:
            self.commands.append((time.time() - self.start_wall, command))
        self.proc.stdin.write(command + "\n")
        self.proc.stdin.flush()

    def wait(self, timeout: float) -> int | None:
        try:
            code = self.proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=5)
            return None
        self._stdout_thread.join(timeout=5)
        self._stderr_thread.join(timeout=5)
        return code

    def sigterm(self) -> None:
        self.proc.send_signal(signal.SIGTERM)

    # -- transcript helpers --------------------------------------------------

    def of_type(self, ltype: str) -> list[dict]:
        with self._lock:
            return [l for l in self.lines if l is not None and l.get("type") == ltype]

    def events(self, ev_type: str) -> list[dict]:
        out = []
        for line in self.of_type("event"):
            ev = line.get("ev", {})
            if isinstance(ev, dict) and ev.get("type") == ev_type:
                out.append(ev)
        return out

    def detections(self) -> list[dict]:
        out = []
        for line in self.of_type("frame"):
            for d in line.get("detections", []):
                if isinstance(d, dict):
                    out.append(d)
        return out

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "lines": len(self.raw_lines),
                "commands": list(self.commands),
                "stderr": list(self.stderr_tail),
                "schema_errors": list(self.schema_errors),
            }

    def protocol_failures(self) -> list[str]:
        """Every contract violation seen on the wire: schema errors on stdout
        plus sanitizer findings on stderr (the binary may be an asan build)."""
        with self._lock:
            out = [f"schema: {e}" for e in self.schema_errors]
            out.extend(f"sanitizer: {f}" for f in self.sanitizer_findings)
            return out


# ---------------------------------------------------------------------------
# Scenario argument helpers
# ---------------------------------------------------------------------------


def base_args(**overrides: str) -> list[str]:
    """Valid full CLI config; overrides replace values, None removes a flag."""
    values: dict[str, str | None] = {
        "session-id": "smoke-session-1",
        "stream-id": "smoke-stream-1",
        "seed": "20260101",
        "scene": "STREET",
        "width": "640",
        "height": "360",
        "target-fps": "15",
        "objects": "8",
        "queue-capacity": "30",
        "confidence": "0.5",
        "grid": "40x24",
    }
    values.update(overrides)
    args: list[str] = []
    for flag, value in values.items():
        if value is None:
            continue
        args.extend([f"--{flag}", value])
    return args


# ---------------------------------------------------------------------------
# Scenarios — each returns (name, passed: bool, report: list[str])
# ---------------------------------------------------------------------------


def _finish(name: str, failures: list[str], evidence: list[str]) -> tuple[str, bool, list[str]]:
    report = [f"  evidence: {line}" for line in evidence]
    if failures:
        report = [f"  FAILURE: {line}" for line in failures] + report
    return name, not failures, report


def scenario_a(binary: Path) -> tuple[str, bool, list[str]]:
    """--version prints exactly the version line and exits 0."""
    proc = subprocess.run(
        [str(binary), "--version"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=10,
    )
    failures: list[str] = []
    evidence: list[str] = []
    raw_lines = [l for l in proc.stdout.splitlines() if l.strip()]
    objs = []
    for raw in raw_lines:
        obj, errors = validate_line(raw)
        objs.append(obj)
        failures.extend(errors)
    if len(raw_lines) != 1:
        failures.append(f"expected exactly 1 stdout line, got {len(raw_lines)}")
    if objs and objs[0] != {"type": "version", "version": "1.0.0"}:
        failures.append(f"version line mismatch: {objs[0]!r}")
    if proc.returncode != 0:
        failures.append(f"exit code {proc.returncode} != 0")
    evidence.append(f"stdout={raw_lines}")
    evidence.append(f"exit={proc.returncode}")
    return _finish("a: --version", failures, evidence)


def scenario_b(binary: Path) -> tuple[str, bool, list[str]]:
    """Invalid configs (bad scene / confidence 1.5 / malformed roi) each emit
    an error CONFIG_INVALID line and exit 2."""
    failures: list[str] = []
    evidence: list[str] = []
    cases = [
        ("bad-scene", {"scene": "BEACH"}),
        ("confidence-high", {"confidence": "1.5"}),
        ("roi-malformed", None),  # handled separately below
    ]
    for name, overrides in cases:
        if name == "roi-malformed":
            args = base_args() + ["--roi", "0.25,0.15"]  # only two of four values
        else:
            args = base_args(**overrides)
        proc = subprocess.run(
            [str(binary)] + args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
        )
        raw_lines = [l for l in proc.stdout.splitlines() if l.strip()]
        objs: list[dict | None] = []
        for raw in raw_lines:
            obj, errors = validate_line(raw)
            objs.append(obj)
            failures.extend([f"[{name}] {e}" for e in errors])
        if len(raw_lines) != 1:
            failures.append(f"[{name}] expected exactly 1 stdout line, got {len(raw_lines)}")
        if not objs or objs[0] is None or objs[0].get("type") != "error":
            failures.append(f"[{name}] first line is not an error line: {raw_lines[:1]}")
        elif objs[0].get("code") != "CONFIG_INVALID":
            failures.append(f"[{name}] error.code={objs[0].get('code')!r} != CONFIG_INVALID")
        if proc.returncode != 2:
            failures.append(f"[{name}] exit code {proc.returncode} != 2")
        evidence.append(
            f"[{name}] code={objs[0].get('code') if objs and objs[0] else None} "
            f"exit={proc.returncode} msg={objs[0].get('message') if objs and objs[0] else None!r}"
        )
    return _finish("b: invalid config -> CONFIG_INVALID + exit 2", failures, evidence)


def scenario_c(binary: Path) -> tuple[str, bool, list[str]]:
    """Full STREET session >= 10 s: lifecycle, frames, metrics, both event
    families, ping->pong, set grid -> settings_applied, graceful stop."""
    failures: list[str] = []
    evidence: list[str] = []
    args = base_args(
        **{
            "session-id": "smoke-c-session",
            "stream-id": "smoke-c-stream",
            "roi": "0.25,0.15,0.5,0.6",
            "line": "0.5,0.1,0.5,0.9",
        }
    )
    # inject optional roi/line flags (base_args puts them as --roi/--line)
    sess = EngineSession(binary, args, "c")

    # Command schedule: ping once frames flow, then a settings change, then stop
    # after >= 10 s of runtime (uptime asserted on the session_stopped summary).
    if not _wait_for(sess, lambda: len(sess.of_type("frame")) >= 1, timeout=6.0):
        failures.append("no frame line within 6 s (ping schedule aborted early)")
    sess.send("ping")
    time.sleep(2.0)
    sess.send("set grid 60x36")
    time.sleep(5.5)
    time.sleep(3.0)
    sess.send("stop")
    code = sess.wait(timeout=10)

    # ---- transcript assertions ----
    failures.extend(sess.protocol_failures())

    if code != 0:
        failures.append(f"exit code {code!r} != 0")
    types = [l.get("type") for l in sess.lines if l is not None]

    if not types or types[0] != "ready":
        failures.append(f"first line is not ready: {types[:1]}")
    if len(types) < 2 or types[1] != "session_started":
        failures.append(f"second line is not session_started: {types[:2]}")
    else:
        started = sess.lines[1]
        assert started is not None
        if started.get("sessionId") != "smoke-c-session":
            failures.append(f"session_started.sessionId={started.get('sessionId')!r}")
        if started.get("streamId") != "smoke-c-stream":
            failures.append(f"session_started.streamId={started.get('streamId')!r}")
    if "state" not in types or types[:3] != ["ready", "session_started", "state"]:
        failures.append(f"expected ready->session_started->state as lines 1-3: {types[:3]}")
    elif sess.lines[2].get("state") != "RUNNING":
        failures.append(f"first state line is {sess.lines[2].get('state')!r} != RUNNING")

    frames = sess.of_type("frame")
    if len(frames) < 5:
        failures.append(f"only {len(frames)} frame lines (< 5)")
    frames_with_dets = sum(1 for f in frames if f.get("detections"))
    if frames_with_dets < 1:
        failures.append("no frame line carried any detection")

    metrics = sess.of_type("metrics")
    if len(metrics) < 5:
        failures.append(f"only {len(metrics)} metrics lines (< 5)")
    bad_metrics = [
        m for m in metrics
        if not (m.get("sourceFps", 0) > 0 and m.get("processedFps", 0) > 0
                and m.get("latency", {}).get("avgMs", 0) > 0
                and m.get("queueDepth", 10**9) <= m.get("queueCapacity", -1))
    ]
    if bad_metrics:
        failures.append(
            f"{len(bad_metrics)} metrics lines violate the positivity/capacity contract "
            f"(first: {json.dumps(bad_metrics[0])[:200]})"
        )

    line_cross = sess.events("LINE_CROSS")
    roi_events = sess.events("ROI_ENTER") + sess.events("ROI_EXIT")
    if not line_cross:
        failures.append("no LINE_CROSS event observed")
    if not roi_events:
        failures.append("no ROI_ENTER/ROI_EXIT event observed")

    pongs = sess.of_type("pong")
    if len(pongs) < 1:
        failures.append("ping was not answered with pong")

    applied = [s for s in sess.of_type("settings_applied") if s.get("grid") == "60x36"]
    if not applied:
        failures.append("set grid 60x36 did not produce settings_applied(60x36)")

    stopped = sess.of_type("session_stopped")
    if len(stopped) != 1:
        failures.append(f"expected exactly 1 session_stopped, got {len(stopped)}")
    else:
        st = stopped[0]
        if st.get("reason") != "user_stop":
            failures.append(f"session_stopped.reason={st.get('reason')!r} != user_stop")
        summary = st.get("summary", {})
        if summary.get("uptimeMs", 0) < 10000:
            failures.append(f"summary.uptimeMs={summary.get('uptimeMs')} < 10000 (10 s run)")
        if summary.get("framesProcessed", 0) <= 0:
            failures.append("summary.framesProcessed <= 0")
        if summary.get("detectionsTotal", 0) <= 0:
            failures.append("summary.detectionsTotal <= 0")
    if not sess.events("SESSION_END"):
        failures.append("no SESSION_END event before session_stopped")
    elif types and types[-1] != "session_stopped":
        failures.append(f"session_stopped is not the last line: {types[-1]!r}")

    # framesProcessed across metrics must be non-decreasing (real counters).
    fp = [m.get("framesProcessed", 0) for m in metrics]
    if any(b < a for a, b in zip(fp, fp[1:])):
        failures.append(f"metrics.framesProcessed not monotonic: {fp}")

    evidence.append(
        f"lines={len(types)} frames={len(frames)} (with detections: {frames_with_dets}) "
        f"metrics={len(metrics)}"
    )
    evidence.append(
        f"events: LINE_CROSS={len(line_cross)} ROI_ENTER={len(sess.events('ROI_ENTER'))} "
        f"ROI_EXIT={len(sess.events('ROI_EXIT'))} SESSION_END={len(sess.events('SESSION_END'))}"
    )
    if metrics:
        m = metrics[len(metrics) // 2]
        evidence.append(
            "sample metrics: sourceFps={:.3f} processedFps={:.3f} avgMs={:.3f} "
            "queueDepth={}/{} dropped={}".format(
                m.get("sourceFps", 0), m.get("processedFps", 0),
                m.get("latency", {}).get("avgMs", 0), m.get("queueDepth", -1),
                m.get("queueCapacity", -1), m.get("droppedTotal", -1),
            )
        )
    if stopped:
        evidence.append(f"session_stopped summary: {json.dumps(stopped[0].get('summary'))}")
    evidence.append(f"commands: {sess.snapshot()['commands']}")
    evidence.append(f"exit={code}")
    return _finish("c: full STREET session (>=10 s)", failures, evidence)


def scenario_d(binary: Path) -> tuple[str, bool, list[str]]:
    """--class-filter VEHICLE: zero PEDESTRIAN/CYCLIST detections."""
    failures: list[str] = []
    evidence: list[str] = []
    args = base_args(
        **{"session-id": "smoke-d", "stream-id": "smoke-d", "class-filter": "VEHICLE"}
    )
    sess = EngineSession(binary, args, "d")
    time.sleep(6.0)
    sess.send("stop")
    code = sess.wait(timeout=10)
    failures.extend(sess.protocol_failures())
    if code != 0:
        failures.append(f"exit code {code!r} != 0")
    dets = sess.detections()
    wrong = [d for d in dets if d.get("label") not in ("VEHICLE",)]
    vehicles = [d for d in dets if d.get("label") == "VEHICLE"]
    if wrong:
        labels = sorted({str(d.get("label")) for d in wrong})
        failures.append(f"{len(wrong)} non-VEHICLE detections leaked: {labels}")
    if not vehicles:
        failures.append("no VEHICLE detection at all (filter test is vacuous)")
    evidence.append(
        f"total detections={len(dets)} VEHICLE={len(vehicles)} "
        f"non-VEHICLE={len(wrong)}"
    )
    return _finish("d: class-filter VEHICLE", failures, evidence)


def scenario_e(binary: Path) -> tuple[str, bool, list[str]]:
    """--confidence 0.9: every emitted detection has conf >= 0.9."""
    failures: list[str] = []
    evidence: list[str] = []
    args = base_args(
        **{"session-id": "smoke-e", "stream-id": "smoke-e", "confidence": "0.9"}
    )
    sess = EngineSession(binary, args, "e")
    time.sleep(6.0)
    sess.send("stop")
    code = sess.wait(timeout=10)
    failures.extend(sess.protocol_failures())
    if code != 0:
        failures.append(f"exit code {code!r} != 0")
    dets = sess.detections()
    below = [d for d in dets if d.get("conf", 1.0) < 0.9]
    if below:
        failures.append(
            f"{len(below)} detections below 0.9 (min={min(d['conf'] for d in below)})"
        )
    if not dets:
        failures.append("no detection emitted at all (threshold test is vacuous)")
    if dets:
        evidence.append(
            f"detections={len(dets)} min_conf={min(d['conf'] for d in dets)} "
            f"max_conf={max(d['conf'] for d in dets)}"
        )
    return _finish("e: confidence 0.9 floor", failures, evidence)


def scenario_f(binary: Path) -> tuple[str, bool, list[str]]:
    """SIGTERM mid-run: graceful session_stopped reason 'signal', exit 0."""
    failures: list[str] = []
    evidence: list[str] = []
    args = base_args(**{"session-id": "smoke-f", "stream-id": "smoke-f"})
    sess = EngineSession(binary, args, "f")
    if not _wait_for(sess, lambda: len(sess.of_type("metrics")) >= 1, timeout=6.0):
        failures.append("no metrics before SIGTERM")
    time.sleep(1.5)
    sess.sigterm()
    code = sess.wait(timeout=10)
    failures.extend(sess.protocol_failures())
    if code != 0:
        failures.append(f"exit code {code!r} != 0 (graceful signal stop expected)")
    stopped = sess.of_type("session_stopped")
    if len(stopped) != 1 or stopped[0].get("reason") != "signal":
        reasons = [s.get("reason") for s in stopped]
        failures.append(f"session_stopped reasons {reasons} != ['signal']")
    if not sess.events("SESSION_END"):
        failures.append("no SESSION_END event on signal stop")
    evidence.append(f"exit={code} reasons={[s.get('reason') for s in stopped]}")
    return _finish("f: SIGTERM graceful stop", failures, evidence)


def scenario_g(binary: Path) -> tuple[str, bool, list[str]]:
    """queue 5 + grid 80x48 + 30 fps: droppedTotal > 0 and the pipeline keeps
    running (framesProcessed still climbing), graceful stop afterwards."""
    failures: list[str] = []
    evidence: list[str] = []
    args = base_args(
        **{
            "session-id": "smoke-g",
            "stream-id": "smoke-g",
            "queue-capacity": "5",
            "grid": "80x48",
            "target-fps": "30",
        }
    )
    sess = EngineSession(binary, args, "g")
    # Watch it run for ~8 s without any stop command.
    time.sleep(8.0)
    mid = sess.of_type("metrics")
    time.sleep(1.0)
    late = sess.of_type("metrics")
    sess.send("stop")
    code = sess.wait(timeout=15)
    failures.extend(sess.protocol_failures())
    if code != 0:
        failures.append(f"exit code {code!r} != 0")

    metrics = sess.of_type("metrics")
    if not metrics:
        failures.append("no metrics lines")
    else:
        last = metrics[-1]
        if last.get("droppedTotal", 0) <= 0:
            failures.append(f"droppedTotal stayed 0 under load (last: {json.dumps(last)[:160]})")
        if last.get("queueCapacity") != 5:
            failures.append(f"queueCapacity {last.get('queueCapacity')} != 5")
        fp = [m.get("framesProcessed", 0) for m in metrics]
        if len(fp) >= 2 and fp[-1] <= fp[0]:
            failures.append(f"framesProcessed did not increase: first={fp[0]} last={fp[-1]}")
        if len(mid) and len(late) and late[-1].get("framesProcessed", 0) <= mid[-1].get("framesProcessed", 0):
            failures.append("pipeline stalled mid-run (framesProcessed frozen)")

    stopped = sess.of_type("session_stopped")
    if len(stopped) != 1 or stopped[0].get("reason") != "user_stop":
        reasons = [s.get("reason") for s in stopped]
        failures.append(f"session_stopped reasons {reasons} != ['user_stop']")

    if metrics:
        m = metrics[-1]
        evidence.append(
            "last metrics: srcFps={:.3f} procFps={:.3f} avgMs={:.3f} queue={}/{} "
            "dropped={} frames={}".format(
                m.get("sourceFps", 0), m.get("processedFps", 0),
                m.get("latency", {}).get("avgMs", 0), m.get("queueDepth", -1),
                m.get("queueCapacity", -1), m.get("droppedTotal", -1),
                m.get("framesProcessed", -1),
            )
        )
    evidence.append(f"states seen: {[s.get('state') for s in sess.of_type('state')]}")
    evidence.append(f"exit={code}")
    return _finish("g: queue 5 + grid 80x48 + 30fps drops", failures, evidence)


def _wait_for(sess: EngineSession, predicate: Callable[[], bool], timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


SCENARIOS: dict[str, Callable[[Path], tuple[str, bool, list[str]]]] = {
    "a": scenario_a,
    "b": scenario_b,
    "c": scenario_c,
    "d": scenario_d,
    "e": scenario_e,
    "f": scenario_f,
    "g": scenario_g,
}


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def run_suite(binary: Path, only: list[str] | None, run_index: int) -> int:
    selected = only or list(SCENARIOS.keys())
    failed = 0
    print(f"=== engine smoke suite — run #{run_index} — binary {binary} ===")
    t0 = time.time()
    for key in selected:
        runner = SCENARIOS[key]
        try:
            name, passed, report = runner(binary)
        except Exception as exc:  # noqa: BLE001 — harness must never crash
            name, passed, report = f"{key}: (harness error)", False, [f"  FAILURE: {exc!r}"]
        status = "PASS" if passed else "FAIL"
        print(f"[{status}] scenario {name}")
        for line in report:
            print(line)
        if not passed:
            failed += 1
    dt = time.time() - t0
    print(f"=== run #{run_index}: {len(selected) - failed}/{len(selected)} passed "
          f"in {dt:.1f}s ===\n")
    return failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--binary", default=str(DEFAULT_BIN), help="engine binary path"
    )
    parser.add_argument(
        "--only", nargs="*", choices=SCENARIOS.keys(), help="run a subset of scenarios"
    )
    parser.add_argument(
        "--repeat", type=int, default=1, help="run the whole suite N times"
    )
    opts = parser.parse_args()

    binary = Path(opts.binary).resolve()
    if not binary.is_file():
        print(f"FAIL: engine binary not found: {binary}", file=sys.stderr)
        return 1
    if not binary.stat().st_mode & 0o111:
        print(f"FAIL: engine binary is not executable: {binary}", file=sys.stderr)
        return 1

    total_failed = 0
    for i in range(1, opts.repeat + 1):
        total_failed += run_suite(binary, opts.only, i)
    if total_failed == 0:
        print(f"ALL GREEN ({opts.repeat} consecutive run(s))")
    else:
        print(f"{total_failed} scenario run(s) FAILED")
    return total_failed


if __name__ == "__main__":
    sys.exit(main())
