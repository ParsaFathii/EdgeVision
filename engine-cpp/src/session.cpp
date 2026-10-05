// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

#include "session.hpp"

#include <csignal>
#include <cstdio>
#include <cstring>
#include <poll.h>
#include <unistd.h>

#include <utility>
#include <vector>

#include "emit.hpp"
#include "json_out.hpp"

namespace ev {
namespace {

// Async-signal-safe: only flip a flag; the consumer loop notices it.
volatile std::sig_atomic_t g_stop_signal = 0;

void on_signal(int) { g_stop_signal = 1; }

std::string trim_copy(const std::string& s) {
    std::size_t a = 0;
    std::size_t b = s.size();
    while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\r')) ++a;
    while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r')) --b;
    return s.substr(a, b - a);
}

const char* scene_name(Config::SceneKind k) {
    switch (k) {
        case Config::SceneKind::Street: return "STREET";
        case Config::SceneKind::Intersection: return "INTERSECTION";
        case Config::SceneKind::Parking: return "PARKING";
    }
    return "?";
}

}  // namespace

Session::Session(const Config& cfg)
    : cfg_(cfg),
      scene_(cfg.scene, cfg.objects, cfg.seed),
      queue_(cfg.queue_capacity),
      detector_(cfg.grid_cols, cfg.grid_rows, cfg.width, cfg.height, cfg.seed),
      // Tracker params are frozen from the previous build's lessons:
      // minHits=3, maxAge=12, minIoU=0.3.
      tracker_(3, 12, 0.3),
      emit_stride_(cfg.emit_stride) {
    const GeoLine line{cfg.line_x1, cfg.line_y1, cfg.line_x2, cfg.line_y2};
    const GeoRect roi{cfg.roi_x, cfg.roi_y, cfg.roi_w, cfg.roi_h};
    event_engine_.configure(cfg.has_line ? &line : nullptr, cfg.has_roi ? &roi : nullptr);
    detector_.set_output_filter(cfg.class_filter, cfg.confidence);
    install_signals();
}

void Session::install_signals() {
    // SIGTERM/SIGINT -> graceful stop (reason "signal"). SIGPIPE is ignored:
    // a dead parent shows up as a write() error we handle, not a kill signal.
    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);
    std::signal(SIGPIPE, SIG_IGN);
}

bool Session::emit_line(const std::string& content) {
    if (!emit::line(content)) {
        std::fprintf(stderr, "[engine] stdout write failed; shutting down\n");
        return false;
    }
    return true;
}

int Session::run() {
    const SteadyTp start = SteadyClock::now();

    {
        json::Line l;
        l.raw("{\"type\":\"ready\",\"engine\":\"edgevision-cpp\",\"version\":\"")
            .raw(kEngineVersion)
            .raw("\"}");
        if (!emit_line(l.s)) return 0;
    }
    {
        json::Line l;
        l.raw("{\"type\":\"session_started\",\"sessionId\":")
            .esc(cfg_.session_id)
            .raw(",\"streamId\":")
            .esc(cfg_.stream_id)
            .raw(",\"ts\":")
            .i(epoch_now_ms())
            .raw("}");
        if (!emit_line(l.s)) return 0;
    }
    if (!emit_state_line("RUNNING")) return 0;
    std::fprintf(stderr,
                 "[engine] session %s stream %s scene=%s grid=%dx%d fps=%.3f objects=%d "
                 "queue=%d conf=%.3f stride=%d\n",
                 cfg_.session_id.c_str(), cfg_.stream_id.c_str(), scene_name(cfg_.scene),
                 cfg_.grid_cols, cfg_.grid_rows, cfg_.target_fps, cfg_.objects,
                 cfg_.queue_capacity, cfg_.confidence, emit_stride_);

    // Prime the CPU baseline so the first metrics tick has a full window.
    (void)monitor_.snapshot();

    producer_ = std::thread([this] { producer_loop(); });
    last_metrics_ = SteadyClock::now();

    int rc = 0;
    std::string internal_error;
    try {
        consumer_loop(start);
    } catch (const std::exception& e) {
        internal_error = e.what();
        rc = 3;
    }

    // ---- graceful shutdown funnel (identical for user_stop/eof/signal) ----
    stop_flag_.store(true);
    queue_.abort();
    {
        std::lock_guard<std::mutex> lk(pcv_m_);
    }
    pcv_.notify_all();
    if (producer_.joinable()) producer_.join();

    const long long uptime_ms = ms_int_since(start);
    const unsigned long long dropped = queue_.dropped_total();

    if (rc == 0) {
        // SESSION_END event first, session_stopped is the terminal line.
        (void)emit_session_end(uptime_ms, dropped);
        (void)emit_session_stopped(uptime_ms, dropped);
    } else {
        json::Line l;
        l.raw("{\"type\":\"error\",\"code\":\"INTERNAL\",\"message\":")
            .esc(internal_error)
            .raw(",\"ts\":")
            .i(epoch_now_ms())
            .raw("}");
        (void)emit_line(l.s);
    }
    return rc;
}

