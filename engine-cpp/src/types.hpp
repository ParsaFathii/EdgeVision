// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Shared value types + clock helpers for the whole engine.
#pragma once

#include <chrono>
#include <cstdint>

namespace ev {

// Object classes the scene can render (also the detector label space).
enum class ObjClass : std::uint8_t { Pedestrian = 0, Vehicle = 1, Cyclist = 2 };

// Stable wire name for a class (fixed enum set — no escaping needed).
inline const char* obj_class_name(ObjClass c) {
    switch (c) {
        case ObjClass::Pedestrian: return "PEDESTRIAN";
        case ObjClass::Vehicle:    return "VEHICLE";
        case ObjClass::Cyclist:    return "CYCLIST";
    }
    return "CYCLIST";
}

// Axis-aligned box in normalized [0..1] coordinates; x/y = top-left corner.
struct Box {
    double x = 0.0;
    double y = 0.0;
    double w = 0.0;
    double h = 0.0;
};

// Intersection-over-union of two normalized boxes (0 when degenerate).
inline double box_iou(const Box& a, const Box& b) {
    if (a.w <= 0.0 || a.h <= 0.0 || b.w <= 0.0 || b.h <= 0.0) return 0.0;
    const double x1 = a.x > b.x ? a.x : b.x;
    const double y1 = a.y > b.y ? a.y : b.y;
    const double x2 = (a.x + a.w) < (b.x + b.w) ? (a.x + a.w) : (b.x + b.w);
    const double y2 = (a.y + a.h) < (b.y + b.h) ? (a.y + a.h) : (b.y + b.h);
    const double iw = x2 - x1;
    const double ih = y2 - y1;
    if (iw <= 0.0 || ih <= 0.0) return 0.0;
    const double inter = iw * ih;
    return inter / (a.w * a.h + b.w * b.h - inter);
}

using SteadyClock = std::chrono::steady_clock;
using SteadyTp = SteadyClock::time_point;

// Unix epoch milliseconds right now (integer, as every `ts` field requires).
inline long long epoch_now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// Elapsed milliseconds (double) since t0 on the steady clock.
inline double ms_since(const SteadyTp& t0) {
    return std::chrono::duration<double, std::milli>(SteadyClock::now() - t0).count();
}

// Elapsed milliseconds (integer) since t0 on the steady clock.
inline long long ms_int_since(const SteadyTp& t0) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(SteadyClock::now() - t0)
        .count();
}

}  // namespace ev
