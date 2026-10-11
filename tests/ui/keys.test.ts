import { describe, expect, test } from "bun:test";
import { type KeyContext, type KeyState, reduceKey } from "../../src/web/keys";

const S: KeyState = { focus: "list", mobile: "list", selected: null, help: false, settings: false, chord: null };
const C: KeyContext = { ids: [10, 20, 30], typing: false, onButton: false, settingsLocked: false, now: 10_000 };
const press = (keys: string[], s: KeyState = S, c: KeyContext = C) => keys.reduce((st, k) => reduceKey(st, k, c).state, s);

describe("list keys", () => {
  test("j and k move within the list and stop at the ends", () => {
    expect(press(["j"]).selected).toBe(10);
    expect(press(["j", "j"]).selected).toBe(20);
    expect(press(["j", "j", "j", "j"]).selected).toBe(30);
    expect(press(["j", "k", "k"]).selected).toBe(10);
    expect(reduceKey(S, "j", C).effect).toBe("focus-list");
  });

  test("a selection that left the list restarts at the top", () => {
    expect(press(["j"], { ...S, selected: 99 }).selected).toBe(10);
  });

  // v3 (WP5, plan I14): j and k move between threads in the detail. M1 scrolled the pane.
  test("j and k move between threads when the detail has focus", () => {
    const r = reduceKey({ ...S, focus: "detail", selected: 20 }, "j", C);
    expect(r.state.selected).toBe(20);
    expect(r.effect).toBe("thread-next");
    expect(reduceKey({ ...S, focus: "detail" }, "k", C).effect).toBe("thread-prev");
  });

  // v3 (WP5): Enter opens the PR at its cause thread. M1 focused the pane.
  test("Enter and → open the selection at its cause, Esc and ← go back", () => {
    const open = reduceKey({ ...S, selected: 20 }, "Enter", C);
    expect(open.state).toMatchObject({ focus: "detail", mobile: "detail" });
    expect(open.effect).toBe("open-cause");
    expect(reduceKey({ ...S, selected: 20 }, "ArrowRight", C).state.focus).toBe("detail");
    for (const k of ["Escape", "ArrowLeft"]) {
      const r = reduceKey(open.state, k, C);
      expect(r.state).toMatchObject({ focus: "list", mobile: "list" });
      expect(r.effect).toBe("focus-list");
    }
  });

  test("Enter without a selection or on a button does nothing", () => {
    expect(reduceKey(S, "Enter", C).handled).toBe(false);
    expect(reduceKey({ ...S, selected: 20 }, "Enter", { ...C, onButton: true }).handled).toBe(false);
    expect(reduceKey({ ...S, selected: 20 }, "Enter", { ...C, ids: [] }).handled).toBe(false);
  });

  test("/ focuses the filter and shows the list on a phone", () => {
    const r = reduceKey({ ...S, mobile: "detail", focus: "detail" }, "/", C);
    expect(r.effect).toBe("focus-filter");
    expect(r.state).toMatchObject({ mobile: "list", focus: "list" });
  });
});

describe("typing, help, and settings", () => {
  test("only Esc works while typing, and it leaves the field", () => {
    const typing = { ...C, typing: true };
    expect(reduceKey(S, "j", typing).handled).toBe(false);
    expect(reduceKey(S, "?", typing).handled).toBe(false);
    expect(reduceKey(S, "Escape", typing).effect).toBe("focus-list");
  });

  test("? toggles help, and other keys wait while it is open", () => {
    const open = press(["?"]);
    expect(open.help).toBe(true);
    expect(reduceKey(open, "j", C).handled).toBe(false);
    expect(press(["?"], open).help).toBe(false);
    expect(press(["Escape"], open).help).toBe(false);
  });

  test("Esc on the phone views pane goes to the list", () => {
    expect(press(["Escape"], { ...S, mobile: "side" }).mobile).toBe("list");
  });

  test("Esc closes settings unless they are required", () => {
    const settings = { ...S, settings: true, focus: "detail" as const };
    expect(press(["Escape"], settings).settings).toBe(false);
    expect(press(["Escape"], settings, { ...C, settingsLocked: true }).settings).toBe(true);
  });

  test("unknown keys are not handled", () => {
    expect(reduceKey(S, "x", C).handled).toBe(false);
    expect(reduceKey(S, "n", C).handled).toBe(false);
  });
});

