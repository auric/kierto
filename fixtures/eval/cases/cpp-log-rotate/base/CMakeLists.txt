cmake_minimum_required(VERSION 3.20)
project(service CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(logging src/log_file.cpp src/rotate.cpp)
target_include_directories(logging PUBLIC src)

add_executable(service src/app/main.cpp src/app/config.cpp)
target_link_libraries(service PRIVATE logging)
