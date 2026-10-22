#include "manifest.h"

#include <algorithm>
#include <cctype>

namespace pkgdb {
namespace {

bool isName(std::string_view s) {
  return !s.empty() && s.size() <= 64 && std::all_of(s.begin(), s.end(), [](char c) {
    return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
  });
}

bool isHexFlags(std::string_view s) {
  return !s.empty() && s.size() <= 8 && std::all_of(s.begin(), s.end(), [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}

std::vector<std::string_view> split(std::string_view line) {
  std::vector<std::string_view> out;
  std::size_t i = 0;
  while (i < line.size()) {
    while (i < line.size() && std::isspace(static_cast<unsigned char>(line[i]))) ++i;
    const std::size_t start = i;
    while (i < line.size() && !std::isspace(static_cast<unsigned char>(line[i]))) ++i;
    if (i > start) out.push_back(line.substr(start, i - start));
  }
  return out;
}

}  // namespace

std::vector<ManifestLine> parseManifest(std::string_view text, std::vector<ManifestError>& errors) {
  std::vector<ManifestLine> out;
  std::size_t number = 0;
  while (!text.empty()) {
    const std::size_t nl = text.find('\n');
    const std::string_view line = text.substr(0, nl);
    text = nl == std::string_view::npos ? std::string_view{} : text.substr(nl + 1);
    ++number;
    const auto fields = split(line);
    if (fields.empty() || fields[0].front() == '#') continue;
    if (fields.size() != kManifestFields) {
      errors.push_back({number, "expected 4 fields"});
      continue;
    }
    if (!isName(fields[0]) || !isHexFlags(fields[2]) || (fields[3] != "-" && !isName(fields[3]))) {
      errors.push_back({number, "bad name, flags, or extends"});
      continue;
    }
    ManifestLine m;
    m.line = number;
    for (std::size_t i = 0; i < kManifestFields; ++i) m.fields[i] = std::string(fields[i]);
    out.push_back(std::move(m));
  }
  return out;
}

}  // namespace pkgdb
