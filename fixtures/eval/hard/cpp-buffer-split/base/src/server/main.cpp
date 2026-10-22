#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstdio>
#include <memory>
#include <vector>

#include "net/buffers.h"
#include "server/config.h"
#include "server/connection.h"

namespace {

constexpr std::uint8_t kPing = 0x01;

// Answers a ping frame with the same payload. Other frame types go to the store, which is out of scope here.
void handle(server::Connection& c, std::span<const std::uint8_t> frame) {
  if (!frame.empty() && frame[0] == kPing) c.send(frame);
}

int listenOn(std::uint16_t port) {
  const int fd = ::socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
  const int one = 1;
  ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(port);
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof addr) != 0 || ::listen(fd, 128) != 0) {
    std::perror("listen");
    return -1;
  }
  return fd;
}

}  // namespace

int main(int argc, char** argv) {
  const server::Config cfg = server::loadConfig(argc > 1 ? argv[1] : "server.conf");
  net::detail::BufferPool pool(cfg.bufferCapacity, cfg.maxBuffers);
  const int lfd = listenOn(cfg.port);
  if (lfd < 0) return 1;
  std::vector<std::unique_ptr<server::Connection>> conns;
  for (;;) {
    std::vector<pollfd> fds{{lfd, POLLIN, 0}};
    for (const auto& c : conns) fds.push_back({c->fd(), static_cast<short>(POLLIN | (c->wantsWrite() ? POLLOUT : 0)), 0});
    if (::poll(fds.data(), fds.size(), 1000) < 0) continue;
    if (fds[0].revents & POLLIN) {
      const int cfd = ::accept4(lfd, nullptr, nullptr, SOCK_NONBLOCK);
      if (cfd >= 0) conns.push_back(std::make_unique<server::Connection>(cfd, pool, cfg, handle));
    }
    for (std::size_t i = 1; i < fds.size(); ++i) {
      server::Connection& c = *conns[i - 1];
      if (fds[i].revents & POLLIN) c.onReadable();
      if (c.open() && (fds[i].revents & POLLOUT)) c.onWritable();
    }
    std::erase_if(conns, [](const auto& c) { return !c->open(); });
  }
}
