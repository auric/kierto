#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "index.h"
#include "manifest.h"
#include "registry.h"

int main(int argc, char** argv) {
  if (argc != 3) {
    std::fprintf(stderr, "usage: pkgdb <index.bin> <manifest.txt>\n");
    return 2;
  }
  std::FILE* f = std::fopen(argv[1], "rb");
  if (!f) {
    std::perror(argv[1]);
    return 1;
  }
  pkgdb::Registry reg;
  const pkgdb::IndexError loaded = pkgdb::loadIndex(f, reg);
  std::fclose(f);
  if (loaded != pkgdb::IndexError::kOk) {
    std::fprintf(stderr, "%s: %s\n", argv[1], pkgdb::describe(loaded));
    return 1;
  }

  std::ifstream in(argv[2]);
  if (!in) {
    std::perror(argv[2]);
    return 1;
  }
  std::stringstream text;
  text << in.rdbuf();
  std::vector<pkgdb::ManifestError> parseErrors;
  const auto lines = pkgdb::parseManifest(text.str(), parseErrors);
  for (const auto& e : parseErrors) std::fprintf(stderr, "%s:%zu: %s\n", argv[2], e.line, e.message.c_str());

  std::vector<std::string> errors;
  pkgdb::applyManifest(lines, reg, errors);
  for (const auto& e : errors) std::fprintf(stderr, "%s: %s\n", argv[2], e.c_str());

  for (const pkgdb::Entry& e : reg.entries()) std::printf("%s\t%s\t%x\t%zu deps\n", e.name.c_str(), e.path.c_str(), e.flags, e.deps.size());
  return parseErrors.empty() && errors.empty() ? 0 : 1;
}
