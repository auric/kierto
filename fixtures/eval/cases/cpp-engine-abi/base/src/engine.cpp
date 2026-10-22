#include "engine/engine.h"

#include <algorithm>
#include <cstring>
#include <deque>
#include <mutex>
#include <new>
#include <vector>

namespace {

constexpr size_t kMaxMessage = 1 << 20;

engine_options defaults() {
  engine_options o{};
  o.struct_size = sizeof o;
  o.worker_threads = 1;
  o.queue_depth = 256;
  o.log_level = 1;
  return o;
}

}  // namespace

struct engine {
  engine_options options;
  std::mutex mutex;
  std::deque<std::vector<unsigned char>> queue;
};

extern "C" {

uint32_t engine_abi_version(void) { return ENGINE_ABI_VERSION; }

engine_status engine_create(const engine_options* options, engine** out) {
  if (!options || !out || options->struct_size < sizeof(uint32_t)) return ENGINE_EINVAL;
  // An older caller passes a smaller struct. Its missing fields keep the defaults.
  engine_options opts = defaults();
  std::memcpy(&opts, options, std::min<size_t>(options->struct_size, sizeof opts));
  opts.struct_size = sizeof opts;
  if (opts.worker_threads == 0 || opts.queue_depth == 0) return ENGINE_EINVAL;
  try {
    engine* e = new engine();
    e->options = opts;
    *out = e;
    return ENGINE_OK;
  } catch (const std::bad_alloc&) {
    return ENGINE_ENOMEM;
  } catch (...) {
    return ENGINE_EINTERNAL;
  }
}

engine_status engine_submit(engine* e, const void* data, size_t size) {
  if (!e || (!data && size != 0)) return ENGINE_EINVAL;
  if (size > kMaxMessage) return ENGINE_EINVAL;
  try {
    std::vector<unsigned char> msg(size);
    if (size != 0) std::memcpy(msg.data(), data, size);
    std::lock_guard<std::mutex> lock(e->mutex);
    if (e->queue.size() >= e->options.queue_depth) return ENGINE_ESTATE;
    e->queue.push_back(std::move(msg));
    return ENGINE_OK;
  } catch (const std::bad_alloc&) {
    return ENGINE_ENOMEM;
  } catch (...) {
    return ENGINE_EINTERNAL;
  }
}

void engine_destroy(engine* e) { delete e; }

}  // extern "C"
