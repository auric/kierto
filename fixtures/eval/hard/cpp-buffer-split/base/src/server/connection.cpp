#include "server/connection.h"

#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>

namespace server {

Connection::Connection(int fd, BufferPool& pool, const Config& config, FrameHandler handler)
    : fd_(fd),
      pool_(pool),
      in_(nullptr, BufferPool::Returner{&pool}),
      reader_(config.maxFrame),
      out_(config.sendRing),
      handler_(std::move(handler)) {}

Connection::~Connection() { close(); }

void Connection::close() {
  if (fd_ < 0) return;
  ::close(fd_);
  fd_ = -1;
}

void Connection::onReadable() {
  if (!in_) {
    in_ = pool_.acquire();
    // All buffers are in use. The socket stays readable, so the event loop calls again.
    if (!in_) return;
  }
  const auto space = in_->writable();
  // A full buffer without a complete frame: config.cpp keeps max_frame + 4 within the buffer, so the client sent garbage.
  if (space.empty()) {
    close();
    return;
  }
  const ssize_t n = ::recv(fd_, space.data(), space.size(), 0);
  if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
    close();
    return;
  }
  if (n < 0) return;
  in_->commit(static_cast<std::size_t>(n));

  // The handler gets each frame before consume() moves the bytes that its span points to.
  std::span<const std::uint8_t> frame;
  for (;;) {
    const FrameReader::Status st = reader_.next(*in_, frame);
    if (st == FrameReader::Status::kNeedMore) break;
    if (st == FrameReader::Status::kTooLarge) {
      close();
      return;
    }
    handler_(*this, frame);
    if (!open()) return;
  }
  in_->consume(reader_.consumed());
  reader_.restart();
  // An idle client holds no buffer.
  if (in_->size() == 0) in_.reset();
}

bool Connection::send(std::span<const std::uint8_t> payload) {
  BufferPool::Pooled b = pool_.acquire();
  if (!b || !net::detail::writeFrame(*b, payload)) return false;
  return out_.push(b);
}

void Connection::onWritable() {
  while (Buffer* b = out_.front()) {
    const auto bytes = b->view(sentOfFront_, b->size() - sentOfFront_);
    const ssize_t n = ::send(fd_, bytes.data(), bytes.size(), MSG_NOSIGNAL);
    if (n < 0) {
      if (errno != EAGAIN && errno != EWOULDBLOCK) close();
      return;
    }
    sentOfFront_ += static_cast<std::size_t>(n);
    if (sentOfFront_ < b->size()) return;
    out_.pop();
    sentOfFront_ = 0;
  }
}

}  // namespace server
