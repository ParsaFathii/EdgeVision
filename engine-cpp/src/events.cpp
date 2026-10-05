// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

#include "events.hpp"

#include <cmath>
#include <vector>

namespace ev {
namespace {

// ROI hysteresis margin (normalized): enter requires the centroid to be this
// far INSIDE the rect, exit requires it to be this far OUTSIDE.
constexpr double kRoiMargin = 0.02;
// Track states untouched for this many frames are forgotten (dead tracks).
constexpr std::uint64_t kStatePruneFrames = 600;

}  // namespace

void EventEngine::configure(const GeoLine* line, const GeoRect* roi) {
    has_line_ = (line != nullptr);
    if (line != nullptr) line_ = *line;
    has_roi_ = (roi != nullptr);
    if (roi != nullptr) roi_ = *roi;
}

int EventEngine::side_of(double cx, double cy) const {
    // Signed side of point (cx, cy) against the directed line p1 -> p2.
    const double cross =
        (line_.x2 - line_.x1) * (cy - line_.y1) - (line_.y2 - line_.y1) * (cx - line_.x1);
    if (cross > 0.0) return 1;
    if (cross < 0.0) return -1;
    return 0;
}

bool EventEngine::roi_enter_strict(double cx, double cy) const {
    return cx >= roi_.x + kRoiMargin && cx <= roi_.x + roi_.w - kRoiMargin &&
           cy >= roi_.y + kRoiMargin && cy <= roi_.y + roi_.h - kRoiMargin;
}

bool EventEngine::roi_exit_loose(double cx, double cy) const {
    return cx < roi_.x - kRoiMargin || cx > roi_.x + roi_.w + kRoiMargin ||
           cy < roi_.y - kRoiMargin || cy > roi_.y + roi_.h + kRoiMargin;
}

std::vector<EventOut> EventEngine::step(const std::vector<TrackOutput>& tracks,
                                        long long now_ms, std::uint64_t frame_idx) {
    std::vector<EventOut> out;
    for (const TrackOutput& t : tracks) {
        const double cx = t.x + t.w * 0.5;
        const double cy = t.y + t.h * 0.5;
        TrackState& s = st_[t.track_id];
        s.last_seen = frame_idx;
        if (!s.seen) {
            // Silent initialization: a track born inside the ROI or on one
            // side of the line has not OBSERVED a transition, so nothing
            // fires — the first real crossing still emits.
            s.seen = true;
            s.last_cx = cx;
            s.last_cy = cy;
            s.last_side = has_line_ ? side_of(cx, cy) : 0;
            s.roi_inside = has_roi_ && roi_enter_strict(cx, cy);
            continue;
        }

        if (has_line_) {
            const int side = side_of(cx, cy);
            if (side != 0 && s.last_side != 0 && side != s.last_side) {
                // Direction from the dominant motion axis vs line orientation:
                // vertical line -> L2R/R2L, horizontal line -> T2B/B2T.
                const bool vertical_line =
                    std::fabs(line_.y2 - line_.y1) >= std::fabs(line_.x2 - line_.x1);
                const char* dir = vertical_line ? (cx > s.last_cx ? "L2R" : "R2L")
                                                : (cy > s.last_cy ? "T2B" : "B2T");
                EventOut e;
                e.type = "LINE_CROSS";
                e.ts_ms = now_ms;
                e.track_id = t.track_id;
                e.label = obj_class_name(t.cls);
                e.payload = std::string("{\"direction\":\"") + dir + "\"}";
                out.push_back(e);
            }
            if (side != 0) s.last_side = side;
        }

        if (has_roi_) {
            if (!s.roi_inside && roi_enter_strict(cx, cy)) {
                s.roi_inside = true;
                EventOut e;
                e.type = "ROI_ENTER";
                e.ts_ms = now_ms;
                e.track_id = t.track_id;
                e.label = obj_class_name(t.cls);
                e.payload = "{}";
                out.push_back(e);
            } else if (s.roi_inside && roi_exit_loose(cx, cy)) {
                s.roi_inside = false;
                EventOut e;
                e.type = "ROI_EXIT";
                e.ts_ms = now_ms;
                e.track_id = t.track_id;
                e.label = obj_class_name(t.cls);
                e.payload = "{}";
                out.push_back(e);
            }
        }

        s.last_cx = cx;
        s.last_cy = cy;
    }

    // Prune state of dead tracks (bounded memory).
    if (!st_.empty()) {
        std::vector<std::uint64_t> dead;
        dead.reserve(8);
        for (const auto& kv : st_) {
            if (frame_idx - kv.second.last_seen > kStatePruneFrames) dead.push_back(kv.first);
        }
        for (std::uint64_t k : dead) st_.erase(k);
    }
    emitted_total_ += static_cast<std::uint64_t>(out.size());
    return out;
}

}  // namespace ev
