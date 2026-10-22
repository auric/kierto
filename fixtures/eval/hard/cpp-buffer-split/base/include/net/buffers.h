#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <span>
#include <string>
#include <vector>

namespace net::detail {

// ---- Buffer ----

// A byte buffer with a fixed capacity. The written part is [0, size()); the rest is free space for the next recv().
class Buffer {
 public:
  explicit Buffer(std::size_t capacity);

  std::size_t size() const { return size_; }
  std::size_t capacity() const { return capacity_; }

  // The free space after the written part.
  std::span<std::uint8_t> writable() { return {data_.get() + size_, capacity_ - size_}; }

  // Marks n more bytes as written. n must not exceed writable().size().
  void commit(std::size_t n) { size_ += n; }

  // Appends bytes. Returns false, and appends nothing, when they do not fit.
  bool append(std::span<const std::uint8_t> bytes);

  // The bytes [offset, offset + len) of the written part, or an empty span when the range is not inside it.
  std::span<const std::uint8_t> view(std::size_t offset, std::size_t len) const;

  // Drops the first n written bytes and moves the rest to the front. Spans from view() become invalid.
  void consume(std::size_t n);

  // Empties the buffer for its next user. The old bytes stay in memory; size() and view() hide them.
  void reset() { size_ = 0; }

 private:
  std::unique_ptr<std::uint8_t[]> data_;
  std::size_t capacity_;
  std::size_t size_ = 0;
};

// ---- BufferPool ----

// A thread-safe pool of buffers of one capacity. The connections of all clients share one pool.
class BufferPool {
 public:
  struct Returner {
    BufferPool* pool;
    void operator()(Buffer* b) const { pool->release(b); }
  };
  using Pooled = std::unique_ptr<Buffer, Returner>;

  struct Stats {
    std::size_t inUse = 0;
    std::size_t idle = 0;
    std::size_t refused = 0;
  };

  BufferPool(std::size_t bufferCapacity, std::size_t maxBuffers);
  ~BufferPool();

  BufferPool(const BufferPool&) = delete;
  BufferPool& operator=(const BufferPool&) = delete;

  // An empty buffer, or nullptr when maxBuffers buffers are in use.
  Pooled acquire();

  Stats stats() const;
  std::size_t bufferCapacity() const { return bufferCapacity_; }

 private:
  void release(Buffer* b);

  const std::size_t bufferCapacity_;
  const std::size_t maxBuffers_;
  mutable std::mutex mutex_;
  std::vector<Buffer*> idle_;
  std::size_t inUse_ = 0;
  std::size_t refused_ = 0;
};

// ---- SendRing ----

// The buffers that wait to be sent on one connection, oldest first. capacity must be a power of two.
class SendRing {
 public:
  explicit SendRing(std::size_t capacity);

  // Returns false, and keeps the buffer with the caller, when the ring is full.
  bool push(BufferPool::Pooled& b);
  // The oldest buffer, or nullptr when the ring is empty.
  Buffer* front();
  // Removes the oldest buffer and gives it back to its pool.
  void pop();

  std::size_t size() const { return count_; }
  bool empty() const { return count_ == 0; }

 private:
  std::vector<BufferPool::Pooled> slots_;
  std::size_t mask_;
  std::size_t head_ = 0;
  std::size_t count_ = 0;
};

// ---- Frames ----

// Splits the written part of a buffer into frames: a 4-byte big-endian length, then that many payload bytes.
class FrameReader {
 public:
  enum class Status { kFrame, kNeedMore, kTooLarge };

  explicit FrameReader(std::size_t maxFrame) : maxFrame_(maxFrame) {}

  // The next complete frame after the frames that next() already returned. The span is valid until the next
  // Buffer::consume(). kNeedMore: the buffer does not hold the whole frame yet.
  Status next(const Buffer& buf, std::span<const std::uint8_t>& frame);

  // Bytes of the frames that next() returned since the last restart(): pass it to Buffer::consume().
  std::size_t consumed() const { return pos_; }
  void restart() { pos_ = 0; }

 private:
  std::size_t maxFrame_;
  std::size_t pos_ = 0;
};

// Appends one frame to a buffer. Returns false, and appends nothing, when the frame does not fit.
bool writeFrame(Buffer& out, std::span<const std::uint8_t> payload);

// ---- Debug ----

// The first max bytes as hex pairs, with "..." when the span is longer. For log lines.
std::string toHex(std::span<const std::uint8_t> bytes, std::size_t max = 32);

}  // namespace net::detail
