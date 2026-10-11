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
  expect(s.version).toBe(13);
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
      "task_context",
    ]),
  );
  const indexes = s.objects.filter((o) => o.type === "index" && o.sql).map((o) => o.name);
  expect(indexes).toEqual(expect.arrayContaining(["comment_thread", "event_unclaimed"]));
  expect(s.objects.find((o) => o.name === "pull_request")?.sql).toContain("seen_at INTEGER");
  // 006_forge.sql runs last (db.ts list order).
  expect(s.objects.find((o) => o.name === "pull_request")?.sql).toContain("meta_head TEXT");
  expect(s.objects.find((o) => o.name === "comment")?.sql).toContain("excerpt_json TEXT");
  expect(s.objects.find((o) => o.name === "review_run")?.sql).toContain("profile_revision TEXT");
  expect(s.objects.find((o) => o.name === "review_run")?.sql).toContain("answer TEXT");
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

const R2_COLUMNS = { since_head: null, range_base: null, question: null, answer: null };

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
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(13);
    expect(db.query("SELECT * FROM review_run ORDER BY id").all()).toEqual(
      before.map((r) => ({ ...r, profile_name: null, profile_revision: null, explain: null, ...R2_COLUMNS })),
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

// ---------- Release 2: the review_run rebuild (012_r2_runs.sql) ----------

const V11 = [...V9, "010_profiles.sql", "011_run_explain.sql"];
const CHILDREN = ["run_event", "review_item", "post"];

// A version-11 database. foreign_keys is off unless the caller turns it on.
function v11(path: string) {
  const db = new Database(path, { create: true, strict: true });
  for (const f of V11) db.exec(readFileSync(join(import.meta.dir, "../../src/server/storage/migrations", f), "utf8"));
  db.exec("PRAGMA user_version = 11");
  return db;
}

const dump = (db: Database) =>
  Object.fromEntries(["review_run", ...CHILDREN].map((t) => [t, db.query(`SELECT * FROM ${t} ORDER BY 1, 2`).all()]));
const columns = (db: Database, t: string) => (db.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

test("migration from a version-11 database keeps every run, event, item, and post", () => {
  const path = join(dir, "v11.sqlite");
  const old = v11(path);
  old.exec("PRAGMA foreign_keys = ON");
  old.exec(`INSERT INTO pull_request (id, project, repo, pr_id) VALUES (1, 'P', 'r', 1), (2, 'P', 'r', 2);
    INSERT INTO review_run (id, pr, kind, profile, note, idem_key, source_head, target_head, status, started_at, profile_name, profile_revision, explain)
      VALUES (4, 1, 'review', 'general', 'n', 'k1', 'a', 'b', 'completed', 1, 'General', 'rev', 0),
             (7, 1, 'reply', 'explain', '', 'k2', 'a', 'b', 'running', 2, NULL, NULL, NULL),
             (9, 2, 'review', 'general', '', 'k3', 'a', 'b', 'failed', 3, NULL, NULL, 1);
    INSERT INTO run_event (run, id, seq, tool, target, status, started_at)
      VALUES (4, 't1', 1, 'Read', 'a.ts', 'ok', 1), (4, 't2', 2, 'Agent', 'x', 'ok', 1), (7, 't3', 1, 'Grep', 'y', 'running', 2);
    INSERT INTO review_item (id, run, kind, payload_json, body, status, thread)
      VALUES (11, 4, 'finding', '{}', 'f', 'accepted', NULL), (12, 7, 'reply', '{}', 'r', 'new', 100), (13, 9, 'question', '{}', 'q', 'posted', NULL);
    INSERT INTO post (id, pr, run, kind, idem_key, body, destination_json, items_json, state, created_at, updated_at)
      VALUES (21, 1, 4, 'inline', 'run:1:4:11@0', 'f', '{}', '[]', 'confirmed', 1, 1), (22, 1, NULL, 'reply', 'reply:1:x', 'r', '{}', '[]', 'pending', 1, 1);`);
  const before = dump(old);
  const oldColumns = columns(old, "review_run");
  old.close();

  const db = openDb(path);
  try {
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(13);
    expect((db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(columns(db, "review_run")).toEqual([...oldColumns, "since_head", "range_base", "question", "answer"]);
    const after = dump(db);
    expect(after.review_run).toEqual((before.review_run as Record<string, unknown>[]).map((r) => ({ ...r, ...R2_COLUMNS })));
    for (const t of CHILDREN) expect(after[t]).toEqual(before[t] as unknown[]);
    for (const t of CHILDREN)
      expect((db.query(`PRAGMA foreign_key_list(${t})`).all() as { table: string }[]).map((k) => k.table)).toContain("review_run");

    const insert = (id: number, kind: string, key: string) =>
      db.run(
        `INSERT INTO review_run (id, pr, kind, profile, note, idem_key, source_head, target_head, status, started_at, question)
        VALUES (${id}, 2, '${kind}', 'general', '', '${key}', 'a', 'b', 'running', 5, 'Why?')`,
      );
    insert(30, "ask", "k4");
    expect(() => insert(31, "bogus", "k5")).toThrow(/CHECK/);
    // review_run_running: one running run per key.
    expect(() => insert(32, "ask", "k4")).toThrow(/UNIQUE/);
    expect(db.query("SELECT name FROM sqlite_master WHERE tbl_name = 'review_run' AND type = 'index' ORDER BY name").all()).toEqual([
      { name: "review_run_pr" },
      { name: "review_run_running" },
    ]);
    // The children still cascade from the rebuilt table.
    db.run("DELETE FROM review_run WHERE id = 4");
    expect(db.query("SELECT COUNT(*) AS n FROM run_event WHERE run = 4").get()).toEqual({ n: 0 });
    expect(db.query("SELECT id FROM review_item ORDER BY id").all()).toEqual([{ id: 12 }, { id: 13 }]);
    expect(db.query("SELECT id FROM post ORDER BY id").all()).toEqual([{ id: 22 }]);
  } finally {
    db.close();
  }

  const rows = () => {
    const d = new Database(path, { readonly: true });
    try {
      return dump(d);
    } finally {
      d.close();
    }
  };
  const first = { ...schema(path), rows: rows() };
  const second = { ...schema(path), rows: rows() };
  expect(second).toEqual(first);
});

test("an orphan row in a table that no migration touches does not block the upgrade", () => {
  const path = join(dir, "orphan.sqlite");
  const old = v11(path);
  old.exec("INSERT INTO pr_task (pr, key, source, url, ord) VALUES (99, 'ABC-1', 'branch', NULL, 0)");
  old.close();

  const db = openDb(path);
  try {
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(13);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([
      { table: "pr_task", rowid: expect.anything(), parent: "pull_request", fkid: 0 },
    ]);
  } finally {
    db.close();
  }
});

test("a migration that leaves a broken foreign key rolls back and throws", () => {
  const path = join(dir, "broken.sqlite");
  const old = v11(path);
  old.exec("INSERT INTO run_event (run, id, seq, tool, target, status, started_at) VALUES (99, 't1', 1, 'Read', 'a.ts', 'ok', 1)");
  old.close();

  expect(() => openDb(path)).toThrow(/foreign key/);
  const db = new Database(path, { readonly: true });
  try {
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(11);
    expect(columns(db, "review_run")).not.toContain("since_head");
    expect(db.query("SELECT run, id FROM run_event").all()).toEqual([{ run: 99, id: "t1" }]);
  } finally {
    db.close();
  }
});