void Session::producer_loop() {
    const double dt = 1.0 / cfg_.target_fps;
    const auto period =
        std::chrono::duration_cast<std::chrono::steady_clock::duration>(
            std::chrono::duration<double>(dt));
    SteadyTp next = SteadyClock::now() + period;
    while (!stop_flag_.load()) {
        // Sleep until the next tick in <=100 ms slices so shutdown never
        // waits more than 100 ms on this thread.
        {
            std::unique_lock<std::mutex> lk(pcv_m_);
            while (!stop_flag_.load() && SteadyClock::now() < next) {
                const SteadyTp now = SteadyClock::now();
                const SteadyTp lim =
                    (next < now + std::chrono::milliseconds(100))
                        ? next
                        : now + std::chrono::milliseconds(100);
                pcv_.wait_until(lk, lim);
            }
        }
        if (stop_flag_.load()) break;

        scene_.step(dt);
        Frame f;
        f.index = ++frame_seq_;
        f.ts_ms = epoch_now_ms();
        f.objects = scene_.objects();
        queue_.push(std::move(f));
        monitor_.record_source();

        const SteadyTp now = SteadyClock::now();
        next += period;
        if (now > next) next = now + period;  // resync after a stall: no burst catch-up
    }
}

void Session::consumer_loop(const SteadyTp& start) {
    Frame f;
    while (!stop_flag_.load()) {
        if (queue_.pop(f, 20, stop_flag_)) {
            const SteadyTp t0 = SteadyClock::now();
            const std::vector<Detection> dets = detector_.detect(f.objects, f.index);
            const std::vector<TrackOutput> tracks = tracker_.step(dets);
            const std::vector<EventOut> evs =
                event_engine_.step(tracks, epoch_now_ms(), f.index);
            for (const EventOut& e : evs) {
                if (!emit_event(e)) return;
                ++events_total_;
            }
            // latencyMs of the frame line covers detect+track+events (+serialization
            // start); the monitor additionally records the emit cost.
            const double lat_pre = ms_since(t0);
            if (emit_stride_ > 0 &&
                f.index % static_cast<std::uint64_t>(emit_stride_) == 0) {
                if (!emit_frame(f, tracks, lat_pre)) return;
            }
            monitor_.record_processed(ms_since(t0));
            ++frames_processed_;
            detections_total_ += static_cast<std::uint64_t>(tracks.size());
        }

        pump_stdin();
        if (g_stop_signal != 0) request_stop("signal");
        if (stop_flag_.load()) break;

        const SteadyTp now = SteadyClock::now();
        if (now - last_metrics_ >= std::chrono::milliseconds(cfg_.metrics_interval_ms)) {
            last_metrics_ = now;
            emit_metrics_tick(start);
            evaluate_state(start);
        }
    }
}

void Session::pump_stdin() {
    // NON-BLOCKING stdin poll between frames — the pipeline must never stall
    // on stdin (commands are tiny and arrive at human/API cadence).
    struct pollfd pfd;
    pfd.fd = STDIN_FILENO;
    pfd.events = POLLIN;
    pfd.revents = 0;
    const int rc = ::poll(&pfd, 1, 0);
    if (rc <= 0) return;
    if ((pfd.revents & (POLLIN | POLLHUP)) == 0) return;
    char buf[1024];
    const ssize_t n = ::read(STDIN_FILENO, buf, sizeof buf);
    if (n < 0) {
        if (errno == EINTR || errno == EAGAIN) return;
        request_stop("eof");  // stdin unreadable — treat like EOF
        return;
    }
    if (n == 0) {
        request_stop("eof");  // parent closed stdin
        return;
    }
    stdin_buf_.append(buf, static_cast<std::size_t>(n));
    std::size_t nl;
    while ((nl = stdin_buf_.find('\n')) != std::string::npos) {
        std::string line = stdin_buf_.substr(0, nl);
        stdin_buf_.erase(0, nl + 1);
        handle_command(trim_copy(line));
        if (stop_flag_.load()) return;
    }
}

