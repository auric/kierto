cmake_minimum_required(VERSION 3.20)
project(shipper CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(Threads REQUIRED)

add_library(shipper src/async_sink.cpp src/options.cpp src/record.cpp src/registry.cpp)
target_include_directories(shipper PUBLIC include)
target_link_libraries(shipper PUBLIC Threads::Threads)
target_compile_options(shipper PRIVATE -Wall -Wextra -Werror)

enable_testing()
add_executable(async_sink_test tests/async_sink_test.cpp)
target_link_libraries(async_sink_test PRIVATE shipper)
add_test(NAME async_sink_test COMMAND async_sink_test)
