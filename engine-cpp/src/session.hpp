// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Session orchestration: producer thread (scene -> bounded queue), consumer
// loop (pop -> detect -> track -> events -> emit), non-blocking stdin command
// polling, signals, metrics ticks and the DEGRADED hysteresis state machine.
#pragma once

#include <atomic>
#include <condition_variable>
#include <mutex>
#include <string>
#include <thread>

#include "config.hpp"
#include "detector.hpp"
#include "events.hpp"
#include "frame_queue.hpp"
#include "performance_monitor.hpp"
#include "scene.hpp"
#include "tracker.hpp"
#include "types.hpp"

namespace ev {

class Session {
public:
    explicit Session(const Config& cfg);

    // Runs the session to completion; returns the process exit code
    // (0 graceful, 3 internal error — an error line is emitted here).
    int run();

private:
    enum class RunState { Running, Degraded };

    void install_signals();
    void producer_loop();
    void consumer_loop(const SteadyTp& start);
    void pump_stdin();
    void handle_command(const std::string& cmd);
    void request_stop(const char* reason);
    void evaluate_state(const SteadyTp& start);

    bool emit_line(const std::string& content);
    bool emit_state_line(const char* state);
    bool emit_frame(const Frame& f, const std::vector<TrackOutput>& tracks,
                    double latency_ms);
    bool emit_event(const EventOut& e);
    void emit_metrics_tick(const SteadyTp& start);
    bool emit_session_end(long long uptime_ms, unsigned long long dropped);
    bool emit_session_stopped(long long uptime_ms, unsigned long long dropped);

    const Config cfg_;
    Scene scene_;
    FrameQueue queue_;
    Detector detector_;
    Tracker tracker_;
    EventEngine event_engine_;
    PerformanceMonitor monitor_;

    std::thread producer_;
    std::mutex pcv_m_;             // producer sleep/wakeup
    std::condition_variable pcv_;
    std::atomic<bool> stop_flag_{false};
    std::string reason_ = "user_stop";
    std::string stdin_buf_;

    int emit_stride_;
    RunState state_ = RunState::Running;
    SteadyTp below_since_{};   // DEGRADED hysteresis: below-threshold since
    SteadyTp above_since_{};   // DEGRADED hysteresis: recovered since
    SteadyTp last_metrics_{};
    PerformanceMonitor::Snapshot last_snap_{};

    std::uint64_t frames_processed_ = 0;
    std::uint64_t detections_total_ = 0;
    std::uint64_t events_total_ = 0;  // real events; SESSION_END excluded
    std::uint64_t frame_seq_ = 0;
};

}  // namespace ev
