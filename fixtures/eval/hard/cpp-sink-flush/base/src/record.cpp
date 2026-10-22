#include "shipper/record.h"

namespace shipper {

Record Record::make(Level level, std::string_view text) {
  std::size_t n = text.size();
  if (n > kMaxRecordBytes) {
    n = kMaxRecordBytes;
    while (n > 0 && (static_cast<unsigned char>(text[n]) & 0xC0) == 0x80) --n;
  }
  std::string t(text.substr(0, n));
  for (char& c : t)
    if (static_cast<unsigned char>(c) < 0x20) c = ' ';
  return Record(level, std::chrono::system_clock::now(), std::move(t));
}

}  // namespace shipper
