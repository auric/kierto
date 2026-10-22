#include "log_file.h"

#include <cerrno>
#include <cstring>
#include <ctime>
#include <stdexcept>

namespace logging {

LogFile::~LogFile() {
  if (file_) std::fclose(file_);
}

void LogFile::write(const std::string& message) {
  char stamp[32];
  const std::time_t now = std::time(nullptr);
  std::tm utc{};
  gmtime_r(&now, &utc);
  std::strftime(stamp, sizeof stamp, "%Y-%m-%dT%H:%M:%SZ", &utc);
  std::fprintf(file_, "%s %s\n", stamp, message.c_str());
  std::fflush(file_);
}

long LogFile::size() const { return std::ftell(file_); }

std::unique_ptr<LogFile> openLog(const std::string& path) {
  std::FILE* f = std::fopen(path.c_str(), "a");
  if (!f) throw std::runtime_error("cannot open " + path + ": " + std::strerror(errno));
  return std::make_unique<LogFile>(f, path);
}

}  // namespace logging
