# SPDX-License-Identifier: MIT
#
# trailrt-osm, built by scripts/build-osm-tool.sh. ADR 0023.
#
# libosmium (BSL-1.0) and protozero (BSD-2-Clause) are header-only and come
# from Homebrew. zlib (PBF blocks) and expat (.osm XML, used by the tests) are
# taken from the macOS SDK on purpose, so the binary links only system
# libraries and the bundle gains no dylibs. lz4-compressed PBF is not enabled:
# Geofabrik writes zlib.

cmake_minimum_required(VERSION 3.20)
project(trailrt_osm LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_path(OSMIUM_INCLUDE_DIR osmium/version.hpp REQUIRED)
find_path(PROTOZERO_INCLUDE_DIR protozero/version.hpp REQUIRED)
find_package(ZLIB REQUIRED)
find_package(EXPAT REQUIRED)
find_package(Threads REQUIRED)

add_executable(trailrt-osm trailrt-osm.cpp)
target_include_directories(trailrt-osm SYSTEM PRIVATE ${OSMIUM_INCLUDE_DIR} ${PROTOZERO_INCLUDE_DIR})
target_link_libraries(trailrt-osm PRIVATE ZLIB::ZLIB EXPAT::EXPAT Threads::Threads)
target_compile_options(trailrt-osm PRIVATE -Wall -Wextra)
