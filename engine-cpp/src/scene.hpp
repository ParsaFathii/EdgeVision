// EdgeVision — native video analytics engine
// Copyright © 2026 Parsa Fathi — Apache-2.0

// Deterministic scene simulator: the synthetic "camera" the engine watches.
// Positions are normalized [0..1]; the same seed reproduces the exact same
// trajectory sequence (fixed-dt integration, no wall-clock input anywhere).
#pragma once

#include <cstdint>
#include <vector>

#include "config.hpp"
#include "rng.hpp"
#include "types.hpp"

namespace ev {

// One entry of the scene render state ("what the camera sees").
struct SceneObject {
    int oid = 0;
    ObjClass cls = ObjClass::Vehicle;
    double x = 0.0, y = 0.0, w = 0.0, h = 0.0;  // top-left, normalized
};

class Scene {
public:
    Scene(Config::SceneKind kind, int object_count, std::uint32_t seed);

    // Advances the scene by dt seconds (fixed dt keeps runs reproducible).
    void step(double dt);

    const std::vector<SceneObject>& objects() const { return objs_; }

private:
    struct Agent {
        int oid = 0;
        ObjClass cls = ObjClass::Vehicle;
        double x = 0.0, y = 0.0, w = 0.0, h = 0.0;  // top-left, normalized
        double vx = 0.0, vy = 0.0;                  // normalized units / second
        double turn_cd = 0.0;  // seconds until the next maneuver decision
    };

    void spawn(Agent& a);
    void spawn_street(Agent& a);
    void spawn_intersection(Agent& a);
    void spawn_parking(Agent& a);
    void wrap_respawn(Agent& a);
    void maybe_turn_intersection(Agent& a);
    void maybe_maneuver_parking(Agent& a);

    Config::SceneKind kind_;
    Rng rng_;
    std::vector<Agent> agents_;
    std::vector<SceneObject> objs_;
};

}  // namespace ev
