# framed

A framed TCP server: each frame is a 4-byte big-endian length and the payload. A ping frame (first byte 0x01) comes back unchanged.

All connections share one buffer pool. A connection holds an input buffer only while it has unread bytes, so 100 000 idle clients need no buffers.

## Layout

- `include/net/buffers.h`, `src/net/buffers.cpp`: buffers, the buffer pool, the send ring, and the frame reader and writer.
- `src/server/`: the configuration, the connection, and the poll loop.
