// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Grid-scan detector. It only ever sees rendered footprints (never ground
// truth ids/classes): multi-scale kernel sweep over the inference grid ->
// occupancy threshold -> 4-connected component labeling -> quantized boxes ->
// size/aspect classification -> stability/area-plausibility confidence with
// deterministic per-chain noise. The sweep is real arithmetic proportional to
// grid size — it is the dominant, honestly measured cost of the pipeline.
#pragma once

#include <cstdint>
#include <vector>

#include "config.hpp"
#include "scene.hpp"
#include "types.hpp"

namespace ev {

// One detector output (class filter + confidence threshold applied here).
struct Detection {
    double x = 0.0, y = 0.0, w = 0.0, h = 0.0;  // top-left, normalized
    ObjClass cls = ObjClass::Vehicle;
    double conf = 0.0;
};

class Detector {
public:
    Detector(int cols, int rows, int frame_width, int frame_height, std::uint32_t seed);

    // Reconfigures the inference grid (applied between frames, never mid-frame).
    void set_grid(int cols, int rows);

    void set_output_filter(const ClassFilter& filter, double conf_threshold);

    int grid_cols() const { return cols_; }
    int grid_rows() const { return rows_; }

    // Runs detection over one frame's render state.
    std::vector<Detection> detect(const std::vector<SceneObject>& objs,
                                  std::uint64_t frame_idx);

private:
    // Temporal box chain: gives the confidence model its coverage-stability
    // term and carries the deterministic per-chain noise walk.
    struct Chain {
        int id = 0;
        double x = 0.0, y = 0.0, w = 0.0, h = 0.0;
        double noise = 0.0;
        std::uint64_t last_seen = 0;
        Rng rng{0};
    };

    void recompute_geometry();

    int cols_ = 40;
    int rows_ = 24;
    int width_ = 640;
    int height_ = 360;
    double cell_w_ = 16.0;  // pixels per grid cell
    double cell_h_ = 15.0;
    double sigma_x_ = 5.6;  // fine-channel sigma (pixels, per axis)
    double sigma_y_ = 5.25;
    ClassFilter filter_;
    double conf_threshold_ = 0.05;
    std::uint32_t seed_;

    // Per-frame scratch buffers (reused to keep the hot loop allocation-free).
    std::vector<double> fine_;      // cells: mean fine-channel response
    std::vector<double> coarse_;    // cells: mean coarse-channel response
    std::vector<std::uint8_t> occ_;  // cells: occupancy after threshold
    std::vector<int> label_;        // cells: component id (-1 = background)
    std::vector<int> parent_;       // union-find over component ids
    std::vector<double> inv2sx_;    // per-channel 1/(2*sigma_x^2)
    std::vector<double> inv2sy_;    // per-channel 1/(2*sigma_y^2)

    std::vector<Chain> chains_;
    int next_chain_id_ = 1;
};

}  // namespace ev
