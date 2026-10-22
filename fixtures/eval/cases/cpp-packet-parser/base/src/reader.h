#pragma once

#include <cstddef>
#include <cstdint>

namespace telemetry {

// Reads little-endian values from a byte range. Each read checks the bounds and returns false at the end.
class ByteReader {
 public:
  ByteReader(const std::uint8_t* data, std::size_t size) : data_(data), size_(size) {}

  bool u8(std::uint8_t& out);
  bool u16(std::uint16_t& out);
  bool u32(std::uint32_t& out);
  bool i32(std::int32_t& out);
  bool bytes(std::size_t n, void* out);

  std::size_t remaining() const { return size_ - pos_; }

 private:
  bool need(std::size_t n) const { return n <= size_ - pos_; }

  const std::uint8_t* data_;
  std::size_t size_;
  std::size_t pos_ = 0;
};

}  // namespace telemetry
