// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Sliding-window performance monitor. Every value it reports is MEASURED:
// frame rates from actual arrival/processing timestamps, latency from the
// steady clock around the pipeline stage, CPU from /proc/self/stat deltas,
// memory from /proc/self/status VmRSS. Nothing is fabricated.
#pragma once

#include <chrono>
#include <deque>
#include <mutex>
#include <vector>

#include "types.hpp"

namespace ev {

class PerformanceMonitor {
public:
    // Sliding window: ~2 seconds AND at most 512 samples per stream.
    PerformanceMonitor();

    // Producer thread: call once per generated frame.
    void record_source();

    // Consumer thread: call once per processed frame with the measured
    // wall-clock latency (ms) of detect+track+events+emit.
    void record_processed(double latency_ms);

    struct Snapshot {
        double source_fps = 0.0;
        double processed_fps = 0.0;
        double lat_avg_ms = 0.0;
        double lat_min_ms = 0.0;
        double lat_max_ms = 0.0;
        double lat_p50_ms = 0.0;
        double lat_p95_ms = 0.0;
        double cpu_percent = 0.0;
        double memory_mb = 0.0;
    };

    // Consumer thread, once per metrics tick. Advances the CPU baseline
    // (utime+stime delta vs wall time between ticks).
    Snapshot snapshot();

private:
    void trim_locked(const SteadyTp& now);

    std::mutex m_;
    std::deque<SteadyTp> src_times_;
    std::deque<SteadyTp> proc_times_;
    std::deque<double> latencies_;
    bool have_cpu_ = false;
    double prev_cpu_seconds_ = 0.0;
    SteadyTp prev_cpu_time_{};
};

}  // namespace ev
