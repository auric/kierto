import { Database } from "bun:sqlite";
import m001_m1 from "./migrations/001_m1.sql" with { type: "text" };
import m002_reviewers from "./migrations/002_reviewers.sql" with { type: "text" };
import m003_author_login from "./migrations/003_author_login.sql" with { type: "text" };
import m004_v3 from "./migrations/004_v3.sql" with { type: "text" };
import m005_tasks from "./migrations/005_tasks.sql" with { type: "text" };
import m006_forge from "./migrations/006_forge.sql" with { type: "text" };
import m007_review from "./migrations/007_review.sql" with { type: "text" };
import m008_post from "./migrations/008_post.sql" with { type: "text" };
import m009_reply from "./migrations/009_reply.sql" with { type: "text" };

// Index i holds the SQL that raises user_version from i to i + 1. The list order, not the file number, sets the version.
const MIGRATIONS = [
  m001_m1,
  m002_reviewers,
  m003_author_login,
  m004_v3,
  m005_tasks,
  m007_review,
  m008_post,
  m009_reply,
  m006_forge, // 006_forge.sql (WP4) came last, so it runs after 009_reply.sql.
];

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
