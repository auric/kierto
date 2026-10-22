#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace pkgdb {

struct Entry {
  std::string name;
  std::string path;
  std::uint32_t flags = 0;
  std::uint64_t size = 0;
  std::vector<std::string> deps;
};

// The packages in insertion order, with an index by name.
class Registry {
 public:
  // Adds an entry. Returns false when the name exists. add() can move every stored entry.
  bool add(Entry e);

  // The entry of a name, or nullptr. The pointer is borrowed: it is valid only until the next add().
  const Entry* find(std::string_view name) const;

  // Copies the flags and the dependencies of from into the entry of name, and adds from.name as a dependency.
  // Returns false when name is unknown.
  bool inherit(std::string_view name, const Entry& from);

  const std::vector<Entry>& entries() const { return entries_; }
  std::size_t size() const { return entries_.size(); }

 private:
  std::vector<Entry> entries_;
  std::unordered_map<std::string, std::size_t> index_;
};

}  // namespace pkgdb
