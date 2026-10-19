// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Pure acknowledgement batching (plan G7). The useAck hook feeds it from an IntersectionObserver.
export type AckItem = { id: number; version: number };
export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };

const browserTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as number) };

type Entry = {
  isIntersecting: boolean;
  intersectionRatio: number;
  intersectionRect: { height: number };
  rootBounds: { height: number } | null;
};

// Read rule (plan section 2): 50% of the message is visible. A message taller than the pane counts when it covers 50% of the pane.
export const isSeen = (e: Entry) =>
  e.isIntersecting && (e.intersectionRatio >= 0.5 || (e.rootBounds !== null && e.intersectionRect.height >= 0.5 * e.rootBounds.height));

export function createAck(
  send: (items: AckItem[]) => Promise<unknown>,
  // fatal: an error that no retry can fix, such as a stale session. The queue then stops.
  opts: { timers?: Timers; windowMs?: number; maxDelayMs?: number; fatal?: (e: unknown) => boolean } = {},
) {
  const { timers = browserTimers, windowMs = 1000, maxDelayMs = 30_000, fatal = () => false } = opts;
  // Versions of the rendered comments. Only these versions go to the server (A2).
  let rendered = new Map<number, number>();
  const pending = new Map<number, number>();
  const sent = new Map<number, number>();
  let timer: unknown = null;
  let failures = 0;
  let stopped = false;

  const schedule = (ms: number) => {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(flush, ms);
  };

  function failed(items: AckItem[], e: unknown) {
    if (fatal(e)) {
      stopped = true;
      pending.clear();
      if (timer !== null) timers.clear(timer);
      timer = null;
      return;
    }
    for (const it of items) {
      // A newer version went out after this one. It covers this one.
      if ((sent.get(it.id) ?? -1) > it.version) continue;
      sent.delete(it.id);
      if ((pending.get(it.id) ?? -1) < it.version) pending.set(it.id, it.version);
    }
    failures++;
    schedule(Math.min(windowMs * 2 ** failures, maxDelayMs));
  }

  function flush() {
    if (timer !== null) timers.clear(timer);
    timer = null;
    if (stopped || !pending.size) return;
    const items = [...pending].map(([id, version]) => ({ id, version }));
    pending.clear();
    for (const it of items) sent.set(it.id, it.version);
    send(items).then(
      () => {
        failures = 0;
      },
      (e) => failed(items, e),
    );
  }

  return {
    setRendered(comments: { id: number; version: number }[]) {
      rendered = new Map(comments.map((c) => [c.id, c.version]));
    },
    // The message is visible now. Its version is the one on screen at this moment.
    seen(id: number) {
      const version = rendered.get(id);
      if (stopped || version === undefined || (sent.get(id) ?? -1) >= version || (pending.get(id) ?? -1) >= version) return;
      pending.set(id, version);
      if (timer === null) schedule(windowMs);
    },
    flush,
  };
}
