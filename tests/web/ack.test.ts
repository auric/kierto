import { describe, expect, test } from "bun:test";
import { type AckItem, createAck, type Timers } from "../../src/web/pr/ack";

function setup() {
  const sends: AckItem[][] = [];
  const queue: (() => void)[] = [];
  const timers: Timers = {
    set: (fn) => queue.push(fn),
    clear: (h) => {
      queue[(h as number) - 1] = () => {};
    },
  };
  const ack = createAck((items) => sends.push(items), timers);
  const tick = () => {
    for (const fn of queue.splice(0)) fn();
  };
  return { ack, sends, tick, queue };
}

describe("createAck", () => {
  test("sends the version that was rendered when the message became visible", () => {
    const { ack, sends, tick } = setup();
    ack.setRendered([{ id: 5, version: 0 }]);
    ack.seen(5);
    ack.setRendered([{ id: 5, version: 1 }]);
    tick();
    expect(sends).toEqual([[{ id: 5, version: 0 }]]);
  });

  test("batches everything seen within one window into one request", () => {
    const { ack, sends, tick, queue } = setup();
    ack.setRendered([
      { id: 1, version: 0 },
      { id: 2, version: 3 },
    ]);
    ack.seen(1);
    ack.seen(2);
    ack.seen(1);
    expect(queue.length).toBe(1);
    expect(sends).toEqual([]);
    tick();
    expect(sends).toEqual([
      [
        { id: 1, version: 0 },
        { id: 2, version: 3 },
      ],
    ]);
  });

  test("flush on leave sends at once, and an acked version is not sent again", () => {
    const { ack, sends, tick } = setup();
    ack.setRendered([{ id: 1, version: 0 }]);
    ack.seen(1);
    ack.flush();
    expect(sends).toEqual([[{ id: 1, version: 0 }]]);
    tick();
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
});
