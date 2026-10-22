#include "shipper/registry.h"

#include "shipper/async_sink.h"

namespace shipper {

SinkRegistry::~SinkRegistry() {
  std::lock_guard<std::mutex> lock(mutex_);
  for (auto& [name, sink] : sinks_) sink->detach();
}

bool SinkRegistry::add(const std::string& name, std::shared_ptr<AsyncSink> sink) {
  std::lock_guard<std::mutex> lock(mutex_);
  return sinks_.emplace(name, std::move(sink)).second;
}

bool SinkRegistry::remove(const std::string& name) {
  std::lock_guard<std::mutex> lock(mutex_);
  const auto it = sinks_.find(name);
  if (it == sinks_.end()) return false;
  it->second->detach();
  sinks_.erase(it);
  return true;
}

void SinkRegistry::countDrop(const std::string& name) {
  std::lock_guard<std::mutex> lock(mutex_);
  ++drops_[name];
}

std::uint64_t SinkRegistry::drops(const std::string& name) const {
  std::lock_guard<std::mutex> lock(mutex_);
  const auto it = drops_.find(name);
  return it == drops_.end() ? 0 : it->second;
}

}  // namespace shipper
