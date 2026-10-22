#include "telemetry/packet.h"

#include "reader.h"

namespace telemetry {

namespace {

// Version 1: magic "TL", version, 4 bytes device ID, 1 byte sample count, 6 bytes per sample. No label, no checksum.
ParseError parseV1(const std::uint8_t* data, std::size_t size, Packet& out) {
  ByteReader r(data + 3, size - 3);
  std::uint8_t count = 0;
  if (!r.u32(out.header.deviceId) || !r.u8(count)) return ParseError::kTruncated;
  out.header.version = 1;
  out.header.label[0] = '\0';
  out.samples.clear();
  for (std::uint8_t i = 0; i < count; ++i) {
    Sample s{};
    if (!r.u16(s.sensor) || !r.i32(s.value)) return ParseError::kTruncated;
    out.samples.push_back(s);
  }
  return ParseError::kNone;
}

}  // namespace

ParseError parsePacket(const std::uint8_t* data, std::size_t size, Packet& out) {
  if (size < 3) return ParseError::kTooShort;
  if (data[0] != 'T' || data[1] != 'L') return ParseError::kBadMagic;
  if (data[2] != 1) return ParseError::kBadVersion;
  return parseV1(data, size, out);
}

const char* describe(ParseError e) {
  switch (e) {
    case ParseError::kNone: return "ok";
    case ParseError::kTooShort: return "packet too short";
    case ParseError::kBadMagic: return "bad magic";
    case ParseError::kBadVersion: return "unknown version";
    case ParseError::kTruncated: return "truncated packet";
    case ParseError::kTooManySamples: return "too many samples";
    case ParseError::kLabelTooLong: return "label too long";
    case ParseError::kBadChecksum: return "bad checksum";
  }
  return "unknown error";
}

}  // namespace telemetry
