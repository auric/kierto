#pragma once

#include <cstdio>
#include <memory>
#include <string>

namespace logging {

class LogFile {
 public:
  LogFile(std::FILE* file, std::string path) : file_(file), path_(std::move(path)) {}
  ~LogFile();

  LogFile(const LogFile&) = delete;
  LogFile& operator=(const LogFile&) = delete;

  void write(const std::string& message);
  long size() const;
  const std::string& path() const { return path_; }

 private:
  std::FILE* file_;
  std::string path_;
};

// Opens path for appending. Throws std::runtime_error when the file cannot be opened.
std::unique_ptr<LogFile> openLog(const std::string& path);

}  // namespace logging
