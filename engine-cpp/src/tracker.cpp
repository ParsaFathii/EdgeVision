// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

#include "tracker.hpp"

#include <algorithm>

namespace ev {

Tracker::Tracker(int min_hits, int max_age, double min_iou)
    : min_hits_(min_hits), max_age_(max_age), min_iou_(min_iou) {}

std::vector<TrackOutput> Tracker::step(const std::vector<Detection>& dets) {
    // Greedy IoU matching: highest-IoU (track, detection) pairs win; each
    // track and each detection is used at most once. Total-order comparator
    // keeps the assignment deterministic run-to-run.
    struct Pair {
        double iou;
        std::size_t t;
        std::size_t d;
    };
    std::vector<Pair> pairs;
    for (std::size_t ti = 0; ti < tracks_.size(); ++ti) {
        for (std::size_t di = 0; di < dets.size(); ++di) {
            const double iou = box_iou({tracks_[ti].x, tracks_[ti].y, tracks_[ti].w,
                                        tracks_[ti].h},
                                       {dets[di].x, dets[di].y, dets[di].w, dets[di].h});
            if (iou >= min_iou_) pairs.push_back(Pair{iou, ti, di});
        }
    }
    std::sort(pairs.begin(), pairs.end(), [](const Pair& a, const Pair& b) {
        if (a.iou != b.iou) return a.iou > b.iou;
        if (a.t != b.t) return a.t < b.t;
        return a.d < b.d;
    });
    std::vector<char> t_used(tracks_.size(), 0);
    std::vector<char> d_used(dets.size(), 0);
    std::vector<int> match_of_track(tracks_.size(), -1);
    for (const Pair& p : pairs) {
        if (t_used[p.t] || d_used[p.d]) continue;
        t_used[p.t] = 1;
        d_used[p.d] = 1;
        match_of_track[p.t] = static_cast<int>(p.d);
    }

    // 1) Update matched tracks. match_of_track >= 0 is "matched NOW";
    //    time_since_update == 0 afterwards means "matched LAST frame".
    std::vector<TrackOutput> out;
    for (std::size_t ti = 0; ti < tracks_.size(); ++ti) {
        Track& tr = tracks_[ti];
        const int di = match_of_track[ti];
        if (di >= 0) {
            const Detection& d = dets[static_cast<std::size_t>(di)];
            tr.x = d.x;
            tr.y = d.y;
            tr.w = d.w;
            tr.h = d.h;
            tr.cls = d.cls;
            tr.conf = d.conf;
            tr.time_since_update = 0;
            ++tr.hits;
            ++tr.hit_streak;
            if (!tr.confirmed && tr.hit_streak >= min_hits_) tr.confirmed = true;
            if (tr.confirmed) {
                out.push_back(TrackOutput{tr.id, tr.cls, tr.conf, tr.x, tr.y, tr.w, tr.h});
            }
        } else {
            // Missed this frame: streak breaks, track ages (still reportable
            // via internal state until maxAge kills it — but not emitted).
            ++tr.time_since_update;
            tr.hit_streak = 0;
        }
    }

    // 2) Delete stale tracks.
    tracks_.erase(std::remove_if(tracks_.begin(), tracks_.end(),
                                 [this](const Track& tr) {
                                     return tr.time_since_update > max_age_;
                                 }),
                  tracks_.end());

    // 3) Spawn tentative tracks for unmatched detections.
    for (std::size_t di = 0; di < dets.size(); ++di) {
        if (d_used[di]) continue;
        Track tr;
        tr.id = next_id_++;
        const Detection& d = dets[di];
        tr.cls = d.cls;
        tr.conf = d.conf;
        tr.x = d.x;
        tr.y = d.y;
        tr.w = d.w;
        tr.h = d.h;
        tr.hits = 1;
        tr.hit_streak = 1;
        tr.time_since_update = 0;
        tr.confirmed = false;
        tracks_.push_back(tr);
    }
    return out;
}

}  // namespace ev
