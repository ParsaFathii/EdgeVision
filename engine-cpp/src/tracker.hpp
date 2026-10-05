// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// IoU nearest-neighbour tracker (SORT family, no motion model).
#pragma once

#include <cstdint>
#include <vector>

#include "detector.hpp"
#include "types.hpp"

namespace ev {

// One confirmed tracker output for the current frame.
struct TrackOutput {
    std::uint64_t track_id = 0;
    ObjClass cls = ObjClass::Vehicle;
    double conf = 0.0;
    double x = 0.0, y = 0.0, w = 0.0, h = 0.0;  // top-left, normalized
};

// Matching: greedy highest-IoU pairs with a minIoU gate. Track lifecycle:
// TENTATIVE -> CONFIRMED after minHits CONSECUTIVE hits (hit streak), deleted
// after maxAge missed frames. Only CONFIRMED tracks matched THIS frame are
// output — "matched now" (time_since_update == 0) is tracked explicitly and
// separately from "matched last frame" (the bug lesson from the previous
// build: those two states must never be conflated).
class Tracker {
public:
    Tracker(int min_hits, int max_age, double min_iou);

    std::vector<TrackOutput> step(const std::vector<Detection>& dets);

    std::size_t track_count() const { return tracks_.size(); }

private:
    struct Track {
        std::uint64_t id = 0;
        ObjClass cls = ObjClass::Vehicle;
        double conf = 0.0;
        double x = 0.0, y = 0.0, w = 0.0, h = 0.0;
        int hits = 0;
        int hit_streak = 0;         // consecutive hits (resets on any miss)
        int time_since_update = 0;  // 0 == matched THIS frame
        bool confirmed = false;
    };

    int min_hits_;
    int max_age_;
    double min_iou_;
    std::vector<Track> tracks_;
    std::uint64_t next_id_ = 1;  // stable, monotonic track ids
};

}  // namespace ev
