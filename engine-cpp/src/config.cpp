// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

#include "config.hpp"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

namespace ev {
namespace {

// Compact double formatting for error messages that land on STDOUT: the
// protocol forbids floats with more than 3 decimals, and std::to_string
// always emits six ("0.050000") — %.3g keeps messages protocol-clean.
std::string fmt_double(double v) {
    char b[32];
    std::snprintf(b, sizeof b, "%.3g", v);
    return b;
}

// Everything an id may contain on the wire; anything else is stripped.
constexpr const char* kIdChars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-";
constexpr std::size_t kMaxIdLen = 64;

bool is_digits(const std::string& s) {
    if (s.empty()) return false;
    for (char c : s) {
        if (c < '0' || c > '9') return false;
    }
    return true;
}

bool parse_ll(const std::string& s, long long& out) {
    if (s.empty()) return false;
    std::size_t i = (s[0] == '-' || s[0] == '+') ? 1 : 0;
    if (i >= s.size()) return false;
    for (std::size_t k = i; k < s.size(); ++k) {
        if (s[k] < '0' || s[k] > '9') return false;
    }
    errno = 0;
    char* end = nullptr;
    const long long v = std::strtoll(s.c_str(), &end, 10);
    if (errno != 0 || end == nullptr || *end != '\0') return false;
    out = v;
    return true;
}

bool parse_dbl(const std::string& s, double& out) {
    if (s.empty()) return false;
    errno = 0;
    char* end = nullptr;
    const double v = std::strtod(s.c_str(), &end);
    if (errno != 0 || end == nullptr || *end != '\0') return false;
    out = v;
    return true;
}

// Parses "a,b,c,d" into exactly four doubles (full-string parts).
bool parse_list4(const std::string& s, double v[4]) {
    std::size_t pos = 0;
    for (int i = 0; i < 4; ++i) {
        const std::size_t comma = s.find(',', pos);
        if (i < 3 && comma == std::string::npos) return false;
        const std::string part =
            (i == 3 || comma == std::string::npos) ? s.substr(pos) : s.substr(pos, comma - pos);
        if (!parse_dbl(part, v[i])) return false;
        if (comma == std::string::npos) {
            if (i != 3) return false;
            break;
        }
        pos = comma + 1;
    }
    return true;
}

[[noreturn]] void err(const std::string& msg) { throw ConfigError(msg); }

}  // namespace

std::string sanitize_id(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        if (c != '\0' && std::strchr(kIdChars, c) != nullptr) out.push_back(c);
        if (out.size() >= kMaxIdLen) break;
    }
    return out;
}

bool parse_ll_strict(const std::string& s, long long& out) { return parse_ll(s, out); }

bool parse_grid_spec(const std::string& s, int& cols, int& rows) {
    const std::size_t x = s.find('x');
    if (x == std::string::npos || x == 0 || x + 1 >= s.size()) return false;
    long long cv = 0;
    long long rv = 0;
    if (!parse_ll(s.substr(0, x), cv) || !parse_ll(s.substr(x + 1), rv)) return false;
    if (cv < 16 || cv > 80 || rv < 9 || rv > 48) return false;
    cols = static_cast<int>(cv);
    rows = static_cast<int>(rv);
    return true;
}

