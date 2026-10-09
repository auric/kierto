import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/server/storage/db";

process.env.REVIEW_LOOP_SECRETS = "memory";
const dir = mkdtempSync(join(tmpdir(), "rl-db-"));
process.env.REVIEW_LOOP_DATA_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const schema = (path: string) => {
  const db = openDb(path);
  try {
    return {
      version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      journal: (db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode,
      fk: (db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys,
      busy: (db.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout,
      objects: db.query("SELECT type, name, sql FROM sqlite_master ORDER BY name").all() as { type: string; name: string; sql: string }[],
    };
  } finally {
    db.close();
  }
};

test("migration runs on an empty file and creates every M1 table", () => {
  const s = schema(join(dir, "empty.sqlite"));
  expect(s.version).toBe(2);
  expect(s.journal).toBe("wal");
  expect(s.fk).toBe(1);
  expect(s.busy).toBe(5000);
  const tables = s.objects.filter((o) => o.type === "table").map((o) => o.name);
  expect(tables).toEqual(expect.arrayContaining(["pull_request", "comment", "sync_checkpoint", "event"]));
  const indexes = s.objects.filter((o) => o.type === "index" && o.sql).map((o) => o.name);
  expect(indexes).toEqual(expect.arrayContaining(["comment_thread", "event_unclaimed"]));
});

test("a second run changes nothing", () => {
  const path = join(dir, "rerun.sqlite");
  const first = schema(path);
  const second = schema(path);
  expect(second).toEqual(first);
});

test("foreign keys and the event key hold", () => {
  const db = openDb(join(dir, "keys.sqlite"));
  try {
    expect(() => db.run("INSERT INTO event (pr, kind, ref, created_at) VALUES (99, 'comment_new', '1', 0)")).toThrow();
    db.run("INSERT INTO pull_request (project, repo, pr_id) VALUES ('P', 'r', 1)");
    db.run("INSERT INTO event (pr, kind, ref, created_at) VALUES (1, 'comment_new', '1', 0)");
    expect(() => db.run("INSERT INTO event (pr, kind, ref, created_at) VALUES (1, 'comment_new', '1', 1)")).toThrow();
  } finally {
    db.close();
  }
});
