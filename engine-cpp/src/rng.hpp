// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Deterministic small PRNG (mulberry32). Determinism matters: the same seed
// must reproduce the exact same scene/detection sequence for a given binary.
#pragma once

#include <cstdint>

namespace ev {

class Rng {
public:
    explicit Rng(std::uint32_t seed) : state_(seed) {}

    std::uint32_t next_u32() {
        state_ += 0x9E3779B9u;
        std::uint32_t z = state_;
        z = (z ^ (z >> 16)) * 0x21F0AAADu;
        z = (z ^ (z >> 15)) * 0x735A2D97u;
        return z ^ (z >> 15);
    }

    // Uniform double in [0, 1) with 24-bit resolution.
    double unit() {
        return static_cast<double>(next_u32() >> 8) * (1.0 / 16777216.0);
    }

    // Uniform double in [lo, hi).
    double range(double lo, double hi) { return lo + unit() * (hi - lo); }

private:
    std::uint32_t state_;
};

}  // namespace ev
