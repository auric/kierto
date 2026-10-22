#ifndef ENGINE_ENGINE_H
#define ENGINE_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(ENGINE_BUILD)
#define ENGINE_API __attribute__((visibility("default")))
#else
#define ENGINE_API
#endif

/* Plugins compare this with engine_abi_version() when they load. */
#define ENGINE_ABI_VERSION 3

typedef enum engine_status {
  ENGINE_OK = 0,
  ENGINE_EINVAL = 1,
  ENGINE_ESTATE = 2,
  ENGINE_ENOMEM = 3,
  ENGINE_EINTERNAL = 4
} engine_status;

typedef struct engine_options {
  uint32_t struct_size; /* Set to sizeof(engine_options). The engine reads only the first struct_size bytes. */
  uint32_t worker_threads;
  uint32_t queue_depth;
  int32_t log_level; /* 0 errors, 1 warnings, 2 info, 3 debug. */
} engine_options;

typedef struct engine engine;

ENGINE_API uint32_t engine_abi_version(void);
ENGINE_API engine_status engine_create(const engine_options* options, engine** out);
ENGINE_API engine_status engine_submit(engine* e, const void* data, size_t size);
ENGINE_API void engine_destroy(engine* e);

#ifdef __cplusplus
}
#endif

#endif
