// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Strict CLI configuration. Every field is validated in parse_config(); any
// violation throws ConfigError and becomes a CONFIG_INVALID line + exit 2.
#pragma once

#include <cstdint>
#include <stdexcept>
#include <string>

#include "types.hpp"

namespace ev {

inline constexpr const char* kEngineName = "edgevision-engine";
inline constexpr const char* kEngineVersion = "1.0.0";

// Thrown on any CLI contract violation; message is one English line.
class ConfigError : public std::runtime_error {
public:
    explicit ConfigError(const std::string& msg) : std::runtime_error(msg) {}
};

// Class output filter parsed from --class-filter (omitted/empty = all).
struct ClassFilter {
    bool pedestrian = true;
    bool vehicle = true;
    bool cyclist = true;

    static ClassFilter all() { return ClassFilter{}; }
    static ClassFilter none() { return ClassFilter{false, false, false}; }
    bool allows(ObjClass c) const {
        switch (c) {
            case ObjClass::Pedestrian: return pedestrian;
            case ObjClass::Vehicle:    return vehicle;
            case ObjClass::Cyclist:    return cyclist;
        }
        return false;
    }
};

struct Config {
    std::string session_id;
    std::string stream_id;
    std::uint32_t seed = 0;
    enum class SceneKind { Street, Intersection, Parking } scene = SceneKind::Street;
    int width = 0;            // 320..1920 (simulated camera raster)
    int height = 0;           // 240..1080
    double target_fps = 0.0;  // 1..30
    int objects = 0;          // 3..20 scene population
    int queue_capacity = 0;   // 5..200
    double confidence = 0.0;  // 0.05..0.95 output threshold
    ClassFilter class_filter;
    bool has_roi = false;
    double roi_x = 0.0, roi_y = 0.0, roi_w = 0.0, roi_h = 0.0;  // normalized
    bool has_line = false;
    double line_x1 = 0.0, line_y1 = 0.0, line_x2 = 0.0, line_y2 = 0.0;
    int grid_cols = 0;  // 16..80
    int grid_rows = 0;  // 9..48
    long long metrics_interval_ms = 1000;
    int emit_stride = 2;
};

// Parses argv strictly (unknown flags, missing values and out-of-range values
// all throw ConfigError). --version is handled by main() before this runs.
Config parse_config(int argc, char** argv);

// Parses "<cols>x<rows>" with cols 16..80 and rows 9..48 — shared by the
// --grid flag and the `set grid` stdin command.
bool parse_grid_spec(const std::string& s, int& cols, int& rows);

// Strict integer parse for stdin commands ("set queue 32" etc.).
bool parse_ll_strict(const std::string& s, long long& out);

// Strips every character outside [A-Za-z0-9._:-] (ids may arrive from the
// service with quotes or control bytes — never trust them in JSON) and caps
// the length. Returns "" when nothing safe remains (caller rejects it).
std::string sanitize_id(const std::string& s);

}  // namespace ev
