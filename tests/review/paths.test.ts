// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { inside } from "../../src/server/review/paths";

const WITH = { withRoot: true };
const WITHOUT = { withRoot: false };
const win = process.platform === "win32";

describe("inside", () => {
  const root = resolve("a");

  test("the root itself counts only with withRoot", () => {
    expect(inside(root, root, WITH)).toBe(true);
    expect(inside(root, root, WITHOUT)).toBe(false);
    expect(inside(root, join(root, "."), WITHOUT)).toBe(false);
  });

  test("a path below the root is inside for both options", () => {
    for (const o of [WITH, WITHOUT]) {
      expect(inside(root, join(root, "b"), o)).toBe(true);
      expect(inside(root, join(root, "b", "c"), o)).toBe(true);
      // A name that starts with two dots is not a parent step.
      expect(inside(root, join(root, "..b"), o)).toBe(true);
    }
  });

  test("a parent step escapes", () => {
    for (const o of [WITH, WITHOUT]) {
      expect(inside(root, resolve(root, ".."), o)).toBe(false);
      expect(inside(root, join(root, "..", "x"), o)).toBe(false);
      expect(inside(root, join(root, "b", "..", "..", "x"), o)).toBe(false);
    }
  });

  test("a sibling with the root as a name prefix is outside", () => {
    for (const o of [WITH, WITHOUT]) {
      expect(inside(root, resolve("ab"), o)).toBe(false);
      expect(inside(root, join(resolve("ab"), "c"), o)).toBe(false);
    }
  });

  test.skipIf(!win)("Windows: drive letter and name case do not matter", () => {
    expect(inside("C:\\A\\Root", "c:\\a\\root\\x", WITHOUT)).toBe(true);
    expect(inside("C:\\A\\Root", "c:\\a\\ROOT", WITH)).toBe(true);
    expect(inside("C:\\A\\Root", "c:\\a\\ROOT", WITHOUT)).toBe(false);
    expect(inside("C:\\a", "C:\\ab", WITH)).toBe(false);
    expect(inside("C:\\a", "C:\\A", WITH)).toBe(true);
  });

  test.skipIf(!win)("Windows: another drive or a UNC path is outside", () => {
    for (const o of [WITH, WITHOUT]) {
      expect(inside("C:\\a", "D:\\a\\x", o)).toBe(false);
      expect(inside("C:\\a", "\\\\server\\share\\a", o)).toBe(false);
    }
  });

  test.skipIf(win)("POSIX: name case matters", () => {
    expect(inside("/a/Root", "/a/root/x", WITH)).toBe(false);
    expect(inside("/a/Root", "/a/Root/x", WITH)).toBe(true);
  });
});
