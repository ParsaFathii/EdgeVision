// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Entry point: --version handling, strict config parsing, session bootstrap.
// No exception ever escapes main (config -> error/2, anything else -> 3).
#include <cstring>
#include <exception>
#include <string>

#include "config.hpp"
#include "emit.hpp"
#include "json_out.hpp"
#include "session.hpp"

namespace {

void emit_error_json(const char* code, const std::string& message) {
    ev::json::Line l;
    l.raw("{\"type\":\"error\",\"code\":\"")
        .raw(code)
        .raw("\",\"message\":")
        .esc(message)
        .raw(",\"ts\":")
        .i(ev::epoch_now_ms())
        .raw("}");
    (void)ev::emit::line(l.s);
}

}  // namespace

int main(int argc, char** argv) {
    using namespace ev;
    try {
        for (int i = 1; i < argc; ++i) {
            if (std::strcmp(argv[i], "--version") == 0) {
                json::Line l;
                l.raw("{\"type\":\"version\",\"version\":\"").raw(kEngineVersion).raw("\"}");
                (void)emit::line(l.s);
                return 0;
            }
        }
        const Config cfg = parse_config(argc, argv);
        Session session(cfg);
        return session.run();
    } catch (const ConfigError& e) {
        emit_error_json("CONFIG_INVALID", e.what());
        return 2;
    } catch (const std::exception& e) {
        emit_error_json("INTERNAL", e.what());
        return 3;
    } catch (...) {
        emit_error_json("INTERNAL", "unknown exception");
        return 3;
    }
}
