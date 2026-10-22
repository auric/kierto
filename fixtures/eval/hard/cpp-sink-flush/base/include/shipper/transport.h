#pragma once

#include <vector>

#include "shipper/record.h"

namespace shipper {

class Transport {
 public:
  virtual ~Transport() = default;
  // Sends one batch. It does not throw: it retries and spools to disk by itself. Only the worker thread of the sink calls it.
  virtual void write(const std::vector<Record>& batch) = 0;
};

}  // namespace shipper
