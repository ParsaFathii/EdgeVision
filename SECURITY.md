# Security Policy

EdgeVision is a single-user, local deployment. This document describes the
threat model the code was actually built against, the protections that
exist today, and the explicit non-goals. Read it before exposing any port
beyond `127.0.0.1`.

## Threat model

| Asset | Threat considered | Mitigation in this build |
| --- | --- | --- |
| SQLite file (`db/custom.db`) | concurrent writers corrupting data | single-writer design: only the engine service writes (WAL mode, `busy_timeout=5000`); the web layer only reads |
| REST API (port 3000) | malformed or oversized requests | zod validation on every mutation, 1 MB body cap (413 above it), canonical error envelope, no stack traces in responses |
| REST API | request flooding | in-memory token bucket: 60 mutations/minute per client IP (429 when empty) |
| Internal API (port 3003) | unauthorized control of sessions | every `/internal/*` request requires the `x-internal-token` header |
| Native engine | hostile input via arguments or stdin | strict config parsing (range checks on every field, unknown flags rejected), id sanitization (`[A-Za-z0-9._:-]`, max 64 chars), command whitelist (`stop`, `ping`, `set grid|queue|emit-stride`) with value ranges |
| Native engine | engine crash | process isolation: one engine per session over NDJSON; the service records an ERROR session and stays healthy |
| Dashboard | stale or broken realtime state | socket.io auto-reconnect with re-subscribe; a «داده‌های کهنه» (stale data) chip appears when no frame arrives for 5 seconds |

## The internal token

The engine service's control API (`/internal/*` on port 3003) and the
`sandbox ops` endpoint `POST /api/v1/engine-service` are guarded by a
shared secret:

- Environment variable: `EV_INTERNAL_TOKEN`
- Default value: `edgevision-local` (a local development default, not a
  secret; see `mini-services/engine-service/http.ts` and
  `src/lib/edgevision-server/internal.ts`)

**If you expose port 3003 or 3000 to anything other than loopback, change
this value first** and set the same value on both processes:

```bash
EV_INTERNAL_TOKEN=<long-random-string> bun run dev                # app
EV_INTERNAL_TOKEN=<long-random-string> bun run dev                # service
```

The token is compared as a plain string over the connection. On loopback
this is acceptable; on a network it must be a long random value, and you
should put TLS in front of it.

## Rate limits and body caps

| Layer | Limit | Response when exceeded |
| --- | --- | --- |
| Next.js mutations (POST/PATCH/DELETE on `/api/v1/*`) | 60/minute per client IP (token bucket, 1 token/second refill) | 429 `RATE_LIMIT`, «درخواست‌های بیش از حد مجاز؛ کمی صبر کنید» |
| Next.js request bodies | 1 MB | 413 `BODY_TOO_LARGE`, «حجم درخواست بیش از حد مجاز است» |
| Engine service internal bodies | 256 KB | 413 `BODY_TOO_LARGE` |
| Read endpoints | not rate limited | - |

The rate limiter is in-memory (`src/lib/edgevision-server/ratelimit.ts`):
it resets on server restart and does not survive horizontal scaling. That
is fine for one process, and it is one reason deployment is documented as
single-instance.

## Input validation

- Every mutation body is validated with zod schemas
  (`src/lib/edgevision-server/schemas.ts`) at the web layer, and again with
  independent checks inside the engine service (`mini-services/engine-service/validate.ts`).
  The service is the source of truth; the web layer fails fast.
- All SQL is parameterized. Column names in raw SQL fragments are hardcoded
  by the calling routes, never taken from user input
  (`src/lib/edgevision-server/sql.ts`).
- No filesystem path is ever derived from user input. The engine binary
  path is resolved from the repository layout (or the `ENGINE_BIN`
  environment variable, operator-controlled); the `engineBin` option on the
  sandbox ops endpoint must be an absolute path inside the project root and
  must point to an existing file, or it is rejected.
- Stream ids that cross the engine boundary are sanitized to
  `[A-Za-z0-9._:-]` with a 64-character cap before they reach argv.
- JSON engine output is parsed defensively: unparsable lines are logged and
  skipped, never fatal (`mini-services/engine-service/protocol.ts`).

## Logging

What is logged: `dev.log` (repo root) holds the Next.js dev-server output
(request errors with the route path; stack traces stay server-side);
`mini-services/engine-service/service.log` (when started with nohup) or
the service terminal holds session lifecycle lines, engine stderr relay,
and retention sweep counts. The engine writes diagnostics to its own
stderr. What is never logged: the internal token, request bodies, or
database contents. Session and stream ids (UUIDs) do appear, by design,
for debugging.

## SQLite file permissions

The database lives at `db/custom.db` (plus `-wal`/`-shm` sidecars in WAL
mode), created with the process's default umask. On a shared account,
tighten it: `chmod 600 db/custom.db db/custom.db-wal db/custom.db-shm`.
The `.gitignore` excludes `db/*.db*` so analytics data cannot be committed
by accident.

## Crash and failure behavior

An engine crash finalizes the session as `ERROR` with reason
`engine_crash_exit_<code>`, sets the stream status to `ERROR`, writes an
`ERROR` event row, and leaves the service healthy; starting the stream
again recovers. On engine service restart, sessions left in STARTING,
RUNNING or DEGRADED are reconciled to `ERROR` (`service_restarted`) at
boot, so no orphaned "running" state survives. When the web layer cannot
reach the service, mutations answer 503 `ENGINE_DOWN` while reads keep
working from SQLite.

## Reporting a vulnerability

Please do not open a public issue for security problems. Instead, use
GitHub's private vulnerability reporting: on the repository page, go to the
**Security** tab and choose **Report a vulnerability** (or open a private
security advisory). If private reporting is unavailable to you, contact the
maintainer through their GitHub profile. Include reproduction steps and the
affected component (engine / engine service / web API / dashboard /
mobile). Please allow a reasonable window before public disclosure.

## Non-goals in v1.0.0

Be explicit about what this is not:

- **No multi-tenant authentication or authorization.** There is no login,
  no users table, no per-stream permissions. The internal token is a local
  secret separating the two server processes, not user auth.
- **No TLS termination** inside the project. Put a reverse proxy in front
  if you need HTTPS.
- **No audit log** of who issued which mutation.
- **Not tested on Windows or macOS.** The performance monitor reads
  `/proc/self/stat` and `/proc/self/status` (Linux only).

If you need any of the above, treat this codebase as a starting point and
do a proper security review first.

---

Copyright © 2026 Parsa Fathi — Apache-2.0
