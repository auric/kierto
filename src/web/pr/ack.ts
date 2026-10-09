// Pure acknowledgement batching (plan G7). The useAck hook feeds it from an IntersectionObserver.
export type AckItem = { id: number; version: number };
export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };

const browserTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as number) };

export function createAck(send: (items: AckItem[]) => void, timers: Timers = browserTimers, windowMs = 1000) {
  // Versions of the rendered comments. Only these versions go to the server (A2).
  let rendered = new Map<number, number>();
  const pending = new Map<number, number>();
  const sent = new Map<number, number>();
  let timer: unknown = null;

  function flush() {
    if (timer !== null) timers.clear(timer);
    timer = null;
    if (!pending.size) return;
    const items = [...pending].map(([id, version]) => ({ id, version }));
    pending.clear();
    for (const it of items) sent.set(it.id, it.version);
    send(items);
  }

  return {
    setRendered(comments: { id: number; version: number }[]) {
      rendered = new Map(comments.map((c) => [c.id, c.version]));
    },
    // The message is visible now. Its version is the one on screen at this moment.
    seen(id: number) {
      const version = rendered.get(id);
      if (version === undefined || (sent.get(id) ?? -1) >= version || (pending.get(id) ?? -1) >= version) return;
      pending.set(id, version);
      timer ??= timers.set(flush, windowMs);
    },
    flush,
  };
}
