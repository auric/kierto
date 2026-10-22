import type { Db } from "../db";
import type { Logger } from "../log";
import { OrderBusy } from "../orders/repo";

export type Job = { id: number; type: string; payload: Record<string, unknown>; attempt: number };
export type Handlers = Record<string, (job: Job) => Promise<void>>;

// A failed job runs again after 30 s, 60 s, 120 s, ... up to this many runs.
export const MAX_JOB_ATTEMPTS = 6;

// Takes the oldest queued job. SKIP LOCKED lets several worker processes poll the same table.
async function take(db: Db): Promise<Job | null> {
  const { rows } = await db.query<Job>(
    `UPDATE jobs SET state = 'running', attempt = attempt + 1
     WHERE id = (SELECT id FROM jobs WHERE state = 'queued' AND run_after <= now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id, type, payload, attempt`,
  );
  return rows[0] ?? null;
}

export async function runOnce(db: Db, handlers: Handlers, log: Logger): Promise<boolean> {
  const job = await take(db);
  if (!job) return false;
  const handler = handlers[job.type];
  if (!handler) {
    log.error("no handler for job", { id: job.id, type: job.type });
    await db.query("UPDATE jobs SET state = 'dead' WHERE id = $1", [job.id]);
    return true;
  }
  try {
    await handler(job);
    await db.query("UPDATE jobs SET state = 'done' WHERE id = $1", [job.id]);
  } catch (e) {
    if (e instanceof OrderBusy) {
      await db.query("UPDATE jobs SET state = 'done' WHERE id = $1", [job.id]);
      return true;
    }
    const dead = job.attempt >= MAX_JOB_ATTEMPTS;
    log.warn("job failed", { id: job.id, type: job.type, attempt: job.attempt, dead, error: String(e) });
    await db.query(
      `UPDATE jobs SET state = $2, run_after = now() + make_interval(secs => 30 * 2 ^ ($3 - 1)) WHERE id = $1`,
      [job.id, dead ? "dead" : "queued", job.attempt],
    );
  }
  return true;
}