describe("detail keys", () => {
  test("n, N, y, o, 1 to 3, r, and R move focus to the detail and name their effect", () => {
    const r = reduceKey({ ...S, selected: 20 }, "n", C);
    expect(r.state).toMatchObject({ focus: "detail", mobile: "detail" });
    expect(r.effect).toBe("next-new");
    const effect = (key: string) => reduceKey({ ...S, selected: 20 }, key, C).effect;
    expect(["N", "y", "o", "1", "2", "3", "r", "R"].map(effect)).toEqual([
      "prev-new",
      "next-your",
      "thread-toggle",
      "overview",
      "drafts",
      "log",
      "rerun",
      "brief",
    ]);
  });

  // Plan v3 WP11, prototype/v3 Esc order: help, then the review brief or the run log, then the field, then the pane.
  test("Esc closes the open layer of the detail first, also while typing in the note", () => {
    const detail = { ...S, selected: 20, focus: "detail" as const, mobile: "detail" as const };
    expect(reduceKey(detail, "Escape", { ...C, layer: "brief", typing: true })).toMatchObject({ effect: "close-brief", state: detail });
    expect(reduceKey(detail, "Escape", { ...C, layer: "log" })).toMatchObject({ effect: "close-log", state: detail });
    expect(reduceKey({ ...detail, help: true }, "Escape", { ...C, layer: "log" })).toMatchObject({ effect: null, state: { help: false } });
    expect(reduceKey(detail, "Escape", { ...C, layer: null }).effect).toBe("focus-list");
  });

  test("r and R do nothing while typing", () => {
    for (const k of ["r", "R"]) expect(reduceKey({ ...S, selected: 20 }, k, { ...C, typing: true }).handled).toBe(false);
  });

  // Plan r2 UI-RR: c starts a re-review. After g, c still opens Commits.
  test("c reviews the new commits; g c still opens Commits; c does nothing while typing or without a PR", () => {
    expect(reduceKey({ ...S, selected: 20 }, "c", C)).toMatchObject({ effect: "rereview", state: { focus: "detail", mobile: "detail" } });
    expect(reduceKey(reduceKey({ ...S, selected: 20 }, "g", C).state, "c", C).effect).toBe("commits");
    expect(reduceKey({ ...S, selected: 20 }, "c", { ...C, typing: true }).handled).toBe(false);
    expect(reduceKey(S, "c", C).handled).toBe(false);
  });

  test("Enter in the detail toggles the current thread, but not on a button", () => {
    const detail = { ...S, selected: 20, focus: "detail" as const };
    expect(reduceKey(detail, "Enter", C).effect).toBe("thread-toggle");
    expect(reduceKey(detail, "Enter", { ...C, onButton: true }).handled).toBe(false);
  });

  test("g then f or c opens Files or Commits; the chord ends after 1.2 s or on another key", () => {
    const pr = { ...S, selected: 20 };
    const g = reduceKey(pr, "g", C);
    expect(g).toMatchObject({ handled: true, effect: null });
    expect(reduceKey(g.state, "f", C)).toMatchObject({ effect: "files", state: { focus: "detail", chord: null } });
    expect(reduceKey(g.state, "c", C).effect).toBe("commits");
    expect(reduceKey(g.state, "x", C)).toMatchObject({ handled: true, effect: null, state: { chord: null } });
    expect(reduceKey(g.state, "f", { ...C, now: C.now + 1300 }).handled).toBe(false);
    expect(reduceKey(S, "g", C).handled).toBe(false);
  });

  test("detail keys do nothing without a PR or while typing", () => {
    expect(reduceKey(S, "n", C).handled).toBe(false);
    expect(reduceKey({ ...S, selected: 20 }, "n", { ...C, typing: true }).handled).toBe(false);
    expect(reduceKey({ ...S, selected: 20, settings: true }, "n", { ...C, settingsLocked: true }).handled).toBe(false);
  });
});

// Plan v3 WP14a, prototype/v3 2744-2745: a, e, d, and p. Esc closes the post confirm after the brief.
describe("triage and post keys", () => {
  test("a, e, d, and p act on the selected PR in the detail", () => {
    const pr = { ...S, selected: 20 };
    const effects = ["a", "e", "d", "p"].map((k) => reduceKey(pr, k, C));
    expect(effects.map((r) => r.effect)).toEqual(["accept", "edit", "discard", "post"]);
    for (const r of effects) expect(r.state).toMatchObject({ focus: "detail", mobile: "detail" });
  });

  test("they do nothing while typing, so a reply box takes the letters", () => {
    for (const k of ["a", "e", "d", "p"]) expect(reduceKey({ ...S, selected: 20 }, k, { ...C, typing: true }).handled).toBe(false);
    expect(reduceKey(S, "p", C).handled).toBe(false);
  });

  test("Esc closes the post confirm", () => {
    const detail = { ...S, selected: 20, focus: "detail" as const, mobile: "detail" as const };
    expect(reduceKey(detail, "Escape", { ...C, layer: "confirm" })).toMatchObject({ effect: "close-confirm", state: detail });
  });
});
