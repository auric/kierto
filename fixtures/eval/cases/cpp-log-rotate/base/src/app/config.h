#pragma once

#include <string>
#include <vector>

namespace app {

struct Config {
  std::string logPath = "service.log";
  long maxLogBytes = 10 * 1024 * 1024;
  std::vector<std::string> jobs;
};

// Reads key=value lines. Unknown keys are ignored. A missing file gives the defaults.
Config loadConfig(const std::string& path);

}  // namespace app
