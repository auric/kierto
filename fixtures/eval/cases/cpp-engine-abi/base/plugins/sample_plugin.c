#include <stdio.h>
#include <string.h>

#include "engine/engine.h"

static engine* g_engine;

int plugin_load(void) {
  if (engine_abi_version() != ENGINE_ABI_VERSION) {
    fprintf(stderr, "sample plugin: engine ABI %u, built for %u\n", (unsigned)engine_abi_version(), (unsigned)ENGINE_ABI_VERSION);
    return -1;
  }
  engine_options opts = {.struct_size = sizeof opts, .worker_threads = 2, .queue_depth = 64, .log_level = 1};
  return engine_create(&opts, &g_engine) == ENGINE_OK ? 0 : -1;
}

int plugin_send(const char* text) {
  return engine_submit(g_engine, text, strlen(text)) == ENGINE_OK ? 0 : -1;
}

void plugin_unload(void) {
  engine_destroy(g_engine);
  g_engine = NULL;
}
