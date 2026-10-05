// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

#include "performance_monitor.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <unistd.h>

namespace ev {
namespace {

constexpr std::size_t kMaxSamples = 512;
constexpr std::chrono::milliseconds kWindowSpan(2000);

// utime+stime (seconds) of THIS process from /proc/self/stat. The comm field
// may contain spaces/parens, so parsing starts after the LAST ')'.
bool read_proc_cpu_seconds(double& cpu_seconds) {
    std::FILE* f = std::fopen("/proc/self/stat", "r");
    if (f == nullptr) return false;
    char buf[4096];
    const std::size_t got = std::fread(buf, 1, sizeof buf - 1, f);
    std::fclose(f);
    if (got == 0) return false;
    buf[got] = '\0';
    char* rp = std::strrchr(buf, ')');
    if (rp == nullptr) return false;
    // Walk whitespace-separated tokens after ')' (the first is field 3,
    // "state"); utime/stime are fields 14/15. from_chars needs no NUL.
    long long utime = -1;
    long long stime = -1;
    int field = 3;
    const char* p = rp + 1;
    while (*p != '\0') {
        while (*p == ' ' || *p == '\n') ++p;
        if (*p == '\0') break;
        const char* tok = p;
        while (*p != '\0' && *p != ' ' && *p != '\n') ++p;
        if (field == 14) {
            if (std::from_chars(tok, p, utime).ec != std::errc{}) return false;
        } else if (field == 15) {
            if (std::from_chars(tok, p, stime).ec != std::errc{}) return false;
            break;
        }
        ++field;
    }
    if (utime < 0 || stime < 0) return false;
    const long tps = ::sysconf(_SC_CLK_TCK);
    if (tps <= 0) return false;
    cpu_seconds = (static_cast<double>(utime) + static_cast<double>(stime)) /
                  static_cast<double>(tps);
    return true;
}

// VmRSS in MB from /proc/self/status.
double read_memory_mb() {
    std::FILE* f = std::fopen("/proc/self/status", "r");
    if (f == nullptr) return 0.0;
    char line[256];
    double mb = 0.0;
    while (std::fgets(line, sizeof line, f) != nullptr) {
        if (std::strncmp(line, "VmRSS:", 6) == 0) {
            const unsigned long long kb = std::strtoull(line + 6, nullptr, 10);
            mb = static_cast<double>(kb) / 1024.0;
            break;
        }
    }
    std::fclose(f);
    return mb;
}

double fps_of(const std::deque<SteadyTp>& q, const SteadyTp& now) {
    if (q.size() < 2) return 0.0;
    const double span = std::chrono::duration<double>(now - q.front()).count();
    if (span < 0.05) return 0.0;
    return static_cast<double>(q.size() - 1) / span;
}

}  // namespace

PerformanceMonitor::PerformanceMonitor() = default;

void PerformanceMonitor::record_source() {
    const SteadyTp now = SteadyClock::now();
    std::lock_guard<std::mutex> lk(m_);
    src_times_.push_back(now);
    while (src_times_.size() > kMaxSamples || src_times_.front() < now - kWindowSpan) {
        src_times_.pop_front();
    }
}

void PerformanceMonitor::record_processed(double latency_ms) {
    const SteadyTp now = SteadyClock::now();
    std::lock_guard<std::mutex> lk(m_);
    proc_times_.push_back(now);
    latencies_.push_back(latency_ms);
    while (proc_times_.size() > kMaxSamples || proc_times_.front() < now - kWindowSpan) {
        proc_times_.pop_front();
        latencies_.pop_front();
    }
}

void PerformanceMonitor::trim_locked(const SteadyTp& now) {
    while (src_times_.size() > kMaxSamples || (!src_times_.empty() &&
                                                src_times_.front() < now - kWindowSpan)) {
        src_times_.pop_front();
    }
}

PerformanceMonitor::Snapshot PerformanceMonitor::snapshot() {
    Snapshot snap;
    const SteadyTp now = SteadyClock::now();
    {
        std::lock_guard<std::mutex> lk(m_);
        trim_locked(now);
        snap.source_fps = fps_of(src_times_, now);
        snap.processed_fps = fps_of(proc_times_, now);
        if (!latencies_.empty()) {
            double sum = 0.0;
            double mn = latencies_.front();
            double mx = latencies_.front();
            for (double v : latencies_) {
                sum += v;
                if (v < mn) mn = v;
                if (v > mx) mx = v;
            }
            std::vector<double> sorted(latencies_.begin(), latencies_.end());
            std::sort(sorted.begin(), sorted.end());
            const std::size_t n = sorted.size();
            snap.lat_avg_ms = sum / static_cast<double>(n);
            snap.lat_min_ms = mn;
            snap.lat_max_ms = mx;
            snap.lat_p50_ms = sorted[(n - 1) / 2];
            snap.lat_p95_ms =
                sorted[static_cast<std::size_t>(std::ceil(0.95 * static_cast<double>(n - 1)))];
        }
    }

    // CPU: utime+stime delta between consecutive metrics ticks vs wall time.
    double cpu = 0.0;
    if (read_proc_cpu_seconds(cpu)) {
        if (have_cpu_) {
            const double wall = std::chrono::duration<double>(now - prev_cpu_time_).count();
            if (wall > 0.01) {
                snap.cpu_percent = (cpu - prev_cpu_seconds_) / wall * 100.0;
                if (snap.cpu_percent < 0.0) snap.cpu_percent = 0.0;
            }
        }
        prev_cpu_seconds_ = cpu;
        prev_cpu_time_ = now;
        have_cpu_ = true;
    }
    snap.memory_mb = read_memory_mb();
    return snap;
}

}  // namespace ev