Config parse_config(int argc, char** argv) {
    Config c;
    bool have_session = false, have_stream = false, have_seed = false, have_scene = false;
    bool have_width = false, have_height = false, have_fps = false, have_objects = false;
    bool have_queue = false, have_conf = false, have_grid = false;

    for (int i = 1; i < argc; ++i) {
        const std::string flag = argv[i];
        auto value = [&]() -> std::string {
            if (i + 1 >= argc) err("missing value for " + flag);
            return argv[++i];
        };
        auto ll = [&]() -> long long {
            long long v = 0;
            if (!parse_ll(value(), v)) err(flag + " must be an integer");
            return v;
        };
        auto dbl = [&]() -> double {
            double v = 0;
            if (!parse_dbl(value(), v)) err(flag + " must be a number");
            return v;
        };
        auto in_range_ll = [&](long long lo, long long hi) -> long long {
            const long long v = ll();
            if (v < lo || v > hi)
                err(flag + " must be within " + std::to_string(lo) + ".." + std::to_string(hi));
            return v;
        };
        auto in_range_dbl = [&](double lo, double hi) -> double {
            const double v = dbl();
            if (!(v >= lo) || !(v <= hi))
                err(flag + " must be within " + fmt_double(lo) + ".." + fmt_double(hi));
            return v;
        };

        if (flag == "--session-id") {
            c.session_id = sanitize_id(value());
            if (c.session_id.empty()) err("session-id contains no safe characters");
            have_session = true;
        } else if (flag == "--stream-id") {
            c.stream_id = sanitize_id(value());
            if (c.stream_id.empty()) err("stream-id contains no safe characters");
            have_stream = true;
        } else if (flag == "--seed") {
            const std::string s = value();
            if (!is_digits(s)) err("seed must be an unsigned integer");
            errno = 0;
            char* end = nullptr;
            const unsigned long long v = std::strtoull(s.c_str(), &end, 10);
            if (errno != 0 || end == nullptr || *end != '\0' || v > 4294967295ULL)
                err("seed must be within 0..4294967295");
            c.seed = static_cast<std::uint32_t>(v);
            have_seed = true;
        } else if (flag == "--scene") {
            const std::string v = value();
            if (v == "STREET") c.scene = Config::SceneKind::Street;
            else if (v == "INTERSECTION") c.scene = Config::SceneKind::Intersection;
            else if (v == "PARKING") c.scene = Config::SceneKind::Parking;
            else err("scene must be STREET, INTERSECTION or PARKING");
            have_scene = true;
        } else if (flag == "--width") {
            c.width = static_cast<int>(in_range_ll(320, 1920));
            have_width = true;
        } else if (flag == "--height") {
            c.height = static_cast<int>(in_range_ll(240, 1080));
            have_height = true;
        } else if (flag == "--target-fps") {
            const double v = dbl();
            if (!(v >= 1.0) || !(v <= 30.0)) err("target-fps must be within 1..30");
            c.target_fps = v;
            have_fps = true;
        } else if (flag == "--objects") {
            c.objects = static_cast<int>(in_range_ll(3, 20));
            have_objects = true;
        } else if (flag == "--queue-capacity") {
            c.queue_capacity = static_cast<int>(in_range_ll(5, 200));
            have_queue = true;
        } else if (flag == "--confidence") {
            const double v = in_range_dbl(0.05, 0.95);
            c.confidence = v;
            have_conf = true;
        } else if (flag == "--class-filter") {
            const std::string v = value();
            if (v.empty()) {
                c.class_filter = ClassFilter::all();  // empty = all classes
            } else {
                ClassFilter f = ClassFilter::none();
                std::size_t pos = 0;
                while (true) {
                    const std::size_t comma = v.find(',', pos);
                    const std::string part = (comma == std::string::npos)
                                                 ? v.substr(pos)
                                                 : v.substr(pos, comma - pos);
                    if (part == "PEDESTRIAN") f.pedestrian = true;
                    else if (part == "VEHICLE") f.vehicle = true;
                    else if (part == "CYCLIST") f.cyclist = true;
                    else err("unknown class in class-filter: " + part);
                    if (comma == std::string::npos) break;
                    pos = comma + 1;
                }
                c.class_filter = f;
            }
        } else if (flag == "--roi") {
            double v[4] = {0, 0, 0, 0};
            if (!parse_list4(value(), v)) err("roi must be x,y,w,h");
            for (int k = 0; k < 4; ++k) {
                if (v[k] < 0.0 || v[k] > 1.0) err("roi values must be within 0..1");
            }
            if (v[2] <= 0.0 || v[3] <= 0.0) err("roi w and h must be > 0");
            c.roi_x = v[0];
            c.roi_y = v[1];
            c.roi_w = v[2];
            c.roi_h = v[3];
            c.has_roi = true;
        } else if (flag == "--line") {
            double v[4] = {0, 0, 0, 0};
            if (!parse_list4(value(), v)) err("line must be x1,y1,x2,y2");
            for (int k = 0; k < 4; ++k) {
                if (v[k] < 0.0 || v[k] > 1.0) err("line values must be within 0..1");
            }
            if (v[0] == v[2] && v[1] == v[3]) err("line must be non-degenerate");
            c.line_x1 = v[0];
            c.line_y1 = v[1];
            c.line_x2 = v[2];
            c.line_y2 = v[3];
            c.has_line = true;
        } else if (flag == "--grid") {
            int cols = 0, rows = 0;
            if (!parse_grid_spec(value(), cols, rows))
                err("grid must be <cols>x<rows> with cols 16..80 and rows 9..48");
            c.grid_cols = cols;
            c.grid_rows = rows;
            have_grid = true;
        } else if (flag == "--metrics-interval") {
            c.metrics_interval_ms = in_range_ll(100, 60000);
        } else if (flag == "--emit-stride") {
            c.emit_stride = static_cast<int>(in_range_ll(1, 1000));
        } else {
            err("unknown argument: " + flag);
        }
    }

    struct Need {
        bool have;
        const char* flag;
    };
    const Need needs[] = {
        {have_session, "--session-id"}, {have_stream, "--stream-id"},
        {have_seed, "--seed"},           {have_scene, "--scene"},
        {have_width, "--width"},         {have_height, "--height"},
        {have_fps, "--target-fps"},      {have_objects, "--objects"},
        {have_queue, "--queue-capacity"}, {have_conf, "--confidence"},
        {have_grid, "--grid"},
    };
    for (const Need& n : needs) {
        if (!n.have) err(std::string("missing required argument ") + n.flag);
    }
    return c;
}

}  // namespace ev
