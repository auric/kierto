#pragma once

#include <condition_variable>
#include <cstddef>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include "shipper/options.h"
#include "shipper/record.h"
#include "shipper/transport.h"

namespace shipper {

class SinkRegistry;

// Queues records and writes them in batches on its own worker thread.
class AsyncSink {
 public:
  AsyncSink(std::string name, SinkOptions options, std::unique_ptr<Transport> transport, SinkRegistry& registry);
  ~AsyncSink();

  AsyncSink(const AsyncSink&) = delete;
  AsyncSink& operator=(const AsyncSink&) = delete;

  // Queues a record. Returns false when the queue is full, and after close() or detach().
  bool push(Record r);

  // Stops taking records, writes the queued ones, and joins the worker. A second call does nothing.
  void close();

  // SinkRegistry::remove() calls it with the registry lock held. The sink then refuses new records.
  void detach();

  const std::string& name() const { return name_; }

 private:
  void run();

  const std::string name_;
  const SinkOptions options_;
  const std::unique_ptr<Transport> transport_;
  SinkRegistry& registry_;

  std::mutex mutex_;
  std::condition_variable ready_;
  // Notified each time the worker finishes a batch.
  std::condition_variable drained_;
  std::deque<Record> queue_;
  // Batches that the worker took from the queue and has not finished writing.
  std::size_t writing_ = 0;
  bool closed_ = false;
  bool detached_ = false;
  // Last member: the worker starts after each member above exists.
  std::thread worker_;
};

}  // namespace shipper
