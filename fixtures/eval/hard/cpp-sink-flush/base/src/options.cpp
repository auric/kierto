#include "shipper/options.h"

#include <stdexcept>

#include "shipper/record.h"

namespace shipper {

SinkOptions validate(SinkOptions o) {
  if (o.capacity == 0) throw std::invalid_argument("SinkOptions::capacity must be at least 1");
  if (o.maxBatchBytes < kMaxRecordBytes) throw std::invalid_argument("SinkOptions::maxBatchBytes must be at least kMaxRecordBytes");
  return o;
}

}  // namespace shipper
