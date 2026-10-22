#pragma once

#include <cstddef>
#include <deque>
#include <functional>

namespace jobs {

using Task = std::function<void()>;

// Runs the submitted jobs on the calling thread when drain() is called.
class JobRunner {
 public:
  void submit(Task task);
  // Runs each queued job. Returns the number of jobs that threw.
  std::size_t drain();
  std::size_t queued() const { return queue_.size(); }

 private:
  std::deque<Task> queue_;
};

}  // namespace jobs
