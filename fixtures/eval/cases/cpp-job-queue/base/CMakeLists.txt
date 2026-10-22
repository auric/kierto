cmake_minimum_required(VERSION 3.20)
project(jobs CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(jobs src/runner.cpp)
target_include_directories(jobs PUBLIC src)

add_executable(jobs_cli src/main.cpp)
target_link_libraries(jobs_cli PRIVATE jobs)
