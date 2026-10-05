# Contributing to EdgeVision

Thanks for wanting to contribute. This is a small, deliberately explicit
codebase: read the architecture notes first
([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)), keep the honesty rules in
mind, and verify before you push.

## Development environment

Same commands as installation (details in
[docs/INSTALLATION.md](docs/INSTALLATION.md)):

```bash
bun install                                   # web dependencies (repo root)
bun run db:push                               # create/update db/custom.db
bash scripts/build-engine.sh                  # engine-cpp/build/edgevision-engine
cd mini-services/engine-service && bun install && bun run dev   # port 3003
bun run dev                                   # app on port 3000 (repo root)
```

Tested toolchain: Linux (Debian), g++ 14 (>= 12 required), Bun 1.3
(>= 1.3), Node 24 (optional; Next.js dev server runs on Bun), Python 3.12
for the engine smoke harness. SQLite needs no separate install.

## Code tour: who owns what

| Directory | Responsibility | Notes |
| --- | --- | --- |
| `engine-cpp/src/` | Native engine: scene, queue, detector, tracker, events, perf monitor, session | C++20, zero external deps, zero-warning policy |
| `mini-services/engine-service/` | Process supervision, ALL database writes, socket.io, internal API | Bun + TypeScript, one file per concern |
| `src/app/api/v1/` | REST route handlers (thin) | Read via Prisma; forward mutations |
| `src/lib/edgevision-server/` | Shared server code: zod schemas, error envelope, rate limit, internal client, raw-SQL helpers | The web layer's only business logic |
| `src/components/edgevision/` | The 9 dashboard views + LiveScene | Persian UI copy lives here |
| `src/lib/edgevision/` | Dashboard client: typed API, socket singleton, Persian formatting | No server concepts here |
| `prisma/schema.prisma` | Read-model schema (snake_case columns are frozen) | Writes are raw SQL in the service; both sides must match |
| `scripts/build-engine.sh` | g++ build (release and `--sanitizers`) | CMake is the alternative |
| `engine-cpp/tools/engine_smoke.py` | Protocol smoke harness | Runs the real binary end to end |

## Conventions

**TypeScript.** `strict` is on (`tsconfig.json`). Do not introduce `any`
in new code; narrow unknowns at the boundary (see `socket.ts` for the
pattern). Server routes use the shared helpers (`withApi`,
`mutationGuard`, `readJsonBody`) rather than rolling their own.

**C++.** Every translation unit must compile with
`-std=c++20 -Wall -Wextra -Wconversion -Wshadow -Werror -pthread` with
zero warnings; the build script enforces this. Header comments explain
*why* decisions were made; keep that habit. No exceptions escape `main`.

**Persian UI copy.** The product UI is Persian-first. New strings must be
natural Persian (proper نیم‌فاصله / ZWNJ, correct «» quotes, Persian digits
in prose via the existing `format.ts` helpers, Jalali dates via
`Intl` with `fa-IR`). Technical identifiers (endpoint names, event types,
field names) stay in English. If a string reads like a machine translation,
rewrite it.

**Error messages.** Server messages are Persian with canonical English
error codes, always in the `{error:{code,message,details?}}` envelope.
Never leak stack traces.

**Commits.** Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`,
`test:`, `chore:`), subject in English, one logical change per commit.

## How to verify your change

Run all of these before opening a PR. They are cheap; the whole set takes
a few minutes.

1. **Engine changes: smoke harness, three consecutive runs.**

   ```bash
   bash scripts/build-engine.sh
   python3 engine-cpp/tools/engine_smoke.py   # exit code = failure count
   python3 engine-cpp/tools/engine_smoke.py
   python3 engine-cpp/tools/engine_smoke.py
   ```

   Also build and run one scenario against the sanitizer binary:

   ```bash
   bash scripts/build-engine.sh --sanitizers
   ```

2. **Web changes: lint.**

   ```bash
   bun run lint        # must report zero problems
   ```

3. **Behavior changes: manual browser checklist.** With the service
   (`:3003`) and app (`:3000`) running, walk through: overview quick start;
   live scene with boxes, ROI and line; stop/start with the confirm dialog;
   events payload expansion; detections filters + CSV download; analytics
   charts; model activation switch; settings PATCH; mobile navigation via
   the hamburger Sheet. Check the toast messages are sensible Persian.

4. **Protocol changes: update the docs.** The engine NDJSON contract, the
   internal API, and the WebSocket events are frozen interfaces. If you
   must change one, update `docs/API.md` (and `docs/fa/API_FA.md` via the
   maintainer) in the same PR.

## Pull request expectations

- Green checks: lint passes, and the engine smoke harness passes if
  `engine-cpp/` was touched (CI runs build + smoke + lint).
- The description states **what behavior changed** and how you verified
  it (which of the four verifications above you ran, and with what
  result). "It works on my machine" is not a description.
- UI changes come with a screenshot; protocol changes come with a doc
  diff; schema changes come with the matching service SQL updates.
- No new dependency without a justification line in the PR text and a
  license check against [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Small tasks that are always welcome

- Improving Persian copy anywhere it reads stiff.
- Tightening doc examples (real commands only).
- Additional smoke-harness scenarios (deterministic, no timing flakiness).
- Reducing allocation churn in the engine hot loop without changing the
  protocol.

---

Copyright © 2026 Parsa Fathi — Apache-2.0
