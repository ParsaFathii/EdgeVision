#!/usr/bin/env bash
# EdgeVision — native video analytics engine build script.
# Copyright © 2026 Parsa Fathi — Apache-2.0
#
# Compiles all engine-cpp/src/*.cpp with g++ into engine-cpp/build/edgevision-engine.
# The project enforces a ZERO-WARNING policy (-Werror on top of the strict set).
# -pthread is required: the engine is a producer/consumer multithreaded program.
#
# Usage:
#   bash scripts/build-engine.sh                # release build (-O2)
#   bash scripts/build-engine.sh --sanitizers  # ASan+UBSan build at -O1 (separate binary)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/engine-cpp/src"
OUT_DIR="$ROOT/engine-cpp/build"

CXX_BIN="${CXX:-g++}"
STRICT=(-std=c++20 -Wall -Wextra -Wconversion -Wshadow -Werror -pthread)

BIN="$OUT_DIR/edgevision-engine"
FLAGS=(-O2 "${STRICT[@]}")

if [[ "${1:-}" == "--sanitizers" ]]; then
    BIN="$OUT_DIR/edgevision-engine-asan"
    FLAGS=(-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer "${STRICT[@]}")
fi

mkdir -p "$OUT_DIR"
# shellcheck disable=SC2086
"$CXX_BIN" "${FLAGS[@]}" -o "$BIN" "$SRC_DIR"/*.cpp

echo "$BIN"
