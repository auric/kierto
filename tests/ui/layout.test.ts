// Plan pr-view-v4 P2: the list width and the sidebar choice stay per viewer. A missing or blocked store gives the default.
import { describe, expect, test } from "bun:test";
import {
  clampList,
  LIST_MAX,
  LIST_MIN,
  listDefault,
  railOn,
  readListWidth,
  readSide,
  writeListWidth,
  writeSide,
} from "../../src/web/shell/layout";

const memory = () => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
// A browser that blocks site data throws on each access.
const blocked = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("list width", () => {
  test("clamp keeps 280 to 560 px and whole pixels", () => {
    expect(clampList(100)).toBe(LIST_MIN);
    expect(clampList(9999)).toBe(LIST_MAX);
    expect(clampList(400.6)).toBe(401);
    expect([LIST_MIN, LIST_MAX]).toEqual([280, 560]);
  });

  test("the default is 368 px next to the full sidebar and 320 px next to the rail", () => {
    expect(listDefault(false)).toBe(368);
    expect(listDefault(true)).toBe(320);
  });

  test("a stored width comes back clamped; null removes it", () => {
    const s = memory();
    expect(readListWidth(s)).toBeNull();
    writeListWidth(432, s);
    expect(readListWidth(s)).toBe(432);
    writeListWidth(900, s);
    expect(s.m.get("rl-list-w")).toBe("560");
    s.m.set("rl-list-w", "100");
    expect(readListWidth(s)).toBe(280);
    writeListWidth(null, s);
    expect(s.m.has("rl-list-w")).toBe(false);
  });

  test("a bad value, no store, or a blocked store gives the default", () => {
    const s = memory();
    for (const v of ["", "abc", "NaN", "Infinity"]) {
      s.m.set("rl-list-w", v);
      expect(readListWidth(s)).toBeNull();
    }
    expect(readListWidth(null)).toBeNull();
    expect(readListWidth(blocked)).toBeNull();
    expect(() => writeListWidth(400, blocked)).not.toThrow();
    expect(() => writeListWidth(null, blocked)).not.toThrow();
    expect(() => writeListWidth(400, null)).not.toThrow();
  });

  test("a localStorage getter that throws gives the default", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(readListWidth()).toBeNull();
      expect(readSide()).toBe("auto");
      expect(() => writeListWidth(400)).not.toThrow();
      expect(() => writeSide("rail")).not.toThrow();
    } finally {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});

describe("sidebar choice", () => {
  test("auto gives the rail below 1440 px; rail and full hold at every width", () => {
    expect(railOn("auto", false)).toBe(true);
    expect(railOn("auto", true)).toBe(false);
    expect(railOn("rail", true)).toBe(true);
    expect(railOn("full", false)).toBe(false);
  });

  test("the choice is stored; auto removes it", () => {
    const s = memory();
    expect(readSide(s)).toBe("auto");
    writeSide("rail", s);
    expect(readSide(s)).toBe("rail");
    writeSide("full", s);
    expect(readSide(s)).toBe("full");
    writeSide("auto", s);
    expect(s.m.has("rl-side")).toBe(false);
    s.m.set("rl-side", "wide");
    expect(readSide(s)).toBe("auto");
  });

  test("no store or a blocked store gives auto", () => {
    expect(readSide(null)).toBe("auto");
    expect(readSide(blocked)).toBe("auto");
    expect(() => writeSide("rail", blocked)).not.toThrow();
    expect(() => writeSide("auto", blocked)).not.toThrow();
  });
});
