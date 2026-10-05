# EdgeVision — سرویس مرجع API (FastAPI)
# Copyright © 2026 Parsa Fathi — Apache-2.0
"""EdgeVision reference REST API (FastAPI).

یک پیاده‌سازی مرجعِ همان سطح REST نسخهٔ ۱ روی همان پایگاه‌دادهٔ SQLite:
— خواندن‌ها مستقیماً از db/custom.db با sqlite3 استاندارد (حالت فقط‌خواندنی)
— نوشتن‌ها با اعتبارسنجی pydantic و ارجاع به API داخلی engine-service
  (127.0.0.1:3003 با هدر x-internal-token) — همان کاری که لایهٔ Next.js می‌کند.

لایهٔ اصلیِ سرویده‌شده در این استقرار همان Next.js است؛ این سرویس مرجع
است و بلادرنگ (socket.io روی پورت ۳۰۰۳) را بازتولید نمی‌کند.

نکته: پاسخ‌های DateTime در قالب ISO-8601 UTC (مثل "2026-10-05T06:15:53.599Z")
هستند که با قراردادِ نوشته‌شده توسط engine-service مطابق است؛ پارامترهای
زمانی هم ISO یا epoch-ms/epoch-s را می‌پذیرند (مثل لایهٔ Next).
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

# ---------------------------------------------------------------------------
# پیکربندی
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.environ.get("EV_DB_PATH", str(_REPO_ROOT / "db" / "custom.db")))
ENGINE_BASE = os.environ.get("EV_ENGINE_SERVICE_URL", "http://127.0.0.1:3003").rstrip("/")
INTERNAL_TOKEN = os.environ.get("EV_INTERNAL_TOKEN", "edgevision-local")
FORWARD_TIMEOUT_S = float(os.environ.get("EV_FORWARD_TIMEOUT_S", "5"))

API = "/api/v1"
VERSION = "1.0.0"
STARTED_AT = time.time()

SCENES = ("STREET", "INTERSECTION", "PARKING")
CLASSES = ("PEDESTRIAN", "VEHICLE", "CYCLIST")
EVENT_TYPES = ("LINE_CROSS", "ROI_ENTER", "ROI_EXIT", "SESSION_END", "ERROR", "STATE_CHANGE")
BUCKETS: dict[str, int] = {"1s": 1, "5s": 5, "30s": 30, "1m": 60}

# آغاز کار سرویس — خط گزارش راه‌اندازی در lifespan نوشته می‌شود.


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> Iterator[None]:
    print(
        f"[api-python] EdgeVision reference API v{VERSION} starting: "
        f"db={DB_PATH} (read-only), engine-service={ENGINE_BASE}",
        flush=True,
    )
    yield


app = FastAPI(
    title="EdgeVision reference API",
    description="پیاده‌سازی مرجع FastAPI از سطح /api/v1 روی همان SQLite",
    version=VERSION,
    lifespan=_lifespan,
    docs_url="/docs",
)


# ---------------------------------------------------------------------------
# پوشش خطای مشترک {error: {code, message, details?}} — پیام‌های فارسی
# ---------------------------------------------------------------------------


class ApiError(Exception):
    """خطای API با پوشش استاندارد — status و code و پیام فارسی."""

    def __init__(self, status: int, code: str, message: str, details: list[str] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details

    def envelope(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            error["details"] = self.details
        return {"error": error}


def _error_response(exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content=exc.envelope())


def validation_error(details: list[str]) -> ApiError:
    return ApiError(400, "VALIDATION", "داده‌های ورودی نامعتبر است", details)


def not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", "موردی یافت نشد")


def engine_down() -> ApiError:
    return ApiError(503, "ENGINE_DOWN", "سرویس پردازش در دسترس نیست")


def internal_error() -> ApiError:
    return ApiError(500, "INTERNAL", "خطای داخلی سرور")


@app.exception_handler(ApiError)
async def _api_error_handler(_req: Request, exc: ApiError) -> JSONResponse:
    return _error_response(exc)


@app.exception_handler(RequestValidationError)
async def _validation_handler(_req: Request, exc: RequestValidationError) -> JSONResponse:
    """خطاهای اعتبارسنجی pydantic → پوشش 400 VALIDATION با جزئیات فارسی.

    پیام‌های فارسیِ رسیده از field_validator ها عیناً حفظ می‌شوند؛ خطاهای
    عمومی (نبود فیلد/نوع نادرست) به «فیلد … الزامی است» / «مقدار فیلد …
    نامعتبر است» ترجمه می‌شوند — همان رفتار لایهٔ Next.
    """
    details: list[str] = []
    for err in exc.errors():
        loc_parts = [str(p) for p in err.get("loc", ())]
        if loc_parts and loc_parts[0] == "body":  # پیشوند بدنه حذف می‌شود
            loc_parts = loc_parts[1:]
        loc = ".".join(loc_parts)
        if err.get("type") == "json_invalid":
            return _error_response(
                ApiError(400, "INVALID_JSON", "بدنه درخواست باید JSON معتبر باشد")
            )
        msg = str(err.get("msg", ""))
        if msg.startswith("Value error, "):
            details.append(msg[len("Value error, "):])
        elif err.get("type") == "missing":
            details.append(f"فیلد {loc or '?'} الزامی است")
        else:
            details.append(f"مقدار فیلد {loc or '?'} نامعتبر است")
    return _error_response(validation_error(details))


@app.exception_handler(StarletteHTTPException)
async def _http_error_handler(_req: Request, exc: StarletteHTTPException) -> JSONResponse:
    if exc.status_code == 404:
        return _error_response(not_found())
    if exc.status_code == 405:
        return _error_response(ApiError(405, "METHOD_NOT_ALLOWED", "متد مجاز نیست"))
    return _error_response(
        ApiError(exc.status_code, "HTTP_ERROR", f"درخواست با خطای {exc.status_code} ناکام ماند")
    )


@app.exception_handler(Exception)
async def _unhandled_handler(_req: Request, _exc: Exception) -> JSONResponse:
    return _error_response(internal_error())


# ---------------------------------------------------------------------------
# دسترسی فقط‌خواندنی به SQLite
# ---------------------------------------------------------------------------


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    """اتصال فقط‌خواندنی به پایگاه‌داده (حالت URI ro) با row_factory."""
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def fetch_all(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    return conn.execute(sql, params).fetchall()


def fetch_one(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    return conn.execute(sql, params).fetchone()


class Where:
    """سازندهٔ شرط WHERE با پارامترهای مقیدشده (بدون تزریق رشته)."""

    def __init__(self) -> None:
        self.conds: list[str] = []
        self.params: list[Any] = []

    def eq(self, column: str, value: Any) -> None:
        self.conds.append(f'"{column}" = ?')
        self.params.append(value)

    def gte(self, column: str, value: Any) -> None:
        self.conds.append(f'"{column}" >= ?')
        self.params.append(value)

    def lte(self, column: str, value: Any) -> None:
        self.conds.append(f'"{column}" <= ?')
        self.params.append(value)

    def raw(self, cond: str, value: Any) -> None:
        self.conds.append(cond)
        self.params.append(value)

    def time_range(self, column: str, from_iso: str | None, to_iso: str | None) -> None:
        if from_iso:
            self.gte(column, from_iso)
        if to_iso:
            self.lte(column, to_iso)

    def sql(self) -> str:
        return ("WHERE " + " AND ".join(self.conds)) if self.conds else ""

    def args(self) -> tuple[Any, ...]:
        return tuple(self.params)


# ---------------------------------------------------------------------------
# ارجاع نوشتن‌ها به engine-service (API داخلی)
# ---------------------------------------------------------------------------


class InternalResult:
    __slots__ = ("ok", "status", "data")

    def __init__(self, ok: bool, status: int, data: dict[str, Any]):
        self.ok = ok
        self.status = status
        self.data = data


def internal_fetch(path: str, method: str = "GET", body: Any = None,
                   timeout: float = FORWARD_TIMEOUT_S) -> InternalResult:
    """فراخوانی /internal/* با توکن داخلی؛ هرگز exception پرتاب نمی‌کند."""
    url = f"{ENGINE_BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"x-internal-token": INTERNAL_TOKEN, "accept": "application/json"}
    if data is not None:
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            parsed = json.loads(raw) if raw.strip() else {}
            return InternalResult(True, resp.status, parsed if isinstance(parsed, dict) else {})
    except urllib.error.HTTPError as err:
        try:
            raw = err.read().decode("utf-8", "replace")
            parsed = json.loads(raw) if raw.strip() else {}
        except Exception:  # noqa: BLE001 — بدنهٔ غیر JSON سرویس
            parsed = {}
        return InternalResult(False, err.code, parsed if isinstance(parsed, dict) else {})
    except Exception:  # noqa: BLE001 — شبکه/تایم‌اوت/قطع سرویس
        return InternalResult(False, 503, {"code": "ENGINE_DOWN", "message": "سرویس پردازش در دسترس نیست"})


def forward_error(res: InternalResult) -> ApiError:
    """بازتاب خطای سرویس پردازش در پوشش خطای عمومی (مثل errors.ts)."""
    if res.status == 400:
        details = res.data.get("details")
        message = res.data.get("message")
        return ApiError(
            400,
            "VALIDATION",
            message if isinstance(message, str) else "داده‌های ورودی نامعتبر است",
            details if isinstance(details, list) else None,
        )
    code = res.data.get("code")
    message = res.data.get("message")
    details = res.data.get("details")
    return ApiError(
        res.status if res.status else 502,
        code if isinstance(code, str) else "ENGINE_ERROR",
        message if isinstance(message, str) else "سرویس پردازش درخواست را نپذیرفت",
        details if isinstance(details, list) else None,
    )


# — — — snapshot نشست‌های فعال با کش ۲ ثانیه‌ای (مثل snapshot.ts) — — —

_snapshot_lock = threading.Lock()
_snapshot_cache: dict[str, Any] = {"at": 0.0, "sessions": []}


def get_snapshot(force: bool = False) -> list[dict[str, Any]]:
    with _snapshot_lock:
        if not force and time.time() - _snapshot_cache["at"] < 2.0:
            return _snapshot_cache["sessions"]
    res = internal_fetch("/internal/snapshot", timeout=2.0)
    sessions = [s for s in (res.data.get("sessions") or []) if isinstance(s, dict) and isinstance(s.get("streamId"), str)] if res.ok else []
    with _snapshot_lock:
        _snapshot_cache["at"] = time.time()
        _snapshot_cache["sessions"] = sessions
    return sessions


def active_session_for(stream_id: str) -> dict[str, Any] | None:
    return next((s for s in get_snapshot() if s.get("streamId") == stream_id), None)


# ---------------------------------------------------------------------------
# پارامترهای زمانی و صفحه‌بندی (همان رفتار لایهٔ Next)
# ---------------------------------------------------------------------------

_EPOCH_MS_RE = re.compile(r"^\d{10,}$")
_EPOCH_S_RE = re.compile(r"^\d{1,9}$")


def parse_time_param(value: str | None, name: str) -> tuple[str | None, str | None]:
    """«(iso, خطای فارسی)» — ISO یا epoch-ms/epoch-s؛ None یعنی بدون فیلتر."""
    if value is None or not value.strip():
        return None, None
    v = value.strip()
    try:
        if _EPOCH_MS_RE.match(v):
            dt = datetime.fromtimestamp(int(v) / 1000, tz=timezone.utc)
        elif _EPOCH_S_RE.match(v):
            dt = datetime.fromtimestamp(int(v), tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None, f"پارامتر {name} باید تاریخ ISO یا میلی‌ثانیه باشد"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), None


def time_pair(from_raw: str | None, to_raw: str | None) -> tuple[str | None, str | None, list[str]]:
    errors: list[str] = []
    from_iso, err = parse_time_param(from_raw, "from")
    if err:
        errors.append(err)
    to_iso, err = parse_time_param(to_raw, "to")
    if err:
        errors.append(err)
    return from_iso, to_iso, errors


def int_or(value: str | None, fallback: int) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return fallback


def page_params(page_raw: str | None, size_raw: str | None) -> tuple[int, int]:
    page = max(1, int_or(page_raw, 1))
    size = int_or(size_raw, 25)
    if size < 1:
        size = 25
    size = min(200, size)
    return page, size


def _paged(items: list[dict[str, Any]], total: int, page: int, size: int) -> dict[str, Any]:
    return {"items": items, "total": total, "page": page, "pageSize": size}


# ---------------------------------------------------------------------------
# مدل‌های pydantic — همان دامنه‌های zod/validate با پیام‌های فارسی
# ---------------------------------------------------------------------------


class RoiModel(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0, le=1)
    h: float = Field(ge=0, le=1)

    @field_validator("w", "h")
    @classmethod
    def _positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("عرض و ارتفاع ROI باید بزرگ‌تر از صفر باشد")
        return v


class LineModel(BaseModel):
    x1: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)
    x2: float = Field(ge=0, le=1)
    y2: float = Field(ge=0, le=1)


class _StreamFieldValidators(BaseModel):
    """اعتبارسنج‌های مشترک فیلدهای استریم (پیام‌های فارسی، همان دامنه‌های
    schemas.ts/validate.ts). با check_fields=False به‌عنوان mixin استفاده
    می‌شود؛ مقدار None (حالت PATCH) بی‌گذر رد می‌شود."""

    @field_validator("name", check_fields=False)
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not (1 <= len(v) <= 80):
            raise ValueError("نام استریم باید بین 1 و 80 نویسه باشد")
        return v

    @field_validator("scene", check_fields=False)
    @classmethod
    def _scene(cls, v: str | None) -> str | None:
        if v is not None and v not in SCENES:
            raise ValueError("صحنه باید یکی از STREET، INTERSECTION یا PARKING باشد")
        return v

    @field_validator("width", check_fields=False)
    @classmethod
    def _width(cls, v: int | None) -> int | None:
        if v is not None and not (320 <= v <= 1920):
            raise ValueError("عرض تصویر باید بین 320 و 1920 باشد")
        return v

    @field_validator("height", check_fields=False)
    @classmethod
    def _height(cls, v: int | None) -> int | None:
        if v is not None and not (240 <= v <= 1080):
            raise ValueError("ارتفاع تصویر باید بین 240 و 1080 باشد")
        return v

    @field_validator("targetFps", check_fields=False)
    @classmethod
    def _fps(cls, v: float | None) -> float | None:
        if v is not None and not (1 <= v <= 30):
            raise ValueError("نرخ فریم باید بین 1 و 30 باشد")
        return v

    @field_validator("objectCount", check_fields=False)
    @classmethod
    def _objects(cls, v: int | None) -> int | None:
        if v is not None and not (3 <= v <= 20):
            raise ValueError("تعداد اشیا باید بین 3 و 20 باشد")
        return v

    @field_validator("confidenceThreshold", check_fields=False)
    @classmethod
    def _conf(cls, v: float | None) -> float | None:
        if v is not None and not (0.05 <= v <= 0.95):
            raise ValueError("آستانه اطمینان باید بین 0.05 و 0.95 باشد")
        return v

    @field_validator("classFilter", check_fields=False)
    @classmethod
    def _classes(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        for c in v:
            if c not in CLASSES:
                raise ValueError("فیلتر کلاس فقط می‌تواند شامل PEDESTRIAN، VEHICLE یا CYCLIST باشد")
        return list(dict.fromkeys(v))

    @field_validator("queueCapacity", check_fields=False)
    @classmethod
    def _queue(cls, v: int | None) -> int | None:
        if v is not None and not (5 <= v <= 200):
            raise ValueError("ظرفیت صف باید بین 5 و 200 باشد")
        return v

    @field_validator("gridCols", check_fields=False)
    @classmethod
    def _cols(cls, v: int | None) -> int | None:
        if v is not None and not (16 <= v <= 80):
            raise ValueError("ستون‌های شبکه باید بین 16 و 80 باشد")
        return v

    @field_validator("gridRows", check_fields=False)
    @classmethod
    def _rows(cls, v: int | None) -> int | None:
        if v is not None and not (9 <= v <= 48):
            raise ValueError("سطرهای شبکه باید بین 9 و 48 باشد")
        return v

    @field_validator("emitStride", check_fields=False)
    @classmethod
    def _stride(cls, v: int | None) -> int | None:
        if v is not None and not (1 <= v <= 10):
            raise ValueError("گام انتشار فریم باید بین 1 و 10 باشد")
        return v


class StreamCreateModel(_StreamFieldValidators):
    """بدنهٔ POST /streams — فیلدهای الزامی مثل schemas.ts."""

    name: str
    scene: str
    width: int
    height: int
    targetFps: float
    objectCount: int
    confidenceThreshold: float
    classFilter: list[str] = Field(default_factory=list)
    roi: RoiModel | None = None
    line: LineModel | None = None
    queueCapacity: int
    gridCols: int
    gridRows: int
    emitStride: int


class StreamPatchModel(_StreamFieldValidators):
    """بدنهٔ PATCH /streams/:id — همهٔ فیلدها اختیاری."""

    name: str | None = None
    scene: str | None = None
    width: int | None = None
    height: int | None = None
    targetFps: float | None = None
    objectCount: int | None = None
    confidenceThreshold: float | None = None
    classFilter: list[str] | None = None
    roi: RoiModel | None = None
    line: LineModel | None = None
    queueCapacity: int | None = None
    gridCols: int | None = None
    gridRows: int | None = None
    emitStride: int | None = None


class ModelCreateModel(BaseModel):
    """بدنهٔ POST /models."""

    name: str
    inputShape: str
    classesJson: list[str]
    task: str | None = Field(default=None, max_length=40)
    format: str | None = Field(default=None, max_length=40)
    device: str | None = Field(default=None, max_length=40)
    sizeBytes: int | None = None
    license: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=300)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not (1 <= len(v) <= 80):
            raise ValueError("نام مدل باید بین 1 و 80 نویسه باشد")
        return v

    @field_validator("inputShape")
    @classmethod
    def _shape(cls, v: str) -> str:
        v = v.strip()
        if not (1 <= len(v) <= 40):
            raise ValueError("شکل ورودی مدل نامعتبر است")
        return v

    @field_validator("classesJson")
    @classmethod
    def _classes(cls, v: list[str]) -> list[str]:
        if not (1 <= len(v) <= 20):
            raise ValueError("لیست کلاس‌ها باید آرایه‌ای بین 1 و 20 عضو باشد")
        for c in v:
            if not (1 <= len(c.strip()) <= 40):
                raise ValueError("نام کلاس‌ها باید رشته‌ای بین 1 و 40 نویسه باشد")
        return [c.strip() for c in v]

    @field_validator("sizeBytes")
    @classmethod
    def _size(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("حجم مدل باید عدد صحیح نامنفی باشد")
        return v


class ModelActivateModel(BaseModel):
    isActive: bool


class SettingsPatchModel(BaseModel):
    """بدنهٔ PATCH /settings — بازه‌های همان SETTINGS_RANGES."""

    defaultGridCols: int | None = None
    defaultGridRows: int | None = None
    defaultQueueCapacity: int | None = None
    defaultEmitStride: int | None = None

    @field_validator("defaultGridCols")
    @classmethod
    def _cols(cls, v: int | None) -> int | None:
        if v is not None and not (16 <= v <= 80):
            raise ValueError("ستون‌های شبکه باید بین 16 و 80 باشد")
        return v

    @field_validator("defaultGridRows")
    @classmethod
    def _rows(cls, v: int | None) -> int | None:
        if v is not None and not (9 <= v <= 48):
            raise ValueError("سطرهای شبکه باید بین 9 و 48 باشد")
        return v

    @field_validator("defaultQueueCapacity")
    @classmethod
    def _queue(cls, v: int | None) -> int | None:
        if v is not None and not (5 <= v <= 200):
            raise ValueError("ظرفیت صف باید بین 5 و 200 باشد")
        return v

    @field_validator("defaultEmitStride")
    @classmethod
    def _stride(cls, v: int | None) -> int | None:
        if v is not None and not (1 <= v <= 10):
            raise ValueError("گام انتشار فریم باید بین 1 و 10 باشد")
        return v


# ---------------------------------------------------------------------------
# مبدل ردیف → شکل API (camelCase، مثل Prisma/streamRowToApi)
# ---------------------------------------------------------------------------


def row_to_stream(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "scene": row["scene"],
        "sourceType": row["source_type"],
        "width": row["width"],
        "height": row["height"],
        "targetFps": row["target_fps"],
        "objectCount": row["object_count"],
        "confidenceThreshold": row["confidence_threshold"],
        "classFilterJson": row["class_filter_json"],
        "roiJson": row["roi_json"],
        "lineJson": row["line_json"],
        "queueCapacity": row["queue_capacity"],
        "gridCols": row["grid_cols"],
        "gridRows": row["grid_rows"],
        "emitStride": row["emit_stride"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def row_to_model(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "task": row["task"],
        "format": row["format"],
        "device": row["device"],
        "inputShape": row["input_shape"],
        "classesJson": row["classes_json"],
        "sizeBytes": row["size_bytes"],
        "license": row["license"],
        "description": row["description"],
        "isActive": bool(row["is_active"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def row_to_metric(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "sessionId": row["session_id"],
        "streamId": row["stream_id"],
        "ts": row["ts"],
        "sourceFps": row["source_fps"],
        "processedFps": row["processed_fps"],
        "latencyAvgMs": row["latency_avg_ms"],
        "latencyMinMs": row["latency_min_ms"],
        "latencyMaxMs": row["latency_max_ms"],
        "latencyP50Ms": row["latency_p50_ms"],
        "latencyP95Ms": row["latency_p95_ms"],
        "queueDepth": row["queue_depth"],
        "droppedTotal": row["dropped_total"],
        "cpuPercent": row["cpu_percent"],
        "memoryMb": row["memory_mb"],
        "framesProcessed": row["frames_processed"],
        "detectionsTotal": row["detections_total"],
    }


def get_stream_row(conn: sqlite3.Connection, stream_id: str) -> sqlite3.Row | None:
    return fetch_one(conn, 'SELECT * FROM streams WHERE "id" = ?', (stream_id,))


def get_model_row(conn: sqlite3.Connection, model_id: str) -> sqlite3.Row | None:
    return fetch_one(conn, 'SELECT * FROM models WHERE "id" = ?', (model_id,))


def _model_dump(model: BaseModel) -> dict[str, Any]:
    """dict با حذف فیلدهای None (PATCH فقط فیلدهای موجود را می‌فرستد)."""
    return {k: v for k, v in model.model_dump().items() if v is not None}


# ---------------------------------------------------------------------------
# سلامت سامانه
# ---------------------------------------------------------------------------


@app.get(f"{API}/health")
def health() -> dict[str, Any]:
    db_ok = False
    try:
        with db() as conn:
            conn.execute("SELECT 1").fetchone()
        db_ok = True
    except sqlite3.Error:
        db_ok = False
    engine = internal_fetch("/internal/health", timeout=2.5)
    engine_ok = engine.ok and engine.data.get("ok") is not False
    return {
        "status": "ok" if db_ok and engine_ok else "degraded",
        "db": db_ok,
        "engine": engine_ok,
        "engineBinary": bool(engine.data.get("engineBinary")) if engine_ok else False,
        "activeSessions": engine.data.get("activeSessions", 0) if engine_ok else 0,
        "version": VERSION,
        "uptimeSec": int(time.time() - STARTED_AT),
    }


# ---------------------------------------------------------------------------
# استریم‌ها — خواندن از SQLite، نوشتن با ارجاع به سرویس پردازش
# ---------------------------------------------------------------------------


@app.get(f"{API}/streams")
def list_streams() -> dict[str, Any]:
    with db() as conn:
        rows = fetch_all(conn, 'SELECT * FROM streams ORDER BY "created_at" ASC')
    sessions = {s["streamId"]: s for s in get_snapshot()}
    items = [{**row_to_stream(r), "activeSession": sessions.get(r["id"])} for r in rows]
    return {"items": items}


@app.post(f"{API}/streams", status_code=201)
def create_stream(body: StreamCreateModel) -> dict[str, Any]:
    payload = _model_dump(body)
    res = internal_fetch("/internal/streams", method="POST", body=payload)
    if not res.ok:
        raise forward_error(res)
    stream_id = res.data.get("id")
    with db() as conn:
        row = get_stream_row(conn, stream_id) if isinstance(stream_id, str) else None
    if row is None:
        raise validation_error([])
    return {**row_to_stream(row), "activeSession": None}


@app.get(f"{API}/streams/{{stream_id}}")
def get_stream(stream_id: str) -> dict[str, Any]:
    with db() as conn:
        row = get_stream_row(conn, stream_id)
        latest = fetch_one(
            conn,
            'SELECT * FROM metrics WHERE "stream_id" = ? ORDER BY "ts" DESC, "id" DESC LIMIT 1',
            (stream_id,),
        )
    if row is None:
        raise not_found()
    return {
        **row_to_stream(row),
        "activeSession": active_session_for(stream_id),
        "latestMetric": row_to_metric(latest) if latest is not None else None,
    }


@app.patch(f"{API}/streams/{{stream_id}}")
def patch_stream(stream_id: str, body: StreamPatchModel) -> dict[str, Any]:
    payload = _model_dump(body)
    res = internal_fetch(f"/internal/streams/{stream_id}", method="PATCH", body=payload)
    if not res.ok:
        raise forward_error(res)
    with db() as conn:
        row = get_stream_row(conn, stream_id)
    if row is None:
        raise not_found()
    return {**row_to_stream(row), "activeSession": None}


@app.delete(f"{API}/streams/{{stream_id}}")
def delete_stream(stream_id: str) -> dict[str, Any]:
    res = internal_fetch(f"/internal/streams/{stream_id}", method="DELETE")
    if not res.ok:
        raise forward_error(res)
    return {"ok": True}


@app.post(f"{API}/streams/{{stream_id}}/start")
def start_stream(stream_id: str) -> dict[str, Any]:
    res = internal_fetch(f"/internal/streams/{stream_id}/start", method="POST", body={})
    if not res.ok:
        raise forward_error(res)
    return {"session": res.data.get("session")}


@app.post(f"{API}/streams/{{stream_id}}/stop")
def stop_stream(stream_id: str) -> dict[str, Any]:
    res = internal_fetch(f"/internal/streams/{stream_id}/stop", method="POST", body={})
    if not res.ok:
        raise forward_error(res)
    return {"session": res.data.get("session")}


# ---------------------------------------------------------------------------
# تشخیص‌ها
# ---------------------------------------------------------------------------


@app.get(f"{API}/detections")
def list_detections(
    streamId: str | None = Query(default=None),
    sessionId: str | None = Query(default=None),
    label: str | None = Query(default=None),
    minConfidence: float | None = Query(default=None),
    trackId: int | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    page: str | None = Query(default=None),
    pageSize: str | None = Query(default=None),
    sort: str = Query(default="ts"),
    order: str = Query(default="desc"),
) -> dict[str, Any]:
    if minConfidence is not None and (minConfidence < 0 or minConfidence > 1):
        raise validation_error(["حداقل اطمینان باید عددی بین 0 و 1 باشد"])
    from_iso, to_iso, errors = time_pair(from_, to)
    if errors:
        raise validation_error(errors)
    page_no, size = page_params(page, pageSize)
    sort_col = "confidence" if sort == "confidence" else "ts"
    direction = "ASC" if order == "asc" else "DESC"

    where = Where()
    if streamId:
        where.eq("stream_id", streamId)
    if sessionId:
        where.eq("session_id", sessionId)
    if label:
        where.eq("label", label)
    if trackId is not None:
        where.eq("track_id", trackId)
    if minConfidence is not None:
        where.raw('"confidence" >= ?', minConfidence)
    where.time_range("ts", from_iso, to_iso)

    with db() as conn:
        rows = fetch_all(
            conn,
            f'SELECT "id", "session_id", "stream_id", "frame_index", "ts", "label",'
            f' "confidence", "track_id", "x", "y", "w", "h" FROM detections'
            f' {where.sql()} ORDER BY "{sort_col}" {direction}, "id" {direction}'
            f' LIMIT ? OFFSET ?',
            where.args() + (size, (page_no - 1) * size),
        )
        total = fetch_one(conn, f'SELECT COUNT(*) AS total FROM detections {where.sql()}', where.args())["total"]

    items = [
        {
            "id": r["id"],
            "sessionId": r["session_id"],
            "streamId": r["stream_id"],
            "frameIndex": r["frame_index"],
            "ts": r["ts"],
            "label": r["label"],
            "confidence": r["confidence"],
            "trackId": r["track_id"],
            "x": r["x"],
            "y": r["y"],
            "w": r["w"],
            "h": r["h"],
        }
        for r in rows
    ]
    return _paged(items, int(total), page_no, size)


@app.get(f"{API}/detections/labels")
def detection_labels(
    streamId: str | None = Query(default=None),
    sessionId: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    where = Where()
    if streamId:
        where.eq("stream_id", streamId)
    if sessionId:
        where.eq("session_id", sessionId)
    with db() as conn:
        rows = fetch_all(
            conn,
            f'SELECT "label", COUNT(*) AS count FROM detections {where.sql()} GROUP BY "label"',
            where.args(),
        )
    items = sorted(({"label": r["label"], "count": int(r["count"])} for r in rows), key=lambda i: -i["count"])
    return items


# ---------------------------------------------------------------------------
# رویدادها
# ---------------------------------------------------------------------------


@app.get(f"{API}/events")
def list_events(
    streamId: str | None = Query(default=None),
    type: str | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    page: str | None = Query(default=None),
    pageSize: str | None = Query(default=None),
) -> dict[str, Any]:
    if type is not None and type not in EVENT_TYPES:
        raise validation_error([f"نوع رویداد باید یکی از {'، '.join(EVENT_TYPES)} باشد"])
    from_iso, to_iso, errors = time_pair(from_, to)
    if errors:
        raise validation_error(errors)
    page_no, size = page_params(page, pageSize)

    where = Where()
    if streamId:
        where.eq("stream_id", streamId)
    if type:
        where.eq("type", type)
    where.time_range("ts", from_iso, to_iso)

    with db() as conn:
        rows = fetch_all(
            conn,
            f'SELECT "id", "session_id", "stream_id", "type", "track_id", "label",'
            f' "payload_json", "ts", "created_at" FROM events'
            f' {where.sql()} ORDER BY "ts" DESC, "id" DESC LIMIT ? OFFSET ?',
            where.args() + (size, (page_no - 1) * size),
        )
        total = fetch_one(conn, f'SELECT COUNT(*) AS total FROM events {where.sql()}', where.args())["total"]

    items = []
    for r in rows:
        try:
            payload: Any = json.loads(r["payload_json"])
        except (TypeError, ValueError):
            payload = r["payload_json"]
        items.append(
            {
                "id": r["id"],
                "sessionId": r["session_id"],
                "streamId": r["stream_id"],
                "type": r["type"],
                "trackId": r["track_id"],
                "label": r["label"],
                "payload": payload,
                "ts": r["ts"],
                "createdAt": r["created_at"],
            }
        )
    return _paged(items, int(total), page_no, size)


# ---------------------------------------------------------------------------
# متریک‌ها — بازه‌بندی strftime + حالت زنده
# ---------------------------------------------------------------------------


@app.get(f"{API}/metrics")
def metrics(
    streamId: str | None = Query(default=None),
    sessionId: str | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    bucket: str = Query(default="30s"),
    live: str | None = Query(default=None),
) -> dict[str, Any]:
    if live == "1":
        sessions = get_snapshot(force=True)
        with db() as conn:
            items = []
            for s in sessions:
                latest = fetch_one(
                    conn,
                    'SELECT * FROM metrics WHERE "session_id" = ? ORDER BY "ts" DESC, "id" DESC LIMIT 1',
                    (s.get("sessionId"),),
                )
                items.append({**s, "metric": row_to_metric(latest) if latest is not None else None})
        return {"live": True, "sessions": items}

    if bucket not in BUCKETS:
        raise validation_error(["بازه‌بندی باید یکی از 1s، 5s، 30s یا 1m باشد"])
    bucket_sec = BUCKETS[bucket]
    from_iso, to_iso, errors = time_pair(from_, to)
    if errors:
        raise validation_error(errors)

    where = Where()
    if streamId:
        where.eq("stream_id", streamId)
    if sessionId:
        where.eq("session_id", sessionId)
    where.time_range("ts", from_iso, to_iso)

    bucket_sql = (
        "(CAST(strftime('%s', ts) AS INTEGER) / CAST(? AS INTEGER)) * CAST(? AS INTEGER)"
    )
    with db() as conn:
        bucket_rows = fetch_all(
            conn,
            f"SELECT {bucket_sql} AS bucketSec, COUNT(*) AS samples,"
            f' AVG("source_fps") AS avgSourceFps, AVG("processed_fps") AS avgProcessedFps,'
            f' AVG("latency_avg_ms") AS avgLatencyMs, MAX("queue_depth") AS maxQueueDepth,'
            f' AVG("dropped_total") AS avgDropped, AVG("cpu_percent") AS avgCpuPercent,'
            f' AVG("memory_mb") AS avgMemoryMb'
            f" FROM metrics {where.sql()} GROUP BY bucketSec ORDER BY bucketSec ASC",
            (bucket_sec, bucket_sec) + where.args(),
        )
        summary_row = fetch_one(
            conn,
            f'SELECT COUNT(*) AS samples, AVG("source_fps") AS avgSourceFps,'
            f' AVG("processed_fps") AS avgProcessedFps, AVG("latency_avg_ms") AS avgLatencyMs,'
            f' MIN("latency_min_ms") AS minLatencyMs, MAX("latency_max_ms") AS maxLatencyMs,'
            f' MAX("queue_depth") AS maxQueueDepth, MAX("dropped_total") AS maxDropped,'
            f' AVG("cpu_percent") AS avgCpuPercent, AVG("memory_mb") AS avgMemoryMb,'
            f' MAX("frames_processed") AS maxFramesProcessed, MAX("detections_total") AS maxDetections'
            f" FROM metrics {where.sql()}",
            where.args(),
        )

    buckets = [
        {
            "ts": int(r["bucketSec"]) * 1000,
            "samples": int(r["samples"]),
            "avgSourceFps": r["avgSourceFps"] or 0,
            "avgProcessedFps": r["avgProcessedFps"] or 0,
            "avgLatencyMs": r["avgLatencyMs"] or 0,
            "maxQueueDepth": int(r["maxQueueDepth"] or 0),
            "avgDropped": r["avgDropped"] or 0,
            "avgCpuPercent": r["avgCpuPercent"] or 0,
            "avgMemoryMb": r["avgMemoryMb"] or 0,
        }
        for r in bucket_rows
    ]
    summary = {
        "samples": int(summary_row["samples"] or 0) if summary_row else 0,
        "avgSourceFps": (summary_row["avgSourceFps"] or 0) if summary_row else 0,
        "avgProcessedFps": (summary_row["avgProcessedFps"] or 0) if summary_row else 0,
        "avgLatencyMs": (summary_row["avgLatencyMs"] or 0) if summary_row else 0,
        "minLatencyMs": (summary_row["minLatencyMs"] or 0) if summary_row else 0,
        "maxLatencyMs": (summary_row["maxLatencyMs"] or 0) if summary_row else 0,
        "maxQueueDepth": int(summary_row["maxQueueDepth"] or 0) if summary_row else 0,
        "maxDropped": int(summary_row["maxDropped"] or 0) if summary_row else 0,
        "avgCpuPercent": (summary_row["avgCpuPercent"] or 0) if summary_row else 0,
        "avgMemoryMb": (summary_row["avgMemoryMb"] or 0) if summary_row else 0,
        "maxFramesProcessed": int(summary_row["maxFramesProcessed"] or 0) if summary_row else 0,
        "maxDetections": int(summary_row["maxDetections"] or 0) if summary_row else 0,
    }
    return {"bucket": bucket, "buckets": buckets, "summary": summary}


# ---------------------------------------------------------------------------
# مدل‌ها — رجیستری فراداده
# ---------------------------------------------------------------------------


@app.get(f"{API}/models")
def list_models() -> dict[str, Any]:
    with db() as conn:
        rows = fetch_all(conn, 'SELECT * FROM models ORDER BY "created_at" ASC')
    return {"items": [row_to_model(r) for r in rows]}


@app.post(f"{API}/models", status_code=201)
def create_model(body: ModelCreateModel) -> dict[str, Any]:
    payload = _model_dump(body)
    res = internal_fetch("/internal/models", method="POST", body=payload)
    if not res.ok:
        raise forward_error(res)
    model_id = res.data.get("id")
    with db() as conn:
        row = get_model_row(conn, model_id) if isinstance(model_id, str) else None
    if row is None:
        raise validation_error([])
    return row_to_model(row)


@app.patch(f"{API}/models/{{model_id}}")
def patch_model(model_id: str, body: ModelActivateModel) -> dict[str, Any]:
    res = internal_fetch(f"/internal/models/{model_id}", method="PATCH", body={"isActive": body.isActive})
    if not res.ok:
        raise forward_error(res)
    with db() as conn:
        row = get_model_row(conn, model_id)
    if row is None:
        raise not_found()
    return row_to_model(row)


# ---------------------------------------------------------------------------
# نشست‌ها
# ---------------------------------------------------------------------------


@app.get(f"{API}/sessions")
def list_sessions(
    streamId: str | None = Query(default=None),
    state: str | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    page: str | None = Query(default=None),
    pageSize: str | None = Query(default=None),
) -> dict[str, Any]:
    from_iso, to_iso, errors = time_pair(from_, to)
    if errors:
        raise validation_error(errors)
    page_no, size = page_params(page, pageSize)

    where = Where()
    if streamId:
        where.eq("stream_id", streamId)
    if state:
        where.eq("state", state)
    where.time_range("started_at", from_iso, to_iso)

    with db() as conn:
        rows = fetch_all(
            conn,
            f'SELECT "id", "stream_id", "state", "reason", "started_at", "ended_at",'
            f' "frames_processed", "frames_dropped", "detections_total", "events_total"'
            f' FROM sessions {where.sql()} ORDER BY "started_at" DESC, "id" DESC LIMIT ? OFFSET ?',
            where.args() + (size, (page_no - 1) * size),
        )
        total = fetch_one(conn, f'SELECT COUNT(*) AS total FROM sessions {where.sql()}', where.args())["total"]

    items = [
        {
            "id": r["id"],
            "streamId": r["stream_id"],
            "state": r["state"],
            "reason": r["reason"],
            "startedAt": r["started_at"],
            "endedAt": r["ended_at"],
            "framesProcessed": r["frames_processed"],
            "framesDropped": r["frames_dropped"],
            "detectionsTotal": r["detections_total"],
            "eventsTotal": r["events_total"],
        }
        for r in rows
    ]
    return _paged(items, int(total), page_no, size)


# ---------------------------------------------------------------------------
# گزارش‌ها — JSON و CSV (با BOM)
# ---------------------------------------------------------------------------


def _csv_escape(value: Any) -> str:
    s = "" if value is None else str(value)
    if re.search(r'[",\n\r]', s):
        return '"' + s.replace('"', '""') + '"'
    return s


@app.get(f"{API}/reports")
def reports(
    streamId: str | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    format: str = Query(default="json"),
) -> Any:
    if format not in ("json", "csv"):
        raise validation_error(["فرمت گزارش باید json یا csv باشد"])
    from_iso, to_iso, errors = time_pair(from_, to)
    if errors:
        raise validation_error(errors)

    def scoped(table: str, time_col: str) -> tuple[str, tuple[Any, ...]]:
        where = Where()
        if streamId:
            where.eq("stream_id", streamId)
        where.time_range(time_col, from_iso, to_iso)
        return where.sql(), where.args()

    if format == "csv":
        where_sql, args = scoped("detections", "ts")
        with db() as conn:
            rows = fetch_all(
                conn,
                f'SELECT "ts", "stream_id", "session_id", "frame_index", "track_id",'
                f' "label", "confidence", "x", "y", "w", "h" FROM detections'
                f' {where_sql} ORDER BY "ts" ASC, "id" ASC',
                args,
            )
        header = "ts,streamId,sessionId,frameIndex,trackId,label,confidence,x,y,w,h"
        lines = [
            ",".join(
                _csv_escape(v)
                for v in (
                    r["ts"], r["stream_id"], r["session_id"], r["frame_index"],
                    r["track_id"], r["label"], r["confidence"], r["x"], r["y"], r["w"], r["h"],
                )
            )
            for r in rows
        ]
        csv = "\uFEFF" + "\r\n".join([header, *lines]) + "\r\n"
        return Response(
            content=csv,
            media_type="text/csv; charset=utf-8",
            headers={"content-disposition": 'attachment; filename="edgevision-report.csv"'},
        )

    with db() as conn:
        streams = fetch_all(
            conn,
            'SELECT * FROM streams' + (' WHERE "id" = ?' if streamId else "") + ' ORDER BY "created_at" ASC',
            (streamId,) if streamId else (),
        )
        where_sql, args = scoped("sessions", "started_at")
        sessions_count = fetch_one(conn, f'SELECT COUNT(*) AS count FROM sessions {where_sql}', args)["count"]
        where_sql, args = scoped("detections", "ts")
        by_label = fetch_all(
            conn,
            f'SELECT "label", COUNT(*) AS count FROM detections {where_sql} GROUP BY "label" ORDER BY count DESC',
            args,
        )
        where_sql, args = scoped("events", "ts")
        by_type = fetch_all(
            conn,
            f'SELECT "type", COUNT(*) AS count FROM events {where_sql} GROUP BY "type" ORDER BY count DESC',
            args,
        )
        where_sql, args = scoped("metrics", "ts")
        agg = fetch_one(
            conn,
            f'SELECT COUNT(*) AS samples, AVG("source_fps") AS avgSourceFps,'
            f' AVG("processed_fps") AS avgProcessedFps, AVG("latency_avg_ms") AS avgLatencyMs,'
            f' AVG("cpu_percent") AS avgCpuPercent, AVG("memory_mb") AS avgMemoryMb,'
            f' MAX("queue_depth") AS maxQueueDepth FROM metrics {where_sql}',
            args,
        )
        where_sql, args = scoped("detections", "ts")
        top_tracks = fetch_all(
            conn,
            f'SELECT "track_id", "label", COUNT(*) AS count FROM detections {where_sql}'
            f' GROUP BY "track_id", "label" ORDER BY count DESC LIMIT 10',
            args,
        )

        streams_summary = []
        for s in streams:
            sid = s["id"]
            counts = {}
            for table, col in (("sessions", "started_at"), ("detections", "ts"), ("events", "ts")):
                cond = Where()
                cond.eq("stream_id", sid)
                cond.time_range(col, from_iso, to_iso)
                counts[table] = fetch_one(
                    conn, f'SELECT COUNT(*) AS count FROM "{table}" {cond.sql()}', cond.args()
                )["count"]
            streams_summary.append(
                {
                    "streamId": sid,
                    "name": s["name"],
                    "sessions": int(counts["sessions"]),
                    "detections": int(counts["detections"]),
                    "events": int(counts["events"]),
                }
            )

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "range": {"from": from_iso, "to": to_iso},
        "streamsSummary": streams_summary,
        "sessionsCount": int(sessions_count),
        "detectionsByLabel": [{"label": r["label"], "count": int(r["count"])} for r in by_label],
        "eventsByType": [{"type": r["type"], "count": int(r["count"])} for r in by_type],
        "metricsAverages": {
            "avgSourceFps": agg["avgSourceFps"] or 0,
            "avgProcessedFps": agg["avgProcessedFps"] or 0,
            "avgLatencyMs": agg["avgLatencyMs"] or 0,
            "avgCpuPercent": agg["avgCpuPercent"] or 0,
            "avgMemoryMb": agg["avgMemoryMb"] or 0,
            "maxQueueDepth": int(agg["maxQueueDepth"] or 0),
            "samples": int(agg["samples"] or 0),
        },
        "topTracks": [
            {"trackId": r["track_id"], "label": r["label"], "count": int(r["count"])} for r in top_tracks
        ],
    }


# ---------------------------------------------------------------------------
# تنظیمات — پروکسی سرویس پردازش
# ---------------------------------------------------------------------------


@app.get(f"{API}/settings")
def get_settings() -> dict[str, Any]:
    res = internal_fetch("/internal/settings")
    if not res.ok:
        raise forward_error(res)
    return res.data


@app.patch(f"{API}/settings")
def patch_settings(body: SettingsPatchModel) -> dict[str, Any]:
    payload = _model_dump(body)
    res = internal_fetch("/internal/settings", method="PATCH", body=payload)
    if not res.ok:
        raise forward_error(res)
    return res.data


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
