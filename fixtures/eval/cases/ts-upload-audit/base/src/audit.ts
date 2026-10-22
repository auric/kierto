export type AuditEvent = {
  actor: string;
  action: string;
  target: string;
  at: Date;
  detail?: Record<string, unknown>;
};

// The security team reads this log. Every change to a member profile writes one event.
export interface AuditLog {
  record(event: AuditEvent): Promise<void>;
}
