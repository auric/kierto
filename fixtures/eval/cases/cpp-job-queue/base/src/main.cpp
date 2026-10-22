#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

#include "runner.h"

namespace {

std::size_t countLines(const std::string& path) {
  std::ifstream in(path);
  if (!in) throw std::runtime_error("cannot open " + path);
  std::size_t n = 0;
  for (std::string line; std::getline(in, line);) ++n;
  return n;
}

}  // namespace

// Prints the line count of each file that the command line names.
int main(int argc, char** argv) {
  jobs::JobRunner runner;
  for (int i = 1; i < argc; ++i) {
    std::string path = argv[i];
    runner.submit([path] { std::cout << path << ": " << countLines(path) << " lines\n"; });
  }
  return runner.drain() == 0 ? 0 : 1;
}
