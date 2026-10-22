#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "index.h"
#include "pkgdb/format.h"

namespace {

void put16(std::vector<std::uint8_t>& b, std::uint16_t v) { b.insert(b.end(), {std::uint8_t(v), std::uint8_t(v >> 8)}); }
void put32(std::vector<std::uint8_t>& b, std::uint32_t v) { put16(b, std::uint16_t(v)); put16(b, std::uint16_t(v >> 16)); }

// A version 1 index with one record per name. Each path is "/pkg/<name>".
std::vector<std::uint8_t> indexV1(const std::vector<std::string>& names) {
  std::string table;
  std::vector<std::uint8_t> recs;
  for (const auto& n : names) {
    const std::string path = "/pkg/" + n;
    put32(recs, std::uint32_t(table.size()));
    put16(recs, std::uint16_t(n.size()));
    put16(recs, 0x1);
    table += n;
    put32(recs, std::uint32_t(table.size()));
    put16(recs, std::uint16_t(path.size()));
    put16(recs, 0);
    table += path;
  }
  std::vector<std::uint8_t> b;
  put32(b, pkgdb::kIndexMagic);
  put16(b, pkgdb::kIndexVersion1);
  put16(b, std::uint16_t(names.size()));
  put32(b, std::uint32_t(table.size()));
  b.insert(b.end(), recs.begin(), recs.end());
  b.insert(b.end(), table.begin(), table.end());
  return b;
}

pkgdb::IndexError load(const std::vector<std::uint8_t>& bytes, pkgdb::Registry& reg) {
  std::FILE* f = std::tmpfile();
  std::fwrite(bytes.data(), 1, bytes.size(), f);
  std::rewind(f);
  const auto r = pkgdb::loadIndex(f, reg);
  std::fclose(f);
  return r;
}

void loadsVersion1() {
  pkgdb::Registry reg;
  assert(load(indexV1({"zlib", "openssl"}), reg) == pkgdb::IndexError::kOk);
  assert(reg.size() == 2);
  assert(reg.find("openssl")->path == "/pkg/openssl");
}

void refusesATruncatedFile() {
  auto bytes = indexV1({"zlib"});
  bytes.resize(bytes.size() - 1);
  pkgdb::Registry reg;
  assert(load(bytes, reg) == pkgdb::IndexError::kTruncated);
}

void refusesAnOffsetOutsideTheTable() {
  auto bytes = indexV1({"zlib"});
  bytes[pkgdb::kHeaderSize1] = 0xff;
  pkgdb::Registry reg;
  assert(load(bytes, reg) == pkgdb::IndexError::kBadOffset);
}

void manifestAddsEntries() {
  pkgdb::Registry reg;
  std::vector<pkgdb::ManifestError> perr;
  const auto lines = pkgdb::parseManifest("curl /opt/curl 3 -\n", perr);
  std::vector<std::string> errors;
  assert(pkgdb::applyManifest(lines, reg, errors) == pkgdb::IndexError::kOk);
  assert(reg.find("curl")->flags == 3);
}

}  // namespace

int main() {
  loadsVersion1();
  refusesATruncatedFile();
  refusesAnOffsetOutsideTheTable();
  manifestAddsEntries();
  std::puts("index_test: ok");
  return 0;
}
