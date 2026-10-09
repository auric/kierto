import { describe, expect, test } from "bun:test";
import { type AckItem, createAck, isSeen, type Timers } from "../../src/web/pr/ack";

class Stale extends Error {}

// send: undefined resolves. An Error value rejects with it.
function setup(outcomes: (Error | undefined)[] = []) {
  const sends: AckItem[][] = [];
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  let last = 0;
  const timers: Timers = {
    set: (fn, ms) => {
      pending.set(++last, fn);
      delays.push(ms);
      return last;
    },
    clear: (h) => void pending.delete(h as number),
  };
  const ack = createAck(
    async (items) => {
      sends.push(items);
      const o = outcomes.shift();
      if (o) throw o;
    },
    { timers, fatal: (e) => e instanceof Stale },
  );
  // Runs the pending timers, then lets the send promises settle.
  const tick = async () => {
    const fns = [...pending.values()];
    pending.clear();
    for (const fn of fns) fn();
    await Bun.sleep(0);
  };
  return { ack, sends, tick, pending, delays };
}

describe("createAck", () => {
  test("sends the version that was rendered when the message became visible", async () => {
    const { ack, sends, tick } = setup();
    ack.setRendered([{ id: 5, version: 0 }]);
    ack.seen(5);
    ack.setRendered([{ id: 5, version: 1 }]);
    await tick();
    expect(sends).toEqual([[{ id: 5, version: 0 }]]);
  });

  test("batches everything seen within one window into one request", async () => {
    const { ack, sends, tick, pending, delays } = setup();
    ack.setRendered([
      { id: 1, version: 0 },
      { id: 2, version: 3 },
    ]);
    ack.seen(1);
    ack.seen(2);
    ack.seen(1);
    expect(pending.size).toBe(1);
    expect(delays).toEqual([1000]);
    expect(sends).toEqual([]);
    await tick();
    expect(sends).toEqual([
      [
        { id: 1, version: 0 },
        { id: 2, version: 3 },
      ],
    ]);
  });

  test("flush on leave sends at once, and an acked version is not sent again", async () => {
    const { ack, sends, tick } = setup();
    ack.setRendered([{ id: 1, version: 0 }]);
    ack.seen(1);
    ack.flush();
    expect(sends).toEqual([[{ id: 1, version: 0 }]]);
    await tick();
    ack.seen(1);
    ack.flush();
    expect(sends.length).toBe(1);
    ack.setRendered([{ id: 1, version: 1 }]);
    ack.seen(1);
    ack.flush();
    expect(sends.at(-1)).toEqual([{ id: 1, version: 1 }]);
  });

  test("a message that is not rendered is never sent", () => {
    const { ack, sends } = setup();
    ack.seen(9);
    ack.flush();
    expect(sends).toEqual([]);
  });

  test("a failed send keeps its items and retries with a capped backoff", async () => {
    const fail = () => new Error("offline");
    const { ack, sends, tick, delays } = setup([fail(), fail(), fail(), fail(), fail(), fail()]);
    ack.setRendered([{ id: 1, version: 0 }]);
    ack.seen(1);
    for (let i = 0; i < 7; i++) await tick();
    expect(sends.length).toBe(7);
    expect(sends.every((s) => s.length === 1 && s[0]?.id === 1 && s[0].version === 0)).toBe(true);
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    // The seventh send succeeded: no retry is left, and the item counts as sent.
    ack.seen(1);
    ack.flush();
    expect(sends.length).toBe(7);
  });

  test("a newer version seen during a failed send wins the retry", async () => {
    const { ack, sends, tick } = setup([new Error("offline")]);
    ack.setRendered([{ id: 1, version: 0 }]);
    ack.seen(1);
    ack.flush();
    ack.setRendered([{ id: 1, version: 1 }]);
    ack.seen(1);
    await tick();
    await tick();
    expect(sends.at(-1)).toEqual([{ id: 1, version: 1 }]);
  });

  test("a stale session stops the queue", async () => {
    const { ack, sends, tick, pending } = setup([new Stale()]);
    ack.setRendered([
      { id: 1, version: 0 },
      { id: 2, version: 0 },
    ]);
    ack.seen(1);
    ack.flush();
    await tick();
    ack.seen(2);
    ack.flush();
    expect(sends.length).toBe(1);
    expect(pending.size).toBe(0);
  });
});

describe("isSeen", () => {
  const entry = (ratio: number, visible: number, pane: number | null) => ({
    isIntersecting: ratio > 0,
    intersectionRatio: ratio,
    intersectionRect: { height: visible },
    rootBounds: pane === null ? null : { height: pane },
  });

  test("half of the message is visible", () => {
    expect(isSeen(entry(0.5, 50, 800))).toBe(true);
    expect(isSeen(entry(0.49, 49, 800))).toBe(false);
  });

  test("a message taller than the pane counts when it covers half of the pane", () => {
    expect(isSeen(entry(0.2, 400, 800))).toBe(true);
    expect(isSeen(entry(0.19, 399, 800))).toBe(false);
    expect(isSeen(entry(0.2, 400, null))).toBe(false);
  });

  test("a message outside the pane never counts", () => {
    expect(isSeen({ ...entry(0.6, 0, 800), isIntersecting: false })).toBe(false);
  });
});
