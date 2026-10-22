import type { Db } from "./db";
import type { Logger } from "./log";

export type AuditEvent = { type: string; [field: string]: unknown };

export class AuditLog {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  // Never rejects. A failed write goes to the log and the event is dropped, so no payment path fails on the audit table.
  async record(event: AuditEvent): Promise<void> {
    try {
      await this.db.query("INSERT INTO audit_events (type, payload) VALUES ($1, $2)", [event.type, JSON.stringify(event)]);
    } catch (e) {
      this.log.error("audit write failed", { type: event.type, error: String(e) });
    }
  }
}
