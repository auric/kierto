cmake_minimum_required(VERSION 3.20)
project(framed CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(framed_net src/net/buffers.cpp)
target_include_directories(framed_net PUBLIC include)
target_compile_options(framed_net PRIVATE -Wall -Wextra -Werror)

add_executable(framed src/server/config.cpp src/server/connection.cpp src/server/main.cpp)
target_include_directories(framed PRIVATE src)
target_link_libraries(framed PRIVATE framed_net)

enable_testing()
add_executable(buffers_test tests/buffers_test.cpp)
target_link_libraries(buffers_test PRIVATE framed_net)
add_test(NAME buffers_test COMMAND buffers_test)
