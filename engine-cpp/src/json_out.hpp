// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Compact NDJSON writer helpers. Key order is fixed at every call site (the
// wire contract is frozen); floats carry at most 3 decimals; integers stay
// integers. All strings that can contain foreign characters go through
// appendEscaped (ids are additionally sanitized at config parse time).
#pragma once

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

namespace ev::json {

inline void append_int(std::string& out, long long v) {
    char b[24];
    std::snprintf(b, sizeof b, "%lld", v);
    out += b;
}

inline void append_uint(std::string& out, unsigned long long v) {
    char b[24];
    std::snprintf(b, sizeof b, "%llu", v);
    out += b;
}

// At most 3 decimals, trailing zeros trimmed but at least one decimal kept
// (so float fields always parse as JSON floats). "-0.0" is normalized away.
inline void append_double(std::string& out, double v) {
    if (!std::isfinite(v) || std::fabs(v) < 0.0005) {
        out += "0.0";
        return;
    }
    char b[48];
    std::snprintf(b, sizeof b, "%.3f", v);
    std::size_t n = std::strlen(b);
    if (std::strchr(b, '.') != nullptr) {
        while (n > 0 && b[n - 1] == '0') --n;
        if (n > 0 && b[n - 1] == '.') {
            b[n++] = '0';
        }
        b[n] = '\0';
    }
    out += b;
}

// Minimal JSON string escaping (we control every other byte we emit).
inline void append_escaped(std::string& out, const std::string& s) {
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char b[8];
                    std::snprintf(b, sizeof b, "\\u%04x",
                                  static_cast<int>(static_cast<unsigned char>(c)));
                    out += b;
                } else {
                    out += c;
                }
        }
    }
}

// Tiny chainable line builder so call sites stay readable while the exact
// key order of the frozen protocol is written out literally.
struct Line {
    std::string s;

    Line& raw(const char* v) { s += v; return *this; }
    Line& raw(char v) { s += v; return *this; }
    Line& str(const char* v) { s += '"'; s += v; s += '"'; return *this; }
    Line& esc(const std::string& v) {
        s += '"';
        append_escaped(s, v);
        s += '"';
        return *this;
    }
    Line& i(long long v) { append_int(s, v); return *this; }
    Line& u(unsigned long long v) { append_uint(s, v); return *this; }
    Line& f(double v) { append_double(s, v); return *this; }
};

}  // namespace ev::json
