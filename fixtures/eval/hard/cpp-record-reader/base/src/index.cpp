#include "index.h"

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "pkgdb/format.h"

namespace pkgdb {
namespace {

std::uint32_t readU32(const std::uint8_t* p) {
  std::uint32_t v;
  std::memcpy(&v, p, sizeof v);
  return v;
}

std::uint16_t readU16(const std::uint8_t* p) {
  std::uint16_t v;
  std::memcpy(&v, p, sizeof v);
  return v;
}

bool inTable(std::uint32_t offset, std::uint32_t length, std::uint32_t tableSize) {
  return offset <= tableSize && length <= tableSize - offset;
}

}  // namespace

const char* describe(IndexError e) {
  switch (e) {
    case IndexError::kOk: return "ok";
    case IndexError::kTruncated: return "the file is truncated";
    case IndexError::kBadMagic: return "not an index file";
    case IndexError::kBadVersion: return "unsupported index version";
    case IndexError::kTooLarge: return "the index is too large";
    case IndexError::kBadOffset: return "a string offset is outside the table";
    case IndexError::kDuplicate: return "a package is listed twice";
    case IndexError::kManifest: return "the manifest has errors";
  }
  return "unknown error";
}

IndexError loadIndex(std::FILE* f, Registry& reg) {
  std::uint8_t hdr[kHeaderSize1];
  if (std::fread(hdr, 1, sizeof hdr, f) != sizeof hdr) return IndexError::kTruncated;
  if (readU32(hdr) != kIndexMagic) return IndexError::kBadMagic;
  if (readU16(hdr + 4) != kIndexVersion1) return IndexError::kBadVersion;
  const std::uint16_t count = readU16(hdr + 6);
  const std::uint32_t tableSize = readU32(hdr + 8);

  std::vector<std::uint8_t> records(std::size_t{count} * kRecordSize1);
  if (std::fread(records.data(), 1, records.size(), f) != records.size()) return IndexError::kTruncated;
  std::vector<char> table(tableSize);
  if (std::fread(table.data(), 1, table.size(), f) != table.size()) return IndexError::kTruncated;

  for (std::size_t i = 0; i < count; ++i) {
    const std::uint8_t* r = records.data() + i * kRecordSize1;
    const std::uint32_t nameOff = readU32(r);
    const std::uint16_t nameLen = readU16(r + 4);
    const std::uint16_t flags = readU16(r + 6);
    const std::uint32_t pathOff = readU32(r + 8);
    const std::uint16_t pathLen = readU16(r + 12);
    if (!inTable(nameOff, nameLen, tableSize) || !inTable(pathOff, pathLen, tableSize)) return IndexError::kBadOffset;
    Entry e;
    e.name.assign(table.data() + nameOff, nameLen);
    e.path.assign(table.data() + pathOff, pathLen);
    e.flags = flags;
    if (!reg.add(std::move(e))) return IndexError::kDuplicate;
  }
  return IndexError::kOk;
}

IndexError applyManifest(const std::vector<ManifestLine>& lines, Registry& reg, std::vector<std::string>& errors) {
  for (const ManifestLine& m : lines) {
    if (m.fields[3] != "-") {
      errors.push_back(m.fields[0] + ": extends is not supported yet");
      continue;
    }
    Entry e;
    e.name = m.fields[0];
    e.path = m.fields[1];
    e.flags = static_cast<std::uint32_t>(std::stoul(m.fields[2], nullptr, 16));
    if (!reg.add(std::move(e))) errors.push_back(m.fields[0] + ": defined twice");
  }
  return errors.empty() ? IndexError::kOk : IndexError::kManifest;
}

}  // namespace pkgdb
