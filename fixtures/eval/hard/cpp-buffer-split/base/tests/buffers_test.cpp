#include <cassert>
#include <cstdint>
#include <cstdio>
#include <span>
#include <string>
#include <vector>

#include "net/buffers.h"

using namespace net::detail;

namespace {

// A buffer that holds exactly these bytes.
Buffer bufferWith(const std::vector<std::uint8_t>& bytes) {
  Buffer b(bytes.size());
  assert(b.append(bytes));
  return b;
}

std::vector<std::uint8_t> frameBytes(const std::string& payload) {
  const auto n = static_cast<std::uint32_t>(payload.size());
  std::vector<std::uint8_t> out{std::uint8_t(n >> 24), std::uint8_t(n >> 16), std::uint8_t(n >> 8), std::uint8_t(n)};
  out.insert(out.end(), payload.begin(), payload.end());
  return out;
}

std::string text(std::span<const std::uint8_t> s) { return std::string(s.begin(), s.end()); }

// ---- Buffer ----

void appendAndView() {
  Buffer b(8);
  const std::uint8_t data[] = {1, 2, 3, 4};
  assert(b.append(data));
  assert(b.size() == 4);
  assert(b.view(1, 2).size() == 2 && b.view(1, 2)[0] == 2);
  assert(b.view(0, 4).size() == 4);
}

void viewRefusesARangeOutsideTheWrittenPart() {
  const Buffer b = bufferWith({1, 2, 3});
  assert(b.view(0, 4).empty());
  assert(b.view(4, 0).empty());
  assert(b.view(2, 2).empty());
  assert(b.view(1, ~std::size_t{0}).empty());
}

void appendRefusesBytesThatDoNotFit() {
  Buffer b(3);
  const std::uint8_t data[] = {1, 2, 3, 4};
  assert(!b.append(data));
  assert(b.size() == 0);
}

void consumeMovesTheRestToTheFront() {
  Buffer b = bufferWith({1, 2, 3, 4, 5});
  b.consume(2);
  assert(b.size() == 3 && b.view(0, 1)[0] == 3);
  b.consume(10);
  assert(b.size() == 0);
}

void commitAddsReceivedBytes() {
  Buffer b(8);
  auto w = b.writable();
  w[0] = 7;
  w[1] = 8;
  b.commit(2);
  assert(b.size() == 2 && b.view(1, 1)[0] == 8);
  assert(b.writable().size() == 6);
}

// ---- BufferPool ----

void poolReusesAReleasedBuffer() {
  BufferPool pool(16, 2);
  Buffer* first = nullptr;
  {
    auto b = pool.acquire();
    first = b.get();
    const std::uint8_t data[] = {9, 9};
    assert(b->append(data));
  }
  auto again = pool.acquire();
  assert(again.get() == first);
  assert(again->size() == 0);
}

void poolRefusesBeyondItsLimit() {
  BufferPool pool(16, 2);
  auto a = pool.acquire();
  auto b = pool.acquire();
  auto c = pool.acquire();
  assert(a && b && !c);
  assert(pool.stats().refused == 1 && pool.stats().inUse == 2);
}

// ---- SendRing ----

void ringKeepsTheOrderAcrossTheWrap() {
  BufferPool pool(16, 8);
  SendRing ring(4);
  for (int round = 0; round < 3; ++round) {
    for (std::uint8_t i = 0; i < 3; ++i) {
      auto b = pool.acquire();
      const std::uint8_t v[] = {i};
      assert(b->append(v));
      assert(ring.push(b));
    }
    for (std::uint8_t i = 0; i < 3; ++i) {
      assert(ring.front()->view(0, 1)[0] == i);
      ring.pop();
    }
  }
  assert(ring.empty() && pool.stats().inUse == 0);
}

void ringRefusesWhenFull() {
  BufferPool pool(16, 8);
  SendRing ring(2);
  auto a = pool.acquire();
  auto b = pool.acquire();
  auto c = pool.acquire();
  assert(ring.push(a) && ring.push(b));
  assert(!ring.push(c));
  assert(c != nullptr);
}

// ---- Frames ----

void readsTwoFramesFromOneBuffer() {
  auto bytes = frameBytes("hello");
  const auto second = frameBytes("world!");
  bytes.insert(bytes.end(), second.begin(), second.end());
  const Buffer b = bufferWith(bytes);
  FrameReader r(1024);
  std::span<const std::uint8_t> f;
  assert(r.next(b, f) == FrameReader::Status::kFrame && text(f) == "hello");
  assert(r.next(b, f) == FrameReader::Status::kFrame && text(f) == "world!");
  assert(r.next(b, f) == FrameReader::Status::kNeedMore);
  assert(r.consumed() == bytes.size());
}

void waitsForTheRestOfAFrame() {
  auto bytes = frameBytes("hello");
  bytes.resize(bytes.size() - 2);
  const Buffer b = bufferWith(bytes);
  FrameReader r(1024);
  std::span<const std::uint8_t> f;
  assert(r.next(b, f) == FrameReader::Status::kNeedMore);
  assert(r.consumed() == 0);
  const Buffer header = bufferWith({0, 0});
  assert(r.next(header, f) == FrameReader::Status::kNeedMore);
}

void refusesAFrameAboveTheLimit() {
  const Buffer b = bufferWith(frameBytes(std::string(100, 'x')));
  FrameReader r(99);
  std::span<const std::uint8_t> f;
  assert(r.next(b, f) == FrameReader::Status::kTooLarge);
}

void writeFrameRoundTrips() {
  Buffer b(32);
  const std::string payload = "ping";
  assert(writeFrame(b, std::span<const std::uint8_t>(reinterpret_cast<const std::uint8_t*>(payload.data()), payload.size())));
  FrameReader r(32);
  std::span<const std::uint8_t> f;
  assert(r.next(b, f) == FrameReader::Status::kFrame && text(f) == "ping");
  Buffer small(6);
  assert(!writeFrame(small, std::span<const std::uint8_t>(reinterpret_cast<const std::uint8_t*>(payload.data()), payload.size())));
}

void hexIsShortForLogs() {
  const std::vector<std::uint8_t> bytes{0x01, 0xab, 0xff};
  assert(toHex(bytes) == "01abff");
  assert(toHex(bytes, 2) == "01ab...");
}

}  // namespace

int main() {
  appendAndView();
  viewRefusesARangeOutsideTheWrittenPart();
  appendRefusesBytesThatDoNotFit();
  consumeMovesTheRestToTheFront();
  commitAddsReceivedBytes();
  poolReusesAReleasedBuffer();
  poolRefusesBeyondItsLimit();
  ringKeepsTheOrderAcrossTheWrap();
  ringRefusesWhenFull();
  readsTwoFramesFromOneBuffer();
  waitsForTheRestOfAFrame();
  refusesAFrameAboveTheLimit();
  writeFrameRoundTrips();
  hexIsShortForLogs();
  std::puts("buffers_test: ok");
  return 0;
}
