// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// The single funnel for stdout NDJSON lines: one write() sequence per line so
// lines are never interleaved, EINTR-safe, and failures (parent closed the
// pipe) are reported to the caller instead of killing the process.
#pragma once

#include <cerrno>
#include <cstddef>
#include <string>
#include <unistd.h>

namespace ev::emit {

// Appends the newline and writes the full line. Returns false when stdout is
// gone (EPIPE etc.) — callers then stop emitting and shut down gracefully.
inline bool line(const std::string& content) {
    std::string out;
    out.reserve(content.size() + 1);
    out = content;
    out.push_back('\n');
    const char* p = out.data();
    std::size_t left = out.size();
    while (left > 0) {
        const ssize_t n = ::write(STDOUT_FILENO, p, left);
        if (n < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        p += n;
        left -= static_cast<std::size_t>(n);
    }
    return true;
}

}  // namespace ev::emit