void Session::handle_command(const std::string& cmd) {
    if (cmd.empty()) return;
    if (cmd == "stop") {
        request_stop("user_stop");
        return;
    }
    if (cmd == "ping") {
        json::Line l;
        l.raw("{\"type\":\"pong\",\"ts\":").i(epoch_now_ms()).raw("}");
        (void)emit_line(l.s);
        return;
    }
    if (cmd.rfind("set ", 0) == 0) {
        const std::string rest = cmd.substr(4);
        if (rest.rfind("grid ", 0) == 0) {
            int cols = 0;
            int rows = 0;
            if (!parse_grid_spec(rest.substr(5), cols, rows)) {
                std::fprintf(stderr, "[engine] ignoring invalid set grid: %s\n", rest.c_str());
                return;
            }
            detector_.set_grid(cols, rows);
        } else if (rest.rfind("queue ", 0) == 0) {
            long long v = 0;
            if (!parse_ll_strict(rest.substr(6), v) || v < 5 || v > 200) {
                std::fprintf(stderr, "[engine] ignoring invalid set queue: %s\n", rest.c_str());
                return;
            }
            queue_.set_capacity(static_cast<int>(v));
        } else if (rest.rfind("emit-stride ", 0) == 0) {
            long long v = 0;
            if (!parse_ll_strict(rest.substr(12), v) || v < 1 || v > 1000) {
                std::fprintf(stderr, "[engine] ignoring invalid set emit-stride: %s\n",
                             rest.c_str());
                return;
            }
            emit_stride_ = static_cast<int>(v);
        } else {
            std::fprintf(stderr, "[engine] ignoring unknown set command: %s\n", cmd.c_str());
            return;
        }
        // Applied inline in the consumer thread = the safe point.
        json::Line l;
        l.raw("{\"type\":\"settings_applied\",\"grid\":\"")
            .raw(std::to_string(detector_.grid_cols()).c_str())
            .raw("x")
            .raw(std::to_string(detector_.grid_rows()).c_str())
            .raw("\",\"queueCapacity\":")
            .u(static_cast<unsigned long long>(queue_.capacity()))
            .raw(",\"emitStride\":")
            .i(emit_stride_)
            .raw(",\"ts\":")
            .i(epoch_now_ms())
            .raw("}");
        (void)emit_line(l.s);
        return;
    }
    std::fprintf(stderr, "[engine] ignoring unknown command: %s\n", cmd.c_str());
}

void Session::request_stop(const char* reason) {
    if (stop_flag_.load()) return;  // first stop request wins (reason kept)
    reason_ = reason;
    stop_flag_.store(true);
    std::fprintf(stderr, "[engine] stopping: reason=%s\n", reason);
}

bool Session::emit_state_line(const char* state) {
    json::Line l;
    l.raw("{\"type\":\"state\",\"state\":\"").raw(state).raw("\",\"ts\":").i(epoch_now_ms()).raw("}");
    return emit_line(l.s);
}

bool Session::emit_frame(const Frame& f, const std::vector<TrackOutput>& tracks,
                         double latency_ms) {
    json::Line l;
    l.raw("{\"type\":\"frame\",\"frameIndex\":")
        .u(f.index)
        .raw(",\"ts\":")
        .i(f.ts_ms)
        .raw(",\"latencyMs\":")
        .f(latency_ms)
        .raw(",\"objects\":[");
    bool first = true;
    for (const SceneObject& o : f.objects) {
        if (!first) l.raw(',');
        first = false;
        l.raw("{\"oid\":")
            .i(o.oid)
            .raw(",\"t\":\"")
            .raw(obj_class_name(o.cls))
            .raw("\",\"x\":")
            .f(o.x)
            .raw(",\"y\":")
            .f(o.y)
            .raw(",\"w\":")
            .f(o.w)
            .raw(",\"h\":")
            .f(o.h)
            .raw("}");
    }
    l.raw("],\"detections\":[");
    first = true;
    for (const TrackOutput& t : tracks) {
        if (!first) l.raw(',');
        first = false;
        l.raw("{\"trackId\":")
            .u(t.track_id)
            .raw(",\"label\":\"")
            .raw(obj_class_name(t.cls))
            .raw("\",\"conf\":")
            .f(t.conf)
            .raw(",\"x\":")
            .f(t.x)
            .raw(",\"y\":")
            .f(t.y)
            .raw(",\"w\":")
            .f(t.w)
            .raw(",\"h\":")
            .f(t.h)
            .raw("}");
    }
    l.raw("]}");
    return emit_line(l.s);
}

bool Session::emit_event(const EventOut& e) {
    json::Line l;
    l.raw("{\"type\":\"event\",\"ev\":{\"type\":\"")
        .raw(e.type)
        .raw("\",\"ts\":")
        .i(e.ts_ms)
        .raw(",\"trackId\":")
        .u(e.track_id)
        .raw(",\"label\":\"")
        .raw(e.label)
        .raw("\",\"payload\":")
        .raw(e.payload.empty() ? "{}" : e.payload.c_str())
        .raw("}}");
    return emit_line(l.s);
}

