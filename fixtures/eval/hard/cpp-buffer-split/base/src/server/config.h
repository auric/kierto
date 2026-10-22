#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace server {

struct Config {
  std::uint16_t port = 7400;
  // Each connection holds one input buffer while it has unread bytes. All connections share one pool.
  std::size_t bufferCapacity = 64 * 1024;
  std::size_t maxBuffers = 4096;
  std::size_t maxFrame = 60 * 1024;
  // Reply buffers that wait per connection.
  std::size_t sendRing = 16;
};

// Reads "key = value" lines. Throws std::runtime_error on an unknown key or a value that breaks a rule:
// sendRing is a power of two from 2 to 1024, because SendRing masks its index; maxFrame + 4 is at most bufferCapacity.
Config loadConfig(const std::string& path);

}  // namespace server
