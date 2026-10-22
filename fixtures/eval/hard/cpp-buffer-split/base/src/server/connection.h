#pragma once

#include <cstdint>
#include <functional>
#include <span>

#include "net/buffers.h"
#include "server/config.h"

namespace server {

using net::detail::Buffer;
using net::detail::BufferPool;
using net::detail::FrameReader;
using net::detail::SendRing;

// One client on a non-blocking socket. The event loop calls onReadable() and onWritable().
class Connection {
 public:
  using FrameHandler = std::function<void(Connection&, std::span<const std::uint8_t>)>;

  Connection(int fd, BufferPool& pool, const Config& config, FrameHandler handler);
  ~Connection();

  Connection(const Connection&) = delete;
  Connection& operator=(const Connection&) = delete;

  void onReadable();
  void onWritable();

  // Queues one reply frame. Returns false when the send ring is full or no buffer is free.
  bool send(std::span<const std::uint8_t> payload);

  bool open() const { return fd_ >= 0; }
  bool wantsWrite() const { return !out_.empty(); }
  int fd() const { return fd_; }

 private:
  void close();

  int fd_;
  BufferPool& pool_;
  BufferPool::Pooled in_;
  FrameReader reader_;
  SendRing out_;
  std::size_t sentOfFront_ = 0;
  FrameHandler handler_;
};

}  // namespace server
