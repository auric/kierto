#pragma once

#include <bit>
#include <cstddef>
#include <cstdint>

// The index file layouts. All integers are little-endian, and pkgdb builds only for little-endian hosts, so the readers
// copy integers with memcpy and do not swap bytes.
static_assert(std::endian::native == std::endian::little, "pkgdb reads little-endian index files on little-endian hosts only");

namespace pkgdb {

inline constexpr std::uint32_t kIndexMagic = 0x58444b50;  // "PKDX"

// Version 1. Header: magic u32, version u16, count u16, table size u32.
// Record: name offset u32, name length u16, flags u16, path offset u32, path length u16, reserved u16.
inline constexpr std::uint16_t kIndexVersion1 = 1;
inline constexpr std::size_t kHeaderSize1 = 12;
inline constexpr std::size_t kRecordSize1 = 16;

// Version 2. Header: magic u32, version u16, reserved u16, count u32, table size u32.
// Record: name offset u32, name length u16, flags u16, path offset u32, path length u16, reserved u16, package size u64.
// Offsets point into the string table, which follows the records.
inline constexpr std::uint16_t kIndexVersion2 = 2;
inline constexpr std::size_t kHeaderSize2 = 16;
inline constexpr std::uint32_t kRecordSize2 = 24;

}  // namespace pkgdb
