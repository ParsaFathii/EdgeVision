# Installation

EdgeVision runs as two server processes plus a compiled engine binary, all
on one Linux machine. This guide installs from a clone of the repository
and ends with a running dashboard at <http://localhost:3000>.

If you just want to read about the system first, start with
[ARCHITECTURE.md](ARCHITECTURE.md).

## Prerequisites

| Tool | Version | Used for | Notes |
| --- | --- | --- | --- |
| Bun | >= 1.3 (1.3.14 tested) | package installs, Next.js dev server, engine service | <https://bun.sh> |
| g++ | >= 12 (14.2 tested) | compiling the native engine | CMake >= 3.16 is an alternative build path, not required |
| Python 3 | 3.12 tested | the engine smoke harness | only needed for verification, not for running |
| Node.js | 24 (optional) | if you prefer `node`/`npm` for the dev server | Bun is what the project is tested with |
| SQLite | bundled | `db/custom.db` | no separate install; the service uses `bun:sqlite` and the web layer uses Prisma's bundled engine |

Disk: a few hundred MB with `node_modules`. RAM: the dashboard plus one
15 FPS stream session runs comfortably under 1 GB total.

Tested on Linux (Debian). The engine's performance monitor reads
`/proc/self/stat` and `/proc/self/status`, so Linux is required for
meaningful metrics; Windows and macOS are untested.

## Step-by-step

### 1. Clone and install web dependencies

```bash
git clone <repository-url> edgevision
cd edgevision
bun install
```

`bun install` also creates `node_modules` for the dashboard's dependencies
(React, Next.js, Tailwind, socket.io-client, Prisma, and the rest listed
in `package.json`).

### 2. Create the database

```bash
bun run db:push
```

This applies `prisma/schema.prisma` to `db/custom.db` (the file is created
with its tables and indexes). Prisma reads the `DATABASE_URL` environment
variable, typically from a `.env` file in the repo root:
`DATABASE_URL=file:/absolute/path/to/edgevision/db/custom.db` (create the
file if your clone lacks it; the engine service, which does not use
Prisma, resolves `db/custom.db` relative to the repository layout on its
own). Nothing else is seeded: the database starts empty, and the model
registry is seeded automatically by the engine service on first boot.

### 3. Build the native engine

```bash
bash scripts/build-engine.sh
```

What it does and prints:

- compiles every `engine-cpp/src/*.cpp` with
  `g++ -std=c++20 -Wall -Wextra -Wconversion -Wshadow -Werror -pthread -O2`
  into `engine-cpp/build/edgevision-engine`;
- prints the binary path as the last line:
  `/path/to/edgevision/engine-cpp/build/edgevision-engine`;
- on success there is no other output (a zero-warning policy means silence
  is the goal).

Optional, for memory/UB checking during development:

```bash
bash scripts/build-engine.sh --sanitizers   # engine-cpp/build/edgevision-engine-asan
```

If you prefer CMake: `cmake -B engine-cpp/build -S engine-cpp && cmake
--build engine-cpp/build` produces the same binary with the same warning
flags.

Sanity check (prints a version line and exits 0):

```bash
./engine-cpp/build/edgevision-engine --version
```

### 4. Start the engine service

```bash
cd mini-services/engine-service
bun install        # first time only (socket.io)
bun run dev
```

The service binds port 3003. Expected first lines:

```
[engine-service] database open (WAL): /path/to/edgevision/db/custom.db
[engine-service] listening on port 3003 (internal API + socket.io at path "/")
[engine-service] engine binary present
```

If the engine binary is missing you instead see
`engine binary MISSING (engine-cpp/build/edgevision-engine) — start/stop
returns 503 until it is built`: run step 3.

To keep it running without a dedicated terminal:

```bash
nohup bun run dev > service.log 2>&1 &
```

Logs then land in `mini-services/engine-service/service.log`.

### 5. Start the web app

Back in the repo root:

```bash
bun run dev
```

The dev server binds port 3000 and writes its output to `dev.log` in the
repo root (the script pipes through `tee`). Open
<http://localhost:3000>. You should see the Persian dashboard with the
health chip connected. Use «راه‌اندازی سریع» on the overview view to
create and start a real stream in one click, or create streams manually
(see [USER_GUIDE.md](USER_GUIDE.md)).

## Optional components

### FastAPI reference service

A second, independent implementation of the same REST surface, reading the
same SQLite database (reads via the `sqlite3` stdlib, mutations forwarded
to the engine service, same Persian error envelope). Useful for comparing
implementations or prototyping in Python.

```bash
cd services/api-python
pip install -r requirements.txt
python -m uvicorn app:app --port 8000
```

Interactive OpenAPI docs then live at <http://localhost:8000/docs>. This
service is a reference; the primary served API is the Next.js route layer
on port 3000.

### Flutter mobile client

A complete Persian RTL mobile client (dashboard, streams, stream detail
with live frames, events, detections, analytics, settings) against the
same REST API and the socket.io endpoint.

```bash
cd mobile
flutter pub get
flutter run
```

Requires the Flutter SDK (stable channel, Dart >= 3.4) and, for a device
run, an Android SDK or desktop toolchain. On the Android emulator point
the app at `http://10.0.2.2:3000` (the settings screen inside the app sets
the base URL; the WebSocket connects directly to the host on port 3003).
`flutter analyze` and `flutter test` were not run in the build sandbox (no
Flutter SDK); run them locally or rely on CI.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `bun run dev` fails with `EADDRINUSE` on port 3000 | another Next.js/dev server is running | stop it, or run `bunx next dev -p 3001` (the API base in the dashboard expects 3000, so prefer freeing the port) |
| Service log shows `listening` fails, or health stays 503 on port 3003 | port 3003 already in use | `ss -tlnp | grep 3003`, kill the stale `bun --hot index.ts` process, restart the service |
| Creating or starting a stream returns 503 `ENGINE_DOWN` («سرویس پردازش در دسترس نیست») | the engine service on 3003 is down or restarting | start it (step 4); the web layer retries on the next request |
| Starting a stream returns 503 with a Persian message mentioning `scripts/build-engine.sh` | the engine binary is missing (you skipped step 3, or you cleaned `engine-cpp/build/`) | run `bash scripts/build-engine.sh` |
| `SQLITE_BUSY` errors | not expected: the single-writer design plus WAL plus `busy_timeout=5000` exists precisely to prevent this | if you ever see it, something other than the engine service is writing to `db/custom.db`; stop that process |
| Dashboard shows «داده‌های کهنه» (stale data) on a running stream | no frame arrived for 5 seconds: engine stopped, service restarted mid-session, or the browser lost the socket | check the service log; the session is marked `ERROR` (`service_restarted`) if the service bounced; start the stream again |
| Charts/tables empty after a fresh install | the database starts empty by design | run a stream for a minute; data appears as it is retained |
| Where are the logs? | - | app: `dev.log` (repo root); service: `mini-services/engine-service/service.log` (when nohup'd) or its terminal; engine stderr is relayed into the service log with an `[engine]` prefix |

## Uninstall

Everything lives in one folder. Stop the two processes, then delete the
folder: that removes code, `node_modules`, the compiled engine, and the
database with all analytics data. There are no global installs, no
services, no config files outside the project directory.

---

Copyright © 2026 Parsa Fathi — Apache-2.0
