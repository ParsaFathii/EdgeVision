// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Geometric events on confirmed tracks.
#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "tracker.hpp"

namespace ev {

struct GeoLine {
    double x1 = 0.0, y1 = 0.0, x2 = 0.0, y2 = 0.0;
};

struct GeoRect {
    double x = 0.0, y = 0.0, w = 0.0, h = 0.0;
};

// One emitted event; payload is a pre-serialized compact JSON object.
struct EventOut {
    const char* type = "";  // LINE_CROSS | ROI_ENTER | ROI_EXIT
    long long ts_ms = 0;
    std::uint64_t track_id = 0;
    const char* label = "";
    std::string payload;
};

// LINE_CROSS uses the signed side (cross product) of the track centroid
// against the line and fires ONCE per sign flip (direction in the payload).
// ROI_ENTER/ROI_EXIT use the centroid against the ROI rect with a 0.02
// hysteresis margin so a centroid hovering on the border cannot oscillate.
// One event per transition, never per frame.
class EventEngine {
public:
    // Either pointer may be null (feature disabled).
    void configure(const GeoLine* line, const GeoRect* roi);

    std::vector<EventOut> step(const std::vector<TrackOutput>& tracks,
                               long long now_ms, std::uint64_t frame_idx);

    std::uint64_t emitted_total() const { return emitted_total_; }

private:
    struct TrackState {
        bool seen = false;
        int last_side = 0;  // sign of the cross product vs the line
        double last_cx = 0.0, last_cy = 0.0;
        bool roi_inside = false;
        std::uint64_t last_seen = 0;
    };

    int side_of(double cx, double cy) const;
    bool roi_enter_strict(double cx, double cy) const;
    bool roi_exit_loose(double cx, double cy) const;

    bool has_line_ = false;
    GeoLine line_;
    bool has_roi_ = false;
    GeoRect roi_;
    std::unordered_map<std::uint64_t, TrackState> st_;
    std::uint64_t emitted_total_ = 0;
};

}  // namespace ev
