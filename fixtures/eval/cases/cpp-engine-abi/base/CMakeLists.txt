cmake_minimum_required(VERSION 3.20)
project(engine C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 99)

add_library(engine SHARED src/engine.cpp)
target_include_directories(engine PUBLIC include)
set_target_properties(engine PROPERTIES CXX_VISIBILITY_PRESET hidden)
target_compile_definitions(engine PRIVATE ENGINE_BUILD)

add_library(sample_plugin MODULE plugins/sample_plugin.c)
target_link_libraries(sample_plugin PRIVATE engine)
