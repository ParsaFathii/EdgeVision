// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Bounded single-producer / single-consumer frame queue.
#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>

#include "scene.hpp"
#include "types.hpp"

namespace ev {

// A frame handed from the producer (scene) to the consumer (pipeline).
struct Frame {
    std::uint64_t index = 0;  // 1-based ordinal, assigned by the producer
    long long ts_ms = 0;      // wall-clock capture time (Unix epoch ms)
    std::vector<SceneObject> objects;
};

class FrameQueue {
public:
    explicit FrameQueue(int capacity);

    // DROP POLICY — push() evicts the OLDEST frame when full (and counts it
    // as dropped) instead of blocking or dropping the new one: live analytics
    // prefers the freshest frames, a stale frame is worth less than current
    // world state once the consumer lags. The producer never blocks on us.
    void push(Frame&& f);

    // Pops the oldest frame (FIFO); waits up to `wait_ms` but always wakes
    // early when `abort` flips true. Returns false on timeout/abort.
    bool pop(Frame& out, int wait_ms, const std::atomic<bool>& abort);

    // Resizes; when shrinking below the current depth the oldest frames are
    // evicted (each counted as dropped) so depth <= capacity always holds.
    void set_capacity(int capacity);

    void abort();                       // wakes a blocked pop (shutdown path)
    int capacity() const;
    int depth() const;
    std::uint64_t dropped_total() const { return dropped_.load(); }

private:
    mutable std::mutex m_;
    std::condition_variable cv_;
    std::deque<Frame> q_;
    int cap_;
    std::atomic<std::uint64_t> dropped_{0};
};

}  // namespace ev
