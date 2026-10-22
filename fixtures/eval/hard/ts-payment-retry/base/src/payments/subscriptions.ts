import type { AuditLog } from "../audit";
import type { Db } from "../db";
import type { Gateway } from "./gateway";

type Sub = { id: string; price_cents: string; currency: string; card_token: string; period: number; state: string };

// Charges the next period of an active subscription. The key names the subscription and the period, so a second job for
// the same period gets the first charge back from the gateway.
export async function renewSubscription(db: Db, gateway: Gateway, audit: AuditLog, id: string): Promise<void> {
  const { rows } = await db.query<Sub>("SELECT id, price_cents, currency, card_token, period, state FROM subscriptions WHERE id = $1", [id]);
  const sub = rows[0];
  if (!sub || sub.state !== "active") return;
  const next = sub.period + 1;
  const result = await gateway.charge({
    amountCents: Number(sub.price_cents),
    currency: sub.currency,
    cardToken: sub.card_token,
    reference: `sub-${sub.id}-${next}`,
    idempotencyKey: `renew-${sub.id}-${next}`,
  });
  if (result.status === "declined") {
    await db.query("UPDATE subscriptions SET state = 'past_due' WHERE id = $1", [sub.id]);
    await audit.record({ type: "subscription.past_due", subscriptionId: sub.id, code: result.declineCode });
    return;
  }
  await db.query("UPDATE subscriptions SET period = $2 WHERE id = $1 AND period = $3", [sub.id, next, sub.period]);
  await audit.record({ type: "subscription.renewed", subscriptionId: sub.id, period: next, chargeId: result.chargeId });
}
