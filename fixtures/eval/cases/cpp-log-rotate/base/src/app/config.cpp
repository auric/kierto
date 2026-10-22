#include "config.h"

#include <fstream>

namespace app {

Config loadConfig(const std::string& path) {
  Config cfg;
  std::ifstream in(path);
  for (std::string line; std::getline(in, line);) {
    const auto eq = line.find('=');
    if (line.empty() || line[0] == '#' || eq == std::string::npos) continue;
    const std::string key = line.substr(0, eq);
    const std::string value = line.substr(eq + 1);
    if (key == "log") {
      cfg.logPath = value;
    } else if (key == "max_log_bytes") {
      cfg.maxLogBytes = std::stol(value);
    } else if (key == "job") {
      cfg.jobs.push_back(value);
    }
  }
  return cfg;
}

}  // namespace app
