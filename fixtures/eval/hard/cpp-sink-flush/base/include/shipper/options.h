#pragma once

#include <cstddef>

namespace shipper {

struct SinkOptions {
  // Records that the queue holds. At least 1.
  std::size_t capacity = 10'000;
  // The largest batch in text bytes. At least kMaxRecordBytes, so each record fits in a batch.
  std::size_t maxBatchBytes = 256 * 1024;
};

// Returns the options, or throws std::invalid_argument when a field breaks its rule. The AsyncSink constructor calls it.
SinkOptions validate(SinkOptions o);

}  // namespace shipper
