#pragma once

#include <cstdio>
#include <string>
#include <vector>

#include "manifest.h"
#include "registry.h"

namespace pkgdb {

enum class IndexError { kOk, kTruncated, kBadMagic, kBadVersion, kTooLarge, kBadOffset, kDuplicate, kManifest };

const char* describe(IndexError e);

// Reads an index file into reg. f must be open for reading.
IndexError loadIndex(std::FILE* f, Registry& reg);

// Adds the manifest entries to reg in file order. Each problem goes to errors.
IndexError applyManifest(const std::vector<ManifestLine>& lines, Registry& reg, std::vector<std::string>& errors);

}  // namespace pkgdb