void Session::emit_metrics_tick(const SteadyTp& start) {
    const PerformanceMonitor::Snapshot snap = monitor_.snapshot();
    last_snap_ = snap;
    json::Line l;
    l.raw("{\"type\":\"metrics\",\"ts\":")
        .i(epoch_now_ms())
        .raw(",\"sourceFps\":")
        .f(snap.source_fps)
        .raw(",\"processedFps\":")
        .f(snap.processed_fps)
        .raw(",\"latency\":{\"avgMs\":")
        .f(snap.lat_avg_ms)
        .raw(",\"minMs\":")
        .f(snap.lat_min_ms)
        .raw(",\"maxMs\":")
        .f(snap.lat_max_ms)
        .raw(",\"p50Ms\":")
        .f(snap.lat_p50_ms)
        .raw(",\"p95Ms\":")
        .f(snap.lat_p95_ms)
        .raw("},\"queueDepth\":")
        .u(static_cast<unsigned long long>(queue_.depth()))
        .raw(",\"queueCapacity\":")
        .u(static_cast<unsigned long long>(queue_.capacity()))
        .raw(",\"droppedTotal\":")
        .u(queue_.dropped_total())
        .raw(",\"cpuPercent\":")
        .f(snap.cpu_percent)
        .raw(",\"memoryMb\":")
        .f(snap.memory_mb)
        .raw(",\"framesProcessed\":")
        .u(frames_processed_)
        .raw(",\"detectionsTotal\":")
        .u(detections_total_)
        .raw(",\"uptimeMs\":")
        .i(ms_int_since(start))
        .raw("}");
    (void)emit_line(l.s);
}

void Session::evaluate_state(const SteadyTp& start) {
    // DEGRADED hysteresis (from the previous build's design): enter after
    // processedFps < 0.6*sourceFps sustained 5 s, recover after being above
    // the threshold 10 consecutive seconds; never during the 2 s warmup.
    if (ms_int_since(start) < 2000) return;
    const double src = last_snap_.source_fps;
    const double prc = last_snap_.processed_fps;
    if (src <= 0.0) return;
    const bool below = prc < 0.6 * src;
    const SteadyTp now = SteadyClock::now();
    if (state_ == RunState::Running) {
        if (!below) {
            below_since_ = SteadyTp{};
            return;
        }
        if (below_since_ == SteadyTp{}) below_since_ = now;
        if (now - below_since_ >= std::chrono::seconds(5)) {
            state_ = RunState::Degraded;
            below_since_ = SteadyTp{};
            std::fprintf(stderr,
                         "[engine] state -> DEGRADED (processedFps %.3f < 0.6*sourceFps %.3f)\n",
                         prc, src);
            (void)emit_state_line("DEGRADED");
        }
    } else {
        if (below) {
            above_since_ = SteadyTp{};
            return;
        }
        if (above_since_ == SteadyTp{}) above_since_ = now;
        if (now - above_since_ >= std::chrono::seconds(10)) {
            state_ = RunState::Running;
            above_since_ = SteadyTp{};
            std::fprintf(stderr, "[engine] state -> RUNNING (recovered)\n");
            (void)emit_state_line("RUNNING");
        }
    }
}

bool Session::emit_session_end(long long uptime_ms, unsigned long long dropped) {
    json::Line l;
    l.raw("{\"type\":\"event\",\"ev\":{\"type\":\"SESSION_END\",\"ts\":")
        .i(epoch_now_ms())
        .raw(",\"trackId\":0,\"label\":\"\",\"payload\":{\"framesProcessed\":")
        .u(frames_processed_)
        .raw(",\"framesDropped\":")
        .u(dropped)
        .raw(",\"detectionsTotal\":")
        .u(detections_total_)
        .raw(",\"eventsTotal\":")
        .u(events_total_)
        .raw(",\"uptimeMs\":")
        .i(uptime_ms)
        .raw("}}}");
    return emit_line(l.s);
}

bool Session::emit_session_stopped(long long uptime_ms, unsigned long long dropped) {
    json::Line l;
    l.raw("{\"type\":\"session_stopped\",\"reason\":\"")
        .raw(reason_.c_str())
        .raw("\",\"ts\":")
        .i(epoch_now_ms())
        .raw(",\"summary\":{\"framesProcessed\":")
        .u(frames_processed_)
        .raw(",\"framesDropped\":")
        .u(dropped)
        .raw(",\"detectionsTotal\":")
        .u(detections_total_)
        .raw(",\"eventsTotal\":")
        .u(events_total_)
        .raw(",\"uptimeMs\":")
        .i(uptime_ms)
        .raw("}}");
    return emit_line(l.s);
}

}  // namespace ev
