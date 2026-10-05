// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

#include "frame_queue.hpp"

namespace ev {

FrameQueue::FrameQueue(int capacity) : cap_(capacity) {}

void FrameQueue::push(Frame&& f) {
    {
        std::lock_guard<std::mutex> lk(m_);
        // See header for WHY the oldest frame is the eviction victim.
        while (static_cast<int>(q_.size()) >= cap_) {
            q_.pop_front();
            dropped_.fetch_add(1);
        }
        q_.push_back(std::move(f));
    }
    cv_.notify_one();
}

bool FrameQueue::pop(Frame& out, int wait_ms, const std::atomic<bool>& abort) {
    std::unique_lock<std::mutex> lk(m_);
    const bool ok = cv_.wait_for(lk, std::chrono::milliseconds(wait_ms), [&] {
        return abort.load() || !q_.empty();
    });
    if (!ok || q_.empty()) return false;
    out = std::move(q_.front());
    q_.pop_front();
    return true;
}

void FrameQueue::set_capacity(int capacity) {
    std::lock_guard<std::mutex> lk(m_);
    cap_ = capacity;
    while (static_cast<int>(q_.size()) > cap_) {
        q_.pop_front();
        dropped_.fetch_add(1);
    }
}

void FrameQueue::abort() { cv_.notify_all(); }

int FrameQueue::capacity() const {
    std::lock_guard<std::mutex> lk(m_);
    return cap_;
}

int FrameQueue::depth() const {
    std::lock_guard<std::mutex> lk(m_);
    return static_cast<int>(q_.size());
}

}  // namespace ev
