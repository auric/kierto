#include "server/config.h"

#include <bit>
#include <fstream>
#include <stdexcept>
#include <string>

namespace server {
namespace {

std::string trim(const std::string& s) {
  const auto a = s.find_first_not_of(" \t\r");
  if (a == std::string::npos) return "";
  return s.substr(a, s.find_last_not_of(" \t\r") - a + 1);
}

std::size_t number(const std::string& key, const std::string& value) {
  std::size_t used = 0;
  const unsigned long long n = std::stoull(value, &used);
  if (used != value.size()) throw std::runtime_error(key + ": not a number: " + value);
  return static_cast<std::size_t>(n);
}

}  // namespace

Config loadConfig(const std::string& path) {
  std::ifstream in(path);
  if (!in) throw std::runtime_error("cannot read " + path);
  Config c;
  std::string line;
  while (std::getline(in, line)) {
    line = trim(line);
    if (line.empty() || line[0] == '#') continue;
    const auto eq = line.find('=');
    if (eq == std::string::npos) throw std::runtime_error("expected key = value: " + line);
    const std::string key = trim(line.substr(0, eq));
    const std::string value = trim(line.substr(eq + 1));
    if (key == "port") c.port = static_cast<std::uint16_t>(number(key, value));
    else if (key == "buffer_capacity") c.bufferCapacity = number(key, value);
    else if (key == "max_buffers") c.maxBuffers = number(key, value);
    else if (key == "max_frame") c.maxFrame = number(key, value);
    else if (key == "send_ring") c.sendRing = number(key, value);
    else throw std::runtime_error("unknown key: " + key);
  }
  if (!std::has_single_bit(c.sendRing) || c.sendRing < 2 || c.sendRing > 1024)
    throw std::runtime_error("send_ring must be a power of two from 2 to 1024");
  if (c.maxBuffers == 0 || c.bufferCapacity < 64) throw std::runtime_error("max_buffers and buffer_capacity are too small");
  if (c.maxFrame + 4 > c.bufferCapacity) throw std::runtime_error("max_frame + 4 must fit in buffer_capacity");
  return c;
}

}  // namespace server
