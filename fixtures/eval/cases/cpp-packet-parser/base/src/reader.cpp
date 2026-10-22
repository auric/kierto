#include "reader.h"

#include <cstring>

namespace telemetry {

bool ByteReader::u8(std::uint8_t& out) {
  if (!need(1)) return false;
  out = data_[pos_++];
  return true;
}

bool ByteReader::u16(std::uint16_t& out) {
  if (!need(2)) return false;
  out = static_cast<std::uint16_t>(data_[pos_] | (data_[pos_ + 1] << 8));
  pos_ += 2;
  return true;
}

bool ByteReader::u32(std::uint32_t& out) {
  if (!need(4)) return false;
  out = 0;
  for (int i = 3; i >= 0; --i) out = (out << 8) | data_[pos_ + i];
  pos_ += 4;
  return true;
}

bool ByteReader::i32(std::int32_t& out) {
  std::uint32_t u = 0;
  if (!u32(u)) return false;
  std::memcpy(&out, &u, sizeof out);
  return true;
}

bool ByteReader::bytes(std::size_t n, void* out) {
  if (!need(n)) return false;
  std::memcpy(out, data_ + pos_, n);
  pos_ += n;
  return true;
}

}  // namespace telemetry
