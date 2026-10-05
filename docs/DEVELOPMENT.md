# Development Guide

Everything a contributor needs: the repo map, how to run each part, the
style rules the codebase actually follows, the frozen protocol contract,
and the verification workflow every change goes through.

## Repo tour and ownership map

| Area | Files | Owns |
| --- | --- | --- |
| Native engine | `engine-cpp/src/*.hpp/.cpp`, `engine-cpp/CMakeLists.txt`, `engine-cpp/tools/engine_smoke.py` | Scene simulation, frame queue, detector, tracker, events, perf monitor, session loop, NDJSON emission |
| Build script | `scripts/build-engine.sh` | g++ release and sanitizer builds |
| Engine service | `mini-services/engine-service/{index,http,sessions,protocol,db,settings,seed,validate}.ts` | Process supervision, ALL database writes, socket.io, internal API, retention, registry seed |
| Web API | `src/app/api/v1/**`, `src/lib/edgevision-server/*` | REST surface: Prisma reads, zod-validated mutation forwarding, rate limit, error envelope |
| Dashboard | `src/app/page.tsx`, `src/app/layout.tsx`, `src/components/edgevision/**`, `src/lib/edgevision/**`, `src/hooks/edgevision/*` | The entire UI: 9 views, LiveScene, socket client, formatting, polling |
| Data model | `prisma/schema.prisma` (reads), service raw SQL (writes) | The frozen snake_case column contract both sides share |
| Optional | `mobile/**`, `services/api-python/**` | Flutter client; FastAPI reference |
| Docs & assets | `docs/**`, `docs/fa/**`, `docs/assets/**` | Bilingual documentation, diagrams, screenshots |

Two rules follow from the map: the web layer never writes to SQLite, and
the dashboard never talks to the engine service directly (it goes through
`/api/v1` and the socket).

## Running each component

```bash
bun install                                   # root: web deps
bun run db:push                               # apply prisma/schema.prisma
bash scripts/build-engine.sh                  # engine binary (+ --sanitizers)
cd mini-services/engine-service && bun install && bun run dev   # :3003
bun run dev                                   # root: app on :3000 (tee dev.log)
bun run lint                                  # eslint, must be clean
python3 engine-cpp/tools/engine_smoke.py      # engine protocol smoke
```

Also available: `bun run db:generate` (Prisma client), `db:migrate`,
`db:reset`. Optional components: `cd services/api-python && python -m
uvicorn app:app --port 8000`; `cd mobile && flutter run`.

## Code style

**TypeScript.** `strict` is on (`tsconfig.json`). New code uses explicit
types and narrows `unknown` at trust boundaries; do not introduce `any`
(the socket payload parsing in `src/lib/edgevision/socket.ts` is the
pattern to copy). Server code uses the shared helpers (`withApi`,
`mutationGuard`, `readJsonBody`, `apiError`) instead of bespoke logic.
Route files stay thin: validate, forward, read back, respond.

**C++.** Zero warnings, enforced by the build:
`-std=c++20 -Wall -Wextra -Wconversion -Wshadow -Werror -pthread`
(`-O2` release; `-O1 -g -fsanitize=address,undefined` for the sanitizer
build). Headers document *why*, not just *what*. No exceptions escape
`main` (config errors become `CONFIG_INVALID` + exit 2; anything else
becomes `INTERNAL` + exit 3). Allocation churn in the per-frame hot loop
is avoided (scratch buffers are reused).

**Persian copy.** Product strings are natural Persian with correct
نیم‌فاصله (ZWNJ, U+200C), «» quotes, and Persian digits in prose via the
helpers in `src/lib/edgevision/format.ts` (`faNumber`, `toFaDigits`,
Jalali dates). Technical identifiers stay English. Typos in user-visible
copy are release blockers, not cosmetics.

**Error messages.** Persian, one line, in the canonical envelope, with
English codes. No stack traces to clients, ever.

