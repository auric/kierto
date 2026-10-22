#include "shipper/async_sink.h"

#include <iterator>
#include <vector>

namespace shipper {

AsyncSink::AsyncSink(std::string name, SinkOptions options, std::unique_ptr<Transport> transport, SinkRegistry& registry)
    : name_(std::move(name)),
      options_(validate(options)),
      transport_(std::move(transport)),
      registry_(registry),
      worker_([this] { run(); }) {}

AsyncSink::~AsyncSink() { close(); }

bool AsyncSink::push(Record r) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (closed_ || detached_) return false;
  if (queue_.size() >= options_.capacity) return false;
  queue_.push_back(std::move(r));
  ready_.notify_one();
  return true;
}

void AsyncSink::detach() {
  std::lock_guard<std::mutex> lock(mutex_);
  detached_ = true;
}

void AsyncSink::close() {
  {
    std::unique_lock<std::mutex> lock(mutex_);
    if (closed_) return;
    closed_ = true;
    ready_.notify_all();
    drained_.wait(lock, [this] { return queue_.empty() && writing_ == 0; });
  }
  if (worker_.joinable()) worker_.join();
}

void AsyncSink::run() {
  std::unique_lock<std::mutex> lock(mutex_);
  for (;;) {
    ready_.wait(lock, [this] { return !queue_.empty() || closed_; });
    if (queue_.empty()) return;
    std::vector<Record> batch(std::make_move_iterator(queue_.begin()), std::make_move_iterator(queue_.end()));
    queue_.clear();
    ++writing_;
    lock.unlock();
    transport_->write(batch);
    lock.lock();
    --writing_;
    drained_.notify_all();
  }
}

}  // namespace shipper
