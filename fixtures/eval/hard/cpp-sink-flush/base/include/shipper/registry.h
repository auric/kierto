#pragma once

#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <string>

namespace shipper {

class AsyncSink;

// The sinks of a process by name, and their drop counters.
//
// Lock order: SinkRegistry::mutex_ before AsyncSink::mutex_. remove() calls AsyncSink::detach() with mutex_ held, so a
// sink must not call into the registry while it holds its own mutex.
class SinkRegistry {
 public:
  ~SinkRegistry();

  // Returns false when the name exists.
  bool add(const std::string& name, std::shared_ptr<AsyncSink> sink);

  // Detaches the sink under the registry lock, so no record reaches it after remove() returns. Returns false when the name
  // is unknown.
  bool remove(const std::string& name);

  // Counts one dropped record of a sink. Takes the registry lock.
  void countDrop(const std::string& name);

  std::uint64_t drops(const std::string& name) const;

 private:
  mutable std::mutex mutex_;
  std::map<std::string, std::shared_ptr<AsyncSink>> sinks_;
  std::map<std::string, std::uint64_t> drops_;
};

}  // namespace shipper
