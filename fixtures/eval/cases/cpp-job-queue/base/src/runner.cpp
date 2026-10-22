#include "runner.h"

#include <exception>
#include <iostream>

namespace jobs {

void JobRunner::submit(Task task) { queue_.push_back(std::move(task)); }

std::size_t JobRunner::drain() {
  std::size_t failed = 0;
  while (!queue_.empty()) {
    Task task = std::move(queue_.front());
    queue_.pop_front();
    try {
      task();
    } catch (const std::exception& e) {
      std::cerr << "job failed: " << e.what() << '\n';
      ++failed;
    } catch (...) {
      std::cerr << "job failed with an unknown exception\n";
      ++failed;
    }
  }
  return failed;
}

}  // namespace jobs
