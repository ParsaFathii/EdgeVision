# EdgeVision — native video analytics engine
# Copyright © 2026 Parsa Fathi — Apache-2.0
#
# Optional CMake build for users who prefer it over scripts/build-engine.sh
# (the sandbox itself compiles directly with g++). Zero external dependencies.

cmake_minimum_required(VERSION 3.16)
project(edgevision-engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(ENABLE_SANITIZERS "Build with ASan+UBSan at -O1 (debug/CI)" OFF)

add_executable(edgevision-engine
    src/config.cpp
    src/detector.cpp
    src/events.cpp
    src/frame_queue.cpp
    src/main.cpp
    src/performance_monitor.cpp
    src/scene.cpp
    src/session.cpp
    src/tracker.cpp)

target_compile_options(edgevision-engine PRIVATE -Wall -Wextra -Wconversion -Wshadow -Werror)

if(ENABLE_SANITIZERS)
    target_compile_options(edgevision-engine PRIVATE
        -fsanitize=address,undefined -fno-omit-frame-pointer -O1 -g)
    target_link_options(edgevision-engine PRIVATE -fsanitize=address,undefined)
else()
    target_compile_options(edgevision-engine PRIVATE -O2)
endif()

find_package(Threads REQUIRED)
target_link_libraries(edgevision-engine PRIVATE Threads::Threads)
