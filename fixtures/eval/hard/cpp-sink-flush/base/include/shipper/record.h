#pragma once

#include <chrono>
#include <cstddef>
#include <string>
#include <string_view>

namespace shipper {

enum class Level { kDebug, kInfo, kWarning, kError };

// The longest text of a record. SinkOptions::validate() keeps each batch limit at or above it.
inline constexpr std::size_t kMaxRecordBytes = 16 * 1024;

class Record {
 public:
  // The only way to build a record. text must be UTF-8. make() cuts it at kMaxRecordBytes on a character boundary and turns
  // each byte below 0x20 into a space, so the text is one line and needs no escaping beyond quotes and backslashes.
  static Record make(Level level, std::string_view text);

  Level level() const { return level_; }
  std::chrono::system_clock::time_point time() const { return time_; }
  const std::string& text() const { return text_; }

 private:
  Record(Level level, std::chrono::system_clock::time_point time, std::string text)
      : level_(level), time_(time), text_(std::move(text)) {}

  Level level_;
  std::chrono::system_clock::time_point time_;
  std::string text_;
};

}  // namespace shipper
