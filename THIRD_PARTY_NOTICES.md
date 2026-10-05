# Third-Party Notices

EdgeVision is © 2026 Parsa Fathi, licensed under Apache-2.0 (see
[LICENSE](LICENSE)). This file lists the third-party software the project
depends on or bundles, with its licenses and copyright holders, so you can
do your own compliance review. Versions below are the ones the project was
built and tested with.

## Web app and dashboard (repo root `package.json`)

| Package | License | Copyright holder / project |
| --- | --- | --- |
| next | MIT | Vercel, Inc. and Next.js contributors |
| react / react-dom | MIT | Meta Platforms, Inc. and React contributors |
| tailwindcss (+ `@tailwindcss/postcss`, `tw-animate-css`) | MIT | Tailwind Labs LLC; contributors |
| shadcn/ui (component scaffolding in `src/components/ui/`) | MIT | shadcn, Vercel |
| `@radix-ui/react-*` primitives | MIT | Radix UI / WorkOS |
| recharts | MIT | Recharts authors |
| socket.io-client | MIT | Guillermo Rauch and socket.io contributors |
| socket.io (engine service) | MIT | Guillermo Rauch and socket.io contributors |
| framer-motion | MIT | Framer (Motion One contributors) |
| lucide-react | ISC | Lucide Icons contributors |
| zod | MIT | Colin McDonnell |
| sonner | MIT | Emil Kowalski |
| zustand | MIT | Paul Henschel |
| class-variance-authority, clsx, tailwind-merge | MIT | Joe Bell, Luke Edwards, Dang Van Thanh (respectively) |
| `@prisma/client` / prisma | Apache-2.0 | Prisma (Prisma Data, Inc.) and contributors |
| date-fns | MIT | Sasha Koss and date-fns contributors |
| Bun (runtime, not an npm package) | MIT | Jarred Sumner and Bun contributors |

The exact dependency graph (including transitive packages) is recorded in
`bun.lock` at the repo root and in
`mini-services/engine-service/bun.lock`.

## Fonts

| Asset | License | Notes |
| --- | --- | --- |
| Vazirmatn | SIL Open Font License 1.1 | Designed by Saber Rastikerdar and contributors; the OFL permits bundling and embedding, and requires the license text to accompany redistribution of the font files themselves |

## Native engine

The engine (`engine-cpp/`) has **zero third-party dependencies**. It is
plain C++20 against the Linux kernel interfaces (`/proc`, POSIX threads,
`poll`, signals) and compiles with g++ or CMake.

**ONNX Runtime is not bundled and not linked.** The detector in this build
is a native grid-scan stand-in (see [docs/MODELS.md](docs/MODELS.md)). If
you extend the engine to run real ONNX inference, you choose and download
ONNX Runtime yourself under its own license (MIT) and accept its terms.

## Optional components

| Component | Dependencies | Licenses |
| --- | --- | --- |
| FastAPI reference service (`services/api-python/`) | fastapi, uvicorn, starlette, pydantic (+ their transitive deps, e.g. `pydantic-core`, `anyio`, `h11`, `click`) | MIT (FastAPI: Sebastián Ramírez; Uvicorn: Encode; Starlette: Encode; Pydantic v2 core: MIT, Pydantic: MIT, Samuel Colvin and contributors) |
| Flutter mobile client (`mobile/`) | Flutter SDK (stable channel), `http`, `web_socket_channel`, `flutter_lints` | Flutter/Dart SDK: BSD 3-Clause ("Dart SDK", Google LLC); `http`/`web_socket_channel`/`flutter_lints`: BSD 3-Clause (Dart/Flutter team) |

## Model weights policy

**No model weights are distributed with this repository.** The model
registry seeds contain configuration metadata only. Popular YOLO model
families are licensed AGPL-3.0 (e.g. Ultralytics YOLO) or GPL-3.0 (some
YOLOv5 exports). Do not commit such weights into this repository: download
them separately and do your own license review before any deployment. See
[docs/MODELS.md](docs/MODELS.md).

## Aggregate notice

This product includes software developed by the open-source projects
listed above under their respective licenses. The Rust-derived components
inside Bun (licensing details in Bun's repository) and the TypeScript
compiler used during development are not redistributed in source form by
this project. If you redistribute EdgeVision, keep this file, include the
upstream license texts of the packages you actually ship (MIT, ISC, BSD
and Apache-2.0 texts are short; the Vazirmatn OFL text must accompany the
font files), and preserve the attribution notices embedded in the shadcn/ui
component headers.

License texts for npm packages are available in their published tarballs
(`package.json` `license` field plus repository license files). If a
license text is missing from this list in error, open an issue; do not
guess.

---

Copyright © 2026 Parsa Fathi — Apache-2.0
