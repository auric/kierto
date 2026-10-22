cmake_minimum_required(VERSION 3.20)
project(pkgdb CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(pkgdb_core src/index.cpp src/manifest.cpp src/registry.cpp)
target_include_directories(pkgdb_core PUBLIC include src)
target_compile_options(pkgdb_core PRIVATE -Wall -Wextra -Werror)

add_executable(pkgdb src/main.cpp)
target_link_libraries(pkgdb PRIVATE pkgdb_core)

enable_testing()
add_executable(index_test tests/index_test.cpp)
target_link_libraries(index_test PRIVATE pkgdb_core)
add_test(NAME index_test COMMAND index_test)
