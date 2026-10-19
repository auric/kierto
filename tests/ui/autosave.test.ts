// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { describe, expect, test } from "bun:test";
import { createSaver, type SaverState } from "../../src/web/settings/autosave";

// A put that waits until the test releases it.
function gate() {
  const sent: string[] = [];
  const waits: { resolve: () => void; reject: (e: Error) => void }[] = [];
  const put = (p: string) => {
    sent.push(p);
    return new Promise<void>((resolve, reject) => waits.push({ resolve, reject }));
  };
  return { sent, waits, put };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("autosave", () => {
  test("one request at a time; a change during a request sends the newest value after it", async () => {
    let value = "a";
    const g = gate();
    const states: SaverState["kind"][] = [];
    const s = createSaver(
      () => value,
      g.put,
      (x) => states.push(x.kind),
    );
    s.request();
    await tick();
    expect(g.sent).toEqual(["a"]);
    value = "b";
    s.request();
    value = "c";
    s.request();
    await tick();
    // The second and third change wait for the first request.
    expect(g.sent).toEqual(["a"]);
    expect(s.busy()).toBe(true);
    g.waits[0]?.resolve();
    await tick();
    // One more request with the newest value, not one per change.
    expect(g.sent).toEqual(["a", "c"]);
    g.waits[1]?.resolve();
    await s.flush();
    expect(g.sent).toEqual(["a", "c"]);
    expect(states).toEqual(["saving", "saving", "saved"]);
    expect(s.busy()).toBe(false);
  });

  test("nothing to send gives no request; a typing delay waits and a flush sends at once", async () => {
    let value: string | null = null;
    const g = gate();
    const states: SaverState["kind"][] = [];
    const s = createSaver(
      () => value,
      g.put,
      (x) => states.push(x.kind),
    );
    s.request();
    await s.flush();
    expect(g.sent).toEqual([]);
    expect(states).toEqual(["idle"]);
    value = "typed";
    s.request(60_000);
    await tick();
    expect(g.sent).toEqual([]);
    expect(s.busy()).toBe(true);
    const done = s.flush();
    await tick();
    expect(g.sent).toEqual(["typed"]);
    g.waits[0]?.resolve();
    await done;
    expect(states.at(-1)).toBe("saved");
    // Nothing more to send: the state stays saved.
    value = null;
    s.request();
    await s.flush();
    expect(states.at(-1)).toBe("saved");
  });

  test("a failed request reports its message; the next change tries again; cancel drops a waiting change", async () => {
    let value = "x";
    const g = gate();
    const states: SaverState[] = [];
    const s = createSaver(
      () => value,
      g.put,
      (x) => states.push(x),
    );
    s.request();
    await tick();
    g.waits[0]?.reject(new Error("Invalid settings."));
    await s.flush();
    expect(states.at(-1)).toEqual({ kind: "failed", message: "Invalid settings." });
    value = "y";
    s.request();
    await tick();
    g.waits[1]?.resolve();
    await s.flush();
    expect(g.sent).toEqual(["x", "y"]);
    expect(states.at(-1)).toEqual({ kind: "saved" });
    // A saver that saved nothing yet shows no state when it has nothing to send.
    const none = createSaver(
      () => null,
      g.put,
      (x) => states.push(x),
    );
    none.request();
    await none.flush();
    expect(states.at(-1)).toEqual({ kind: "idle" });
    value = "z";
    s.request(60_000);
    s.cancel();
    await s.flush();
    expect(g.sent).toEqual(["x", "y"]);
    expect(s.busy()).toBe(false);
  });
});
