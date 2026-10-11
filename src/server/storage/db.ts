import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Index i holds the SQL that raises user_version from i to i + 1.
// ponytail: read from disk; `bun build --compile` (M4) must embed these files.
// The list order, not the file number, sets the version. 006_forge.sql (WP4) came last, so it runs after 009_reply.sql.
const MIGRATIONS = [
  "001_m1.sql",
  "002_reviewers.sql",
  "003_author_login.sql",
  "004_v3.sql",
  "005_tasks.sql",
  "007_review.sql",
  "008_post.sql",
  "009_reply.sql",
  "006_forge.sql",
].map((f) => readFileSync(join(import.meta.dir, "migrations", f), "utf8"));

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  // journal_mode cannot change inside a transaction.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v] as string);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
  return db;
}
