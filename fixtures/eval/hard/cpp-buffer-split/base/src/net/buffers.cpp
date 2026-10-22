#include "net/buffers.h"

#include <cstring>
#include <stdexcept>

namespace net::detail {

// ---- Buffer ----

Buffer::Buffer(std::size_t capacity) : data_(new std::uint8_t[capacity]), capacity_(capacity) {}

bool Buffer::append(std::span<const std::uint8_t> bytes) {
  if (bytes.size() > capacity_ - size_) return false;
  std::memcpy(data_.get() + size_, bytes.data(), bytes.size());
  size_ += bytes.size();
  return true;
}

std::span<const std::uint8_t> Buffer::view(std::size_t offset, std::size_t len) const {
  if (offset > size_ || len > size_ - offset) return {};
  return {data_.get() + offset, len};
}

void Buffer::consume(std::size_t n) {
  if (n >= size_) {
    size_ = 0;
    return;
  }
  std::memmove(data_.get(), data_.get() + n, size_ - n);
  size_ -= n;
}

// ---- BufferPool ----

BufferPool::BufferPool(std::size_t bufferCapacity, std::size_t maxBuffers) : bufferCapacity_(bufferCapacity), maxBuffers_(maxBuffers) {
  if (bufferCapacity == 0 || maxBuffers == 0) throw std::invalid_argument("BufferPool needs a capacity and a buffer count");
  idle_.reserve(maxBuffers);
}

BufferPool::~BufferPool() {
  for (Buffer* b : idle_) delete b;
}

BufferPool::Pooled BufferPool::acquire() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (inUse_ == maxBuffers_) {
    ++refused_;
    return Pooled(nullptr, Returner{this});
  }
  ++inUse_;
  if (idle_.empty()) return Pooled(new Buffer(bufferCapacity_), Returner{this});
  Buffer* b = idle_.back();
  idle_.pop_back();
  b->reset();
  return Pooled(b, Returner{this});
}

void BufferPool::release(Buffer* b) {
  if (!b) return;
  std::lock_guard<std::mutex> lock(mutex_);
  --inUse_;
  idle_.push_back(b);
}

BufferPool::Stats BufferPool::stats() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return Stats{inUse_, idle_.size(), refused_};
}

// ---- SendRing ----

SendRing::SendRing(std::size_t capacity) : mask_(capacity - 1) {
  slots_.reserve(capacity);
  for (std::size_t i = 0; i < capacity; ++i) slots_.emplace_back(nullptr, BufferPool::Returner{nullptr});
}

bool SendRing::push(BufferPool::Pooled& b) {
  if (count_ == slots_.size()) return false;
  slots_[(head_ + count_) & mask_] = std::move(b);
  ++count_;
  return true;
}

Buffer* SendRing::front() { return count_ == 0 ? nullptr : slots_[head_].get(); }

void SendRing::pop() {
  if (count_ == 0) return;
  slots_[head_].reset();
  head_ = (head_ + 1) & mask_;
  --count_;
}

// ---- Frames ----

namespace {

std::uint32_t readBe32(const std::uint8_t* p) {
  return (std::uint32_t{p[0]} << 24) | (std::uint32_t{p[1]} << 16) | (std::uint32_t{p[2]} << 8) | std::uint32_t{p[3]};
}

void writeBe32(std::uint8_t* p, std::uint32_t v) {
  p[0] = static_cast<std::uint8_t>(v >> 24);
  p[1] = static_cast<std::uint8_t>(v >> 16);
  p[2] = static_cast<std::uint8_t>(v >> 8);
  p[3] = static_cast<std::uint8_t>(v);
}

}  // namespace

FrameReader::Status FrameReader::next(const Buffer& buf, std::span<const std::uint8_t>& frame) {
  const auto header = buf.view(pos_, 4);
  if (header.empty()) return Status::kNeedMore;
  const std::uint32_t len = readBe32(header.data());
  if (len > maxFrame_) return Status::kTooLarge;
  const auto payload = buf.view(pos_ + 4, len);
  if (payload.size() != len) return Status::kNeedMore;
  frame = payload;
  pos_ += 4 + std::size_t{len};
  return Status::kFrame;
}

bool writeFrame(Buffer& out, std::span<const std::uint8_t> payload) {
  if (payload.size() > 0xffffffffu || 4 + payload.size() > out.writable().size()) return false;
  std::uint8_t header[4];
  writeBe32(header, static_cast<std::uint32_t>(payload.size()));
  return out.append(header) && out.append(payload);
}

// ---- Debug ----

std::string toHex(std::span<const std::uint8_t> bytes, std::size_t max) {
  static constexpr char kDigits[] = "0123456789abcdef";
  std::string out;
  const std::size_t n = bytes.size() < max ? bytes.size() : max;
  out.reserve(n * 2 + 3);
  for (std::size_t i = 0; i < n; ++i) {
    out += kDigits[bytes[i] >> 4];
    out += kDigits[bytes[i] & 0xf];
  }
  if (bytes.size() > max) out += "...";
  return out;
}

}  // namespace net::detail
