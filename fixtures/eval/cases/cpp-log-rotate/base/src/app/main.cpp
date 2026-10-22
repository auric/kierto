#include "config.h"
#include "log_file.h"
#include "rotate.h"

int main(int argc, char** argv) {
  const app::Config cfg = app::loadConfig(argc > 1 ? argv[1] : "service.conf");
  auto log = logging::openLog(cfg.logPath);
  log->write("service started");
  for (const auto& job : cfg.jobs) {
    log->write("running " + job);
    logging::rotateIfNeeded(log, cfg.maxLogBytes);
  }
  log->write("service stopped");
  return 0;
}
