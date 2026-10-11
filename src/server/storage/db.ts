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
import m010_profiles from "./migrations/010_profiles.sql" with { type: "text" };
import m011_run_explain from "./migrations/011_run_explain.sql" with { type: "text" };
import m012_r2_runs from "./migrations/012_r2_runs.sql" with { type: "text" };
import m013_task_context from "./migrations/013_task_context.sql" with { type: "text" };

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
  m010_profiles,
  m011_run_explain,
  m012_r2_runs,
  m013_task_context,
];

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  // journal_mode cannot change inside a transaction.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  // A table rebuild drops a parent table. With foreign keys on, the drop deletes the child rows (ON DELETE CASCADE).
  // foreign_keys cannot change inside a transaction (SQLite lang_altertable.html, "Making other kinds of table schema changes").
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
    for (let v = user_version; v < MIGRATIONS.length; v++) {
      db.transaction(() => {
        db.exec(MIGRATIONS[v] as string);
        const broken = db.query("PRAGMA foreign_key_check").all();
        if (broken.length)
          throw new Error(`Migration ${v + 1} breaks ${broken.length} foreign keys: ${JSON.stringify(broken.slice(0, 3))}`);
        db.exec(`PRAGMA user_version = ${v + 1}`);
      })();
    }
  } catch (e) {
    db.close();
    throw e;
  }
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}
