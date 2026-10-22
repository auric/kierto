#pragma once

#include <memory>

#include "log_file.h"

namespace logging {

// Renames the log to <path>.1 when it reached maxBytes and opens a new one. The older files move up by one.
void rotateIfNeeded(std::unique_ptr<LogFile>& log, long maxBytes);

}  // namespace logging
