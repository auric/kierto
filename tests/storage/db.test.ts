import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  expect(s.version).toBe(10);
  expect(s.journal).toBe("wal");
  expect(s.fk).toBe(1);
  expect(s.busy).toBe(5000);
  const tables = s.objects.filter((o) => o.type === "table").map((o) => o.name);
  expect(tables).toEqual(
    expect.arrayContaining([
      "pull_request",
      "comment",
      "sync_checkpoint",
      "event",
      "pr_brief",
      "review_run",
      "run_event",
      "review_item",
      "post",
      "pr_commit",
      "pr_change",
    ]),
  );
  const indexes = s.objects.filter((o) => o.type === "index" && o.sql).map((o) => o.name);
  expect(indexes).toEqual(expect.arrayContaining(["comment_thread", "event_unclaimed"]));
  expect(s.objects.find((o) => o.name === "pull_request")?.sql).toContain("seen_at INTEGER");
  // 006_forge.sql runs last (db.ts list order).
  expect(s.objects.find((o) => o.name === "pull_request")?.sql).toContain("meta_head TEXT");
  expect(s.objects.find((o) => o.name === "comment")?.sql).toContain("excerpt_json TEXT");
  expect(s.objects.find((o) => o.name === "review_run")?.sql).toContain("profile_revision TEXT");
});

// The db.ts list order up to version 9.
const V9 = [
  "001_m1.sql",
  "002_reviewers.sql",
  "003_author_login.sql",
  "004_v3.sql",
  "005_tasks.sql",
  "007_review.sql",
  "008_post.sql",
  "009_reply.sql",
  "006_forge.sql",
];

test("migration from a version-9 database keeps every run", () => {
  const path = join(dir, "v9.sqlite");
  const old = new Database(path, { create: true, strict: true });
  for (const f of V9) old.exec(readFileSync(join(import.meta.dir, "../../src/server/storage/migrations", f), "utf8"));
  old.exec("PRAGMA user_version = 9");
  old.exec(`INSERT INTO pull_request (id, project, repo, pr_id) VALUES (1, 'P', 'r', 1);
    INSERT INTO review_run (id, pr, kind, profile, note, idem_key, source_head, target_head, status, started_at)
      VALUES (4, 1, 'review', 'general', 'n', 'k1', 'a', 'b', 'completed', 1),
             (7, 1, 'reply', 'explain', '', 'k2', 'a', 'b', 'failed', 2);`);
  const before = old.query("SELECT * FROM review_run ORDER BY id").all() as Record<string, unknown>[];
  old.close();

  const db = openDb(path);
  try {
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(10);
    expect(db.query("SELECT * FROM review_run ORDER BY id").all()).toEqual(
      before.map((r) => ({ ...r, profile_name: null, profile_revision: null })),
    );
  } finally {
    db.close();
  }
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
