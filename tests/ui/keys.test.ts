import { describe, expect, test } from "bun:test";
import { type KeyContext, type KeyState, reduceKey } from "../../src/web/keys";

const S: KeyState = { focus: "list", mobile: "list", selected: null, help: false, settings: false };
const C: KeyContext = { ids: [10, 20, 30], typing: false, onButton: false, settingsLocked: false };
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

  test("j and k scroll the detail pane when it has focus", () => {
    const r = reduceKey({ ...S, focus: "detail", selected: 20 }, "j", C);
    expect(r.state.selected).toBe(20);
    expect(r.effect).toBe("scroll-down");
    expect(reduceKey({ ...S, focus: "detail" }, "k", C).effect).toBe("scroll-up");
  });

  test("Enter and → open the selection, Esc and ← go back", () => {
    const open = reduceKey({ ...S, selected: 20 }, "Enter", C);
    expect(open.state).toMatchObject({ focus: "detail", mobile: "detail" });
    expect(open.effect).toBe("focus-detail");
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
  test("n and 1 to 3 move focus to the detail and name their effect", () => {
    const r = reduceKey({ ...S, selected: 20 }, "n", C);
    expect(r.state).toMatchObject({ focus: "detail", mobile: "detail" });
    expect(r.effect).toBe("next-new");
    expect(reduceKey({ ...S, selected: 20, focus: "detail" }, "1", C).effect).toBe("tab-1");
    expect(reduceKey({ ...S, selected: 20 }, "3", C).effect).toBe("tab-3");
  });

  test("detail keys do nothing without a PR or while typing", () => {
    expect(reduceKey(S, "n", C).handled).toBe(false);
    expect(reduceKey({ ...S, selected: 20 }, "n", { ...C, typing: true }).handled).toBe(false);
    expect(reduceKey({ ...S, selected: 20, settings: true }, "n", { ...C, settingsLocked: true }).handled).toBe(false);
  });
});
