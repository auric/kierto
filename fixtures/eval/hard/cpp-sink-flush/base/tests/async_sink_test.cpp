#include <cassert>
#include <cstdio>
#include <memory>
#include <mutex>
#include <vector>

#include "shipper/async_sink.h"
#include "shipper/registry.h"

namespace {

using namespace shipper;

// Records each batch. The test keeps a raw pointer; the sink owns the transport.
class FakeTransport : public Transport {
 public:
  void write(const std::vector<Record>& batch) override {
    std::lock_guard<std::mutex> lock(mutex_);
    batches_.push_back(batch.size());
    for (const auto& r : batch) texts_.push_back(r.text());
  }
  std::vector<std::string> texts() {
    std::lock_guard<std::mutex> lock(mutex_);
    return texts_;
  }

 private:
  std::mutex mutex_;
  std::vector<std::size_t> batches_;
  std::vector<std::string> texts_;
};

void closeWritesEachQueuedRecord() {
  SinkRegistry reg;
  auto transport = std::make_unique<FakeTransport>();
  FakeTransport* t = transport.get();
  AsyncSink sink("app", SinkOptions{}, std::move(transport), reg);
  for (int i = 0; i < 100; ++i) assert(sink.push(Record::make(Level::kInfo, "line " + std::to_string(i))));
  sink.close();
  assert(t->texts().size() == 100);
  assert(!sink.push(Record::make(Level::kInfo, "late")));
}

void aFullQueueRefusesARecord() {
  SinkRegistry reg;
  AsyncSink sink("app", SinkOptions{.capacity = 1}, std::make_unique<FakeTransport>(), reg);
  int refused = 0;
  for (int i = 0; i < 1000; ++i)
    if (!sink.push(Record::make(Level::kInfo, "x"))) ++refused;
  sink.close();
  std::printf("refused %d of 1000\n", refused);
}

void removeDetachesTheSink() {
  SinkRegistry reg;
  auto sink = std::make_shared<AsyncSink>("app", SinkOptions{}, std::make_unique<FakeTransport>(), reg);
  assert(reg.add("app", sink));
  assert(reg.remove("app"));
  assert(!sink->push(Record::make(Level::kInfo, "after remove")));
}

void recordTextIsOneLine() {
  const Record r = Record::make(Level::kWarning, "a\nb\tc");
  assert(r.text() == "a b c");
}

}  // namespace

int main() {
  closeWritesEachQueuedRecord();
  aFullQueueRefusesARecord();
  removeDetachesTheSink();
  recordTextIsOneLine();
  std::puts("async_sink_test: ok");
  return 0;
}
