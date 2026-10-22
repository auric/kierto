#include "rotate.h"

#include <cstdio>
#include <string>

namespace logging {

namespace {

constexpr int kKeep = 10;

std::string numbered(const std::string& path, int n) { return path + "." + std::to_string(n); }

}  // namespace

void rotateIfNeeded(std::unique_ptr<LogFile>& log, long maxBytes) {
  if (log->size() < maxBytes) return;
  const std::string path = log->path();
  log.reset();
  std::remove(numbered(path, kKeep).c_str());
  for (int i = kKeep - 1; i >= 1; --i) std::rename(numbered(path, i).c_str(), numbered(path, i + 1).c_str());
  std::rename(path.c_str(), numbered(path, 1).c_str());
  log = openLog(path);
}

}  // namespace logging
