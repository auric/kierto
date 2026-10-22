cmake_minimum_required(VERSION 3.20)
project(telemetry CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(telemetry src/reader.cpp src/parser.cpp)
target_include_directories(telemetry PUBLIC include PRIVATE src)
