// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

#include "detector.hpp"

#include <algorithm>
#include <cmath>

namespace ev {
namespace {

// Kernel channel count. Deliberately dense: every (cell, object, channel) is
// evaluated with no distance culling, so per-frame cost is REAL work strictly
// proportional to grid size — this is what latency measures. The fine bank
// (k < kFineChannels) sets occupancy; the coarse bank (k >= kCoarseFirst)
// feeds the sharpness feature of the confidence model.
//
// Sizing (WHY 160): the bank must be heavy enough that a 80x48 grid cannot
// keep up with a 30 fps producer (~53 ms/frame > 33.3 ms period), which is
// what exercises the bounded-queue drop policy under load (smoke scenario g);
// meanwhile 40x24 and 60x36 at 15 fps stay comfortably real-time (~10/~22 ms
// per frame), so default sessions never degrade.
constexpr int kChannels = 160;
constexpr int kFineChannels = 4;
constexpr int kCoarseFirst = 10;
constexpr double kChannelMultStep = 0.25;  // mult_k = 1 + 0.25*k

constexpr double kOccupancyThreshold = 0.5;
constexpr double kFineSigmaCells = 0.35;  // halo ~0.5 cell -> boxes inflate ~1 cell
constexpr std::size_t kMinComponentCells = 2;  // 1-cell specks are noise

// Plausible quantized areas per class (normalized units).
constexpr double kVehicleArea = 0.012;
constexpr double kPedArea = 0.0028;
constexpr double kCyclistArea = 0.0036;

double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

}  // namespace

Detector::Detector(int cols, int rows, int frame_width, int frame_height, std::uint32_t seed)
    : cols_(cols), rows_(rows), width_(frame_width), height_(frame_height), seed_(seed) {
    filter_ = ClassFilter::all();
    recompute_geometry();
}

void Detector::set_grid(int cols, int rows) {
    cols_ = cols;
    rows_ = rows;
    recompute_geometry();
}

void Detector::set_output_filter(const ClassFilter& filter, double conf_threshold) {
    filter_ = filter;
    conf_threshold_ = conf_threshold;
}

void Detector::recompute_geometry() {
    cell_w_ = static_cast<double>(width_) / static_cast<double>(cols_);
    cell_h_ = static_cast<double>(height_) / static_cast<double>(rows_);
    sigma_x_ = kFineSigmaCells * cell_w_;
    sigma_y_ = kFineSigmaCells * cell_h_;
    inv2sx_.resize(static_cast<std::size_t>(kChannels));
    inv2sy_.resize(static_cast<std::size_t>(kChannels));
    for (int k = 0; k < kChannels; ++k) {
        const double mult = 1.0 + kChannelMultStep * static_cast<double>(k);
        const double sx = sigma_x_ * mult;
        const double sy = sigma_y_ * mult;
        inv2sx_[static_cast<std::size_t>(k)] = 1.0 / (2.0 * sx * sx);
        inv2sy_[static_cast<std::size_t>(k)] = 1.0 / (2.0 * sy * sy);
    }
}

std::vector<Detection> Detector::detect(const std::vector<SceneObject>& objs,
                                        std::uint64_t frame_idx) {
    std::vector<Detection> out;
    const std::size_t cols = static_cast<std::size_t>(cols_);
    const std::size_t rows = static_cast<std::size_t>(rows_);
    const std::size_t cells = cols * rows;
    fine_.assign(cells, 0.0);
    coarse_.assign(cells, 0.0);
    occ_.assign(cells, 0);

    // Object rects in pixel space (hoisted out of the cell loop).
    struct PxRect {
        double x, y, w, h;
    };
    std::vector<PxRect> rects(objs.size());
    for (std::size_t i = 0; i < objs.size(); ++i) {
        rects[i].x = objs[i].x * static_cast<double>(width_);
        rects[i].y = objs[i].y * static_cast<double>(height_);
        rects[i].w = objs[i].w * static_cast<double>(width_);
        rects[i].h = objs[i].h * static_cast<double>(height_);
    }

    // Stage 1 — multi-scale kernel sweep (the heavy, grid-proportional stage).
    for (std::size_t r = 0; r < rows; ++r) {
        const double cy = (static_cast<double>(r) + 0.5) * cell_h_;
        for (std::size_t c = 0; c < cols; ++c) {
            const double cx = (static_cast<double>(c) + 0.5) * cell_w_;
            const std::size_t idx = r * cols + c;
            double fine = 0.0;
            double coarse = 0.0;
            for (const PxRect& rc : rects) {
                const double dx = (cx < rc.x) ? (rc.x - cx)
                                              : ((cx > rc.x + rc.w) ? (cx - rc.x - rc.w) : 0.0);
                const double dy = (cy < rc.y) ? (rc.y - cy)
                                              : ((cy > rc.y + rc.h) ? (cy - rc.y - rc.h) : 0.0);
                const double dx2 = dx * dx;
                const double dy2 = dy * dy;
                for (int k = 0; k < kChannels; ++k) {
                    const double resp =
                        std::exp(-dx2 * inv2sx_[static_cast<std::size_t>(k)]) *
                        std::exp(-dy2 * inv2sy_[static_cast<std::size_t>(k)]);
                    if (k < kFineChannels) {
                        fine += resp;
                    } else if (k >= kCoarseFirst) {
                        coarse += resp;
                    }
                }
            }
            fine_[idx] = fine * (1.0 / static_cast<double>(kFineChannels));
            coarse_[idx] = coarse * (1.0 / static_cast<double>(kChannels - kCoarseFirst));
            occ_[idx] = fine_[idx] >= kOccupancyThreshold ? 1 : 0;
        }
    }

    // Stage 2 — connected-component labeling (4-connectivity, union-find).
    label_.assign(cells, -1);
    parent_.clear();
    parent_.reserve(64);
    auto find = [this](int x) {
        while (parent_[static_cast<std::size_t>(x)] != x) {
            const int grand = parent_[static_cast<std::size_t>(
                static_cast<std::size_t>(parent_[static_cast<std::size_t>(x)]))];
            parent_[static_cast<std::size_t>(x)] = grand;
            x = grand;
        }
        return x;
    };
    int n_comp = 0;
    for (std::size_t r = 0; r < rows; ++r) {
        for (std::size_t c = 0; c < cols; ++c) {
            const std::size_t idx = r * cols + c;
            if (occ_[idx] == 0) continue;
            const bool up = (r > 0) && occ_[idx - cols] != 0;
            const bool left = (c > 0) && occ_[idx - 1] != 0;
            if (!up && !left) {
                label_[idx] = n_comp;
                parent_.push_back(n_comp);
                ++n_comp;
            } else if (up && !left) {
                label_[idx] = label_[idx - cols];
            } else if (!up && left) {
                label_[idx] = label_[idx - 1];
            } else {
                const int ru = find(label_[idx - cols]);
                const int rl = find(label_[idx - 1]);
                if (ru == rl) {
                    label_[idx] = ru;
                } else {
                    parent_[static_cast<std::size_t>(ru)] = rl;
                    label_[idx] = rl;
                }
            }
        }
    }

    // Stage 3 — component statistics (bounds, cell count, response sums).
    struct Comp {
        std::size_t min_c, max_c, min_r, max_r, cells;
        double fine_sum, coarse_sum;
    };
    std::vector<Comp> comps(static_cast<std::size_t>(n_comp));
    for (std::size_t i = 0; i < comps.size(); ++i) {
        comps[i].min_c = cols;
        comps[i].max_c = 0;
        comps[i].min_r = rows;
        comps[i].max_r = 0;
        comps[i].cells = 0;
        comps[i].fine_sum = 0.0;
        comps[i].coarse_sum = 0.0;
    }
    for (std::size_t r = 0; r < rows; ++r) {
        for (std::size_t c = 0; c < cols; ++c) {
            const std::size_t idx = r * cols + c;
            if (label_[idx] < 0) continue;
            const std::size_t root = static_cast<std::size_t>(find(label_[idx]));
            Comp& cm = comps[root];
            if (c < cm.min_c) cm.min_c = c;
            if (c > cm.max_c) cm.max_c = c;
            if (r < cm.min_r) cm.min_r = r;
            if (r > cm.max_r) cm.max_r = r;
            ++cm.cells;
            cm.fine_sum += fine_[idx];
            cm.coarse_sum += coarse_[idx];
        }
    }

    // Stage 4 — boxes, classification, temporal chains and confidence.
    for (const Comp& cm : comps) {
        if (cm.cells < kMinComponentCells) continue;
        const double bx = static_cast<double>(cm.min_c) / static_cast<double>(cols_);
        const double by = static_cast<double>(cm.min_r) / static_cast<double>(rows_);
        const double bw =
            static_cast<double>(cm.max_c + 1) / static_cast<double>(cols_) - bx;
        const double bh =
            static_cast<double>(cm.max_r + 1) / static_cast<double>(rows_) - by;
        if (bw <= 0.0 || bh <= 0.0) continue;

        // Size/aspect heuristics on the QUANTIZED box (the cell edges are the
        // real error source). Overlapping objects merge into one component,
        // so heavy occlusion genuinely degrades the detection.
        ObjClass cls;
        if (bw > 0.075) {
            cls = ObjClass::Vehicle;
        } else if (bw >= 0.04 && bh < bw * 1.75) {
            cls = ObjClass::Cyclist;
        } else {
            cls = ObjClass::Pedestrian;
        }

        // Chain match: stability = IoU against the same box one frame ago.
        double stability = 0.35;  // fresh-chain baseline
        std::size_t best_chain = static_cast<std::size_t>(-1);
        double best_iou = 0.25;
        for (std::size_t i = 0; i < chains_.size(); ++i) {
            const Chain& ch = chains_[i];
            const double iou =
                box_iou({ch.x, ch.y, ch.w, ch.h}, {bx, by, bw, bh});
            if (iou > best_iou) {
                best_iou = iou;
                best_chain = i;
            }
        }
        double noise = 0.0;
        if (best_chain != static_cast<std::size_t>(-1)) {
            Chain& ch = chains_[best_chain];
            stability = best_iou;
            ch.x = bx;
            ch.y = by;
            ch.w = bw;
            ch.h = bh;
            ch.last_seen = frame_idx;
            // Deterministic bounded random walk so confidence varies naturally.
            ch.noise = clampd(ch.noise + (ch.rng.unit() - 0.5) * 0.016, -0.05, 0.05);
            noise = ch.noise;
        } else {
            Chain ch;
            ch.id = next_chain_id_++;
            ch.x = bx;
            ch.y = by;
            ch.w = bw;
            ch.h = bh;
            ch.last_seen = frame_idx;
            ch.rng = Rng(seed_ ^
                         (static_cast<std::uint32_t>(ch.id) * 0x9E3779B9u + 0x51ED2701u));
            ch.noise = (ch.rng.unit() - 0.5) * 0.06;
            noise = ch.noise;
            chains_.push_back(ch);
        }

        const double area = bw * bh;
        const double expected = (cls == ObjClass::Vehicle) ? kVehicleArea
                                : (cls == ObjClass::Pedestrian) ? kPedArea
                                                                : kCyclistArea;
        const double plaus = clampd(1.0 - std::fabs(std::log(area / expected)), 0.0, 1.0);
        const double fine_mean = cm.fine_sum / static_cast<double>(cm.cells);
        const double coarse_mean = cm.coarse_sum / static_cast<double>(cm.cells);
        const double sharp = clampd(fine_mean / (coarse_mean + 0.15), 0.0, 1.0);

        const double conf = clampd(
            0.46 + 0.34 * stability + 0.14 * plaus + 0.06 * sharp + noise, 0.2, 0.99);

        // Output filter (class + confidence) is applied HERE, so the tracker
        // only ever sees what the protocol would emit.
        if (filter_.allows(cls) && conf >= conf_threshold_) {
            out.push_back(Detection{bx, by, bw, bh, cls, conf});
        }
    }

    // Prune stale chains — bounded memory over long sessions.
    chains_.erase(std::remove_if(chains_.begin(), chains_.end(),
                                 [frame_idx](const Chain& ch) {
                                     return frame_idx > ch.last_seen + 45;
                                 }),
                  chains_.end());
    return out;
}

}  // namespace ev
