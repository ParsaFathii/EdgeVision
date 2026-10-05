// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

#include "scene.hpp"

#include <cmath>

namespace ev {
namespace {

constexpr double kPi = 3.14159265358979323846;

// STREET geometry: a horizontal two-lane road with bike lanes at the edges
// and a mid-screen crosswalk. The pedestrian band guarantees regular
// crossings of the vertical center line x=0.5 (LINE_CROSS depends on it).
constexpr double kLaneATop = 0.435;  // lane A: left-to-right vehicles
constexpr double kLaneABot = 0.475;
constexpr double kLaneBTop = 0.525;  // lane B: right-to-left vehicles (slower)
constexpr double kLaneBBot = 0.565;
constexpr double kPedBandTop = 0.28;  // crosswalk zone pedestrians roam in
constexpr double kPedBandBot = 0.66;

// INTERSECTION geometry: horizontal + vertical bidirectional flows with a
// simplified turning rule inside the center box.
constexpr double kCenterLo = 0.44;
constexpr double kCenterHi = 0.56;

// PARKING: slow vehicle maneuvers + pedestrians walking fixed rows.
constexpr double kParkingRowStep = 0.15;
constexpr double kParkingRow0 = 0.20;

double pick_lane(Rng& r, double top, double bot) { return r.range(top, bot); }

}  // namespace

Scene::Scene(Config::SceneKind kind, int object_count, std::uint32_t seed)
    : kind_(kind), rng_(seed == 0 ? 0x9E3779B9u : seed) {
    // Population mix per scene; totals always equal object_count exactly.
    int vehicles = object_count / 2;
    if (vehicles < 2) vehicles = 2;
    int cyclists = 0;
    if (kind_ != Config::SceneKind::Parking && object_count >= 6) cyclists = 1;
    int pedestrians = object_count - vehicles - cyclists;
    if (pedestrians < 1) pedestrians = 1;

    agents_.reserve(static_cast<std::size_t>(vehicles + pedestrians + cyclists));
    int oid = 1;
    for (int i = 0; i < vehicles; ++i) {
        Agent a;
        a.oid = oid++;
        a.cls = ObjClass::Vehicle;
        agents_.push_back(a);
    }
    for (int i = 0; i < pedestrians; ++i) {
        Agent a;
        a.oid = oid++;
        a.cls = ObjClass::Pedestrian;
        agents_.push_back(a);
    }
    for (int i = 0; i < cyclists; ++i) {
        Agent a;
        a.oid = oid++;
        a.cls = ObjClass::Cyclist;
        agents_.push_back(a);
    }
    for (Agent& a : agents_) spawn(a);
    objs_.reserve(agents_.size());
    objs_.clear();
    for (const Agent& a : agents_) {
        objs_.push_back(SceneObject{a.oid, a.cls, a.x, a.y, a.w, a.h});
    }
}

void Scene::spawn(Agent& a) {
    a.turn_cd = rng_.range(0.5, 4.0);
    switch (kind_) {
        case Config::SceneKind::Street:      spawn_street(a); break;
        case Config::SceneKind::Intersection: spawn_intersection(a); break;
        case Config::SceneKind::Parking:     spawn_parking(a); break;
    }
}

void Scene::spawn_street(Agent& a) {
    Rng& r = rng_;
    switch (a.cls) {
        case ObjClass::Vehicle: {
            const bool lane_a = r.unit() < 0.5;
            a.w = r.range(0.10, 0.16);
            a.h = a.w * r.range(0.60, 0.78);  // cars: wider than tall
            a.x = r.range(-0.02, 0.98);
            const double cy = lane_a ? pick_lane(r, kLaneATop, kLaneABot)
                                      : pick_lane(r, kLaneBTop, kLaneBBot);
            a.y = cy - a.h * 0.5;
            // The two lanes run at genuinely different speeds.
            const double sp = lane_a ? r.range(0.10, 0.17) : r.range(0.07, 0.13);
            a.vx = lane_a ? sp : -sp;
            a.vy = 0.0;
            break;
        }
        case ObjClass::Pedestrian: {
            a.w = r.range(0.025, 0.04);
            a.h = a.w * r.range(2.4, 3.1);  // taller than wide
            // Spawn inside the crosswalk band so the vertical center line is
            // crossed regularly (the LINE_CROSS event depends on it).
            a.x = r.range(0.25, 0.75);
            a.y = r.range(kPedBandTop, kPedBandBot);
            const double sp = r.range(0.04, 0.10);
            a.vx = (r.unit() < 0.5) ? -sp : sp;
            a.vy = (r.unit() < 0.5 ? -1.0 : 1.0) * r.range(0.015, 0.045);
            break;
        }
        case ObjClass::Cyclist: {
            a.w = r.range(0.045, 0.06);
            a.h = a.w * r.range(1.2, 1.45);
            a.x = r.range(0.0, 0.95);
            const bool upper = r.unit() < 0.5;
            const double cy = upper ? r.range(0.37, 0.41) : r.range(0.61, 0.65);
            a.y = cy - a.h * 0.5;
            const double sp = r.range(0.06, 0.12);
            a.vx = (r.unit() < 0.5) ? -sp : sp;
            a.vy = 0.0;
            break;
        }
    }
}

void Scene::spawn_intersection(Agent& a) {
    Rng& r = rng_;
    const bool horizontal = r.unit() < 0.5;
    const double sgn = (r.unit() < 0.5) ? -1.0 : 1.0;
    switch (a.cls) {
        case ObjClass::Vehicle: {
            a.w = r.range(0.10, 0.16);
            a.h = a.w * r.range(0.60, 0.78);
            const double sp = r.range(0.08, 0.15);
            if (horizontal) {
                a.x = r.range(-0.02, 0.98);
                a.y = pick_lane(r, kLaneATop, kLaneABot) - a.h * 0.5;
                a.vx = sgn * sp;
                a.vy = 0.0;
            } else {
                a.x = pick_lane(r, kLaneATop, kLaneABot) - a.w * 0.5;
                a.y = r.range(-0.02, 0.98);
                a.vx = 0.0;
                a.vy = sgn * sp;
            }
            break;
        }
        case ObjClass::Pedestrian: {
            a.w = r.range(0.025, 0.04);
            a.h = a.w * r.range(2.4, 3.1);
            const double sp = r.range(0.03, 0.07);
            if (horizontal) {
                a.x = r.range(0.0, 1.0);
                a.y = r.range(0.30, 0.70);
                a.vx = sgn * sp;
                a.vy = 0.0;
            } else {
                a.x = r.range(0.30, 0.70);
                a.y = r.range(0.0, 1.0);
                a.vx = 0.0;
                a.vy = sgn * sp;
            }
            break;
        }
        case ObjClass::Cyclist: {
            a.w = r.range(0.045, 0.06);
            a.h = a.w * r.range(1.2, 1.45);
            const double sp = r.range(0.05, 0.10);
            if (horizontal) {
                a.x = r.range(0.0, 0.95);
                a.y = r.range(0.37, 0.41) - a.h * 0.5;
                a.vx = sgn * sp;
                a.vy = 0.0;
            } else {
                a.x = r.range(0.37, 0.41) - a.w * 0.5;
                a.y = r.range(0.0, 0.95);
                a.vx = 0.0;
                a.vy = sgn * sp;
            }
            break;
        }
    }
}

void Scene::spawn_parking(Agent& a) {
    Rng& r = rng_;
    switch (a.cls) {
        case ObjClass::Vehicle: {
            a.w = r.range(0.09, 0.14);
            a.h = a.w * r.range(0.60, 0.75);
            a.x = r.range(0.05, 0.90);
            a.y = r.range(0.05, 0.90);
            // Start maneuvering almost immediately in PARKING.
            a.turn_cd = r.range(0.2, 2.0);
            maybe_maneuver_parking(a);
            break;
        }
        case ObjClass::Pedestrian: {
            a.w = r.range(0.025, 0.04);
            a.h = a.w * r.range(2.4, 3.1);
            // Pedestrians walk fixed rows (parking aisles).
            const int row = static_cast<int>(r.unit() * 5.0) % 5;
            a.x = r.range(0.0, 1.0);
            a.y = (kParkingRow0 + kParkingRowStep * static_cast<double>(row) +
                   r.range(-0.02, 0.02)) - a.h * 0.5;
            const double sp = r.range(0.02, 0.05);
            a.vx = (r.unit() < 0.5) ? -sp : sp;
            a.vy = 0.0;
            break;
        }
        case ObjClass::Cyclist: {
            a.w = r.range(0.045, 0.06);
            a.h = a.w * r.range(1.2, 1.45);
            a.x = r.range(0.0, 0.95);
            a.y = r.range(0.05, 0.90);
            const double sp = r.range(0.04, 0.08);
            a.vx = (r.unit() < 0.5) ? -sp : sp;
            a.vy = 0.0;
            break;
        }
    }
}

void Scene::maybe_turn_intersection(Agent& a) {
    if (a.turn_cd > 0.0) return;
    const double cx = a.x + a.w * 0.5;
    const double cy = a.y + a.h * 0.5;
    if (cx <= kCenterLo || cx >= kCenterHi || cy <= kCenterLo || cy >= kCenterHi) return;
    if (rng_.unit() < 0.6) return;  // 40% of center visits turn
    const double sp = std::sqrt(a.vx * a.vx + a.vy * a.vy);
    if (sp <= 0.0) return;
    const bool was_horizontal = std::fabs(a.vx) > std::fabs(a.vy);
    const double sgn = (rng_.unit() < 0.5) ? -1.0 : 1.0;
    if (was_horizontal) {
        a.vx = 0.0;
        a.vy = sgn * sp;
    } else {
        a.vy = 0.0;
        a.vx = sgn * sp;
    }
    // Cooldown: decide a turn at most once per center visit.
    a.turn_cd = rng_.range(2.5, 5.0);
}

void Scene::maybe_maneuver_parking(Agent& a) {
    if (a.cls != ObjClass::Vehicle) return;
    if (a.turn_cd > 0.0) return;
    // Slow maneuvers: sometimes dwell (speed 0), otherwise pick one of eight
    // headings with a slow speed — parking-lot driving.
    const double sp = (rng_.unit() < 0.25) ? 0.0 : rng_.range(0.01, 0.035);
    const double ang = std::floor(rng_.unit() * 8.0) * (kPi / 4.0);
    a.vx = sp * std::cos(ang);
    a.vy = sp * std::sin(ang);
    a.turn_cd = rng_.range(3.0, 9.0);
}

void Scene::wrap_respawn(Agent& a) {
    const bool out_x = (a.vx > 0.0 && a.x >= 1.0) || (a.vx < 0.0 && a.x + a.w <= 0.0);
    const bool out_y = (a.vy > 0.0 && a.y >= 1.0) || (a.vy < 0.0 && a.y + a.h <= 0.0);
    if (!out_x && !out_y) return;
    // Objects wrap around edges and respawn with FRESH speed/size.
    spawn(a);
    // Re-enter at the edge matching the new velocity so motion stays smooth.
    if (a.vx > 0.0) a.x = -a.w;
    else if (a.vx < 0.0) a.x = 1.0;
    if (a.vy > 0.0) a.y = -a.h;
    else if (a.vy < 0.0) a.y = 1.0;
}

void Scene::step(double dt) {
    for (Agent& a : agents_) {
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.turn_cd -= dt;
        if (kind_ == Config::SceneKind::Intersection) maybe_turn_intersection(a);
        if (kind_ == Config::SceneKind::Parking) maybe_maneuver_parking(a);
        wrap_respawn(a);
    }
    objs_.clear();
    for (const Agent& a : agents_) {
        objs_.push_back(SceneObject{a.oid, a.cls, a.x, a.y, a.w, a.h});
    }
}

}  // namespace ev
