import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { foldCase, isMe } from "../../src/shared/me";

test("isMe matches the slug or the username, ignoring case", () => {
  const user = { slug: "jdoe", login: "J.Doe" };
  expect(isMe(user, "J.DOE")).toBe(true);
  expect(isMe(user, "JDOE")).toBe(true);
  expect(isMe({ slug: "jdoe", login: null }, "JDoe")).toBe(true);
  expect(isMe(user, "asmith")).toBe(false);
  expect(isMe(user, null)).toBe(false);
});

test("foldCase gives the same result as SQLite lower()", () => {
  const db = new Database(":memory:");
  for (const s of ["JDoe", "J.Doe@Example.TEST", "ÉMILE", "Straße", "İSTANBUL", "ΣΊΣΥΦΟΣ"])
    expect(foldCase(s)).toBe((db.query("SELECT lower($s) AS l").get({ $s: s }) as { l: string }).l);
  db.close();
});
