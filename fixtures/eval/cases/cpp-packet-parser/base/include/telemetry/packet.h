#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace telemetry {

constexpr std::size_t kLabelSize = 32;
constexpr std::size_t kMaxSamples = 1024;

struct Sample {
  std::uint16_t sensor;
  std::int32_t value;
};

// The collector copies the header into a shared memory ring as is, so it keeps a fixed layout.
struct PacketHeader {
  std::uint8_t version;
  std::uint32_t deviceId;
  char label[kLabelSize];  // NUL-terminated.
};

struct Packet {
  PacketHeader header;
  std::vector<Sample> samples;
};

enum class ParseError {
  kNone,
  kTooShort,
  kBadMagic,
  kBadVersion,
  kTruncated,
  kTooManySamples,
  kLabelTooLong,
  kBadChecksum,
};

// Parses one packet that the devices send over UDP. data comes from the network.
ParseError parsePacket(const std::uint8_t* data, std::size_t size, Packet& out);
const char* describe(ParseError e);

}  // namespace telemetry
