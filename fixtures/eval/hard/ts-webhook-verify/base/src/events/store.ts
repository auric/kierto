import type { Db } from "../db";

export class EventStore {
  constructor(private readonly db: Db) {}

  async has(provider: string, eventId: string): Promise<boolean> {
    const { rows } = await this.db.query("SELECT 1 FROM webhook_events WHERE provider = $1 AND event_id = $2", [provider, eventId]);
    return rows.length > 0;
  }

  // Inserts the event and its processing job in one statement. A second add() of the same provider and event ID inserts
  // nothing, also when two deliveries race, so a duplicate never queues a second job. Returns true when this call inserted.
  async add(provider: string, eventId: string, type: string, payload: unknown): Promise<boolean> {
    const { rows } = await this.db.query(
      `WITH ins AS (
         INSERT INTO webhook_events (provider, event_id, type, payload) VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id
       )
       INSERT INTO jobs (type, payload) SELECT 'webhook-event', jsonb_build_object('eventRowId', id) FROM ins RETURNING id`,
      [provider, eventId, type, JSON.stringify(payload)],
    );
    return rows.length === 1;
  }
}
