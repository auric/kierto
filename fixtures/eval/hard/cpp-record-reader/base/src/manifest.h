#pragma once

#include <array>
#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace pkgdb {

inline constexpr std::size_t kManifestFields = 4;

// One manifest line: name, path, flags, extends. parseManifest() guarantees the field rules below.
struct ManifestLine {
  std::size_t line = 0;
  std::array<std::string, kManifestFields> fields;
};

struct ManifestError {
  std::size_t line = 0;
  std::string message;
};

// Parses the manifest text. Blank lines and lines that start with '#' are skipped. A line needs exactly four fields:
// name ([a-z0-9._-]{1,64}), path (not empty), flags (1 to 8 lowercase hex digits), and extends (a name, or "-").
// Lines that break a rule go to errors and not to the result.
std::vector<ManifestLine> parseManifest(std::string_view text, std::vector<ManifestError>& errors);

}  // namespace pkgdb
