#include "registry.h"

namespace pkgdb {

bool Registry::add(Entry e) {
  if (index_.contains(e.name)) return false;
  index_.emplace(e.name, entries_.size());
  entries_.push_back(std::move(e));
  return true;
}

const Entry* Registry::find(std::string_view name) const {
  const auto it = index_.find(std::string(name));
  return it == index_.end() ? nullptr : &entries_[it->second];
}

bool Registry::inherit(std::string_view name, const Entry& from) {
  const auto it = index_.find(std::string(name));
  if (it == index_.end()) return false;
  Entry& e = entries_[it->second];
  e.flags |= from.flags;
  e.deps.insert(e.deps.end(), from.deps.begin(), from.deps.end());
  e.deps.push_back(from.name);
  return true;
}

}  // namespace pkgdb