**Commits.** Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`,
`test:`, `chore:`.

## The frozen protocol contract

Three interfaces are contracts, and changing one is a deliberate act:

1. **Engine NDJSON** (`stdout`) + stdin commands: line types `ready`,
   `session_started`, `state`, `frame`, `event`, `metrics`,
   `settings_applied`, `pong`, `session_stopped`, `error`; commands
   `stop`, `ping`, `set grid|queue|emit-stride`. Defined by
   `engine-cpp/src/session.cpp` and mirrored by
   `mini-services/engine-service/protocol.ts` and the smoke harness.
2. **Internal API** (`/internal/*` on :3003, token header): surface in
   `mini-services/engine-service/http.ts`.
3. **WebSocket events** (socket.io, path `/`): `hello`, `frame`,
   `metrics`, `event`, `session`, `pong` / `subscribe`, `unsubscribe`,
   `ping`.

Rule: any change to any of the three **must** update `docs/API.md` (and
the Persian `docs/fa/API_FA.md`) in the same PR, and must keep the engine
smoke harness green. The smoke harness is the executable form of the
engine contract; treat a harness change as a protocol change.

## How to add things

**A scene type** (e.g. ROUNDABOUT):

- `engine-cpp/src/config.hpp` + `config.cpp`: extend `SceneKind`, accept
  the name in `--scene` parsing (range-check message included);
- `engine-cpp/src/scene.hpp` + `scene.cpp`: spawn and step logic
  (`spawn_roundabout`, maneuvers);
- `engine-cpp/src/session.cpp`: the name in `scene_name()`;
- `src/lib/edgevision-server/schemas.ts` (`sceneSchema` enum + Persian
  message), `mini-services/engine-service/validate.ts` (same);
- UI: `src/components/edgevision/stream-editor.tsx` (select options) and
  `src/lib/edgevision/format.ts` (`sceneLabelFa`), `types.ts` if the
  union is typed; add a smoke-harness scenario if the geometry deserves
  one.

**An event type** (e.g. LOITERING):

- `engine-cpp/src/events.hpp` + `events.cpp`: the detection logic and the
  type string (one event per transition, never per frame; state lives in
  `TrackState`);
- `src/lib/edgevision-server/schemas.ts`: add to `EVENT_TYPES`;
- `src/lib/edgevision/types.ts` (`EventKind`) and `events.ts` (the
  Persian sentence), `format.ts` (`eventTypeFa`);
- docs: the event table in `docs/API.md` / `docs/USER_GUIDE.md`.

**A dashboard view** (e.g. a maps view):

- `src/components/edgevision/shared/nav.ts`: add the `ViewId`;
- new `src/components/edgevision/view-<name>.tsx` (loading / empty /
  error+retry states are mandatory);
- `src/app/page.tsx`: `NAV_ITEMS` entry + the view switch;
- `src/lib/edgevision/api.ts` if new endpoints are needed;
- screenshots and both doc sets.

## Build scripts explained

`scripts/build-engine.sh` compiles `engine-cpp/src/*.cpp` with the strict
flag set into `engine-cpp/build/edgevision-engine` and prints the binary
path. `--sanitizers` produces `edgevision-engine-asan` at `-O1 -g` with
ASan+UBSan. `set -euo pipefail` means any warning (with `-Werror`) fails
the build; `CXX` overrides the compiler. The CMakeLists is the same build
for IDE/CI environments that prefer it.

The web app scripts live in `package.json`: `dev` (Next dev on :3000,
teed to `dev.log`), `build`/`start` (production), `lint`, `db:push`
(apply schema), `db:generate`, `db:migrate`, `db:reset`.

## Verification workflow

Before a PR (this is the same checklist CI runs, plus the manual part):

1. `bash scripts/build-engine.sh` - clean, silent, zero warnings.
2. `python3 engine-cpp/tools/engine_smoke.py` - **three consecutive
   runs**; exit code is the failure count and must be 0 every time.
3. `bash scripts/build-engine.sh --sanitizers` and run one smoke scenario
   against the asan binary - zero findings in EdgeVision code.
4. `bun run lint` - zero problems.
5. Manual browser pass with the full stack: quick start; live scene with
   boxes/ROI/line; stop/start with confirm; events payload expansion;
   detections filters + CSV download; analytics; model activation;
   settings PATCH; mobile navigation. Watch for Persian copy quality and
   toast wording.
6. If you touched the protocol: doc diff in the same PR (see above).

## Known non-goals (v1.0.0)

- Multi-user authentication/authorization (single-user local deployment).
- Real camera/file/network capture (synthetic scene stand-in; no OpenCV or
  FFmpeg bundled).
- ONNX inference (grid-scan detector stand-in; registry is metadata).
- Windows/macOS support (the perf monitor reads `/proc`).
- Horizontal scaling or multi-instance deployments (in-memory rate
  limiter and snapshot cache assume one process).

## Release checklist

1. Bump the version in **three places**:
   - `package.json` (`version`),
   - the engine constant `kEngineVersion` in `engine-cpp/src/config.hpp`,
   - the service version strings in `mini-services/engine-service/http.ts`
     (health) and `index.ts` (hello); the web health route in
     `src/app/api/v1/health/route.ts` carries the same string, update it
     too.
2. Rebuild and re-verify: engine smoke x3, sanitizer run, lint, manual
   browser pass.
3. Update the version numbers shown in docs if the release changes user-
   visible behavior (README, USER_GUIDE screenshots if the UI moved).
4. Confirm no runtime artifacts are staged: `db/*.db*`,
   `engine-cpp/build/`, `*.log` are gitignored; `git status` should be
   clean apart from intended changes.
5. Tag the release (`vX.Y.Z`) and write release notes that state honestly
   what changed, including any protocol change.

---

Copyright © 2026 Parsa Fathi — Apache-2.0
