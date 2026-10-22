import type { Db } from "../db";

export class OrderNotFound extends Error {
  constructor(readonly orderId: string) {
    super(`order ${orderId} not found`);
  }
}

// The worker treats this error as done: another worker owns the order, or the order is past capture.
export class OrderBusy extends Error {
  constructor(readonly orderId: string) {
    super(`order ${orderId} is not pending`);
  }
}

export type OrderStatus = "pending" | "capturing" | "paid" | "declined" | "failed";
export type Order = { id: string; customerId: string; status: OrderStatus; totalCents: number; currency: string; cardToken: string };

type Row = { id: string; customer_id: string; status: OrderStatus; total_cents: string; currency: string; card_token: string };

// pg returns BIGINT as a string. The check keeps totalCents an exact positive integer.
function toOrder(r: Row): Order {
  const totalCents = Number(r.total_cents);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error(`order ${r.id} has a bad total: ${r.total_cents}`);
  return { id: r.id, customerId: r.customer_id, status: r.status, totalCents, currency: r.currency, cardToken: r.card_token };
}

export class OrderRepo {
  constructor(private readonly db: Db) {}

  // Throws OrderNotFound for an unknown id. It never returns null.
  async get(id: string): Promise<Order> {
    const { rows } = await this.db.query<Row>(
      "SELECT id, customer_id, status, total_cents, currency, card_token FROM orders WHERE id = $1",
      [id],
    );
    const row = rows[0];
    if (!row) throw new OrderNotFound(id);
    return toOrder(row);
  }

  // One conditional UPDATE, so two workers cannot both move the same order. Throws OrderBusy when the order is not pending,
  // also when another worker moved it first.
  async markCapturing(id: string): Promise<void> {
    const { rowCount } = await this.db.query(
      "UPDATE orders SET status = 'capturing', updated_at = now() WHERE id = $1 AND status = 'pending'",
      [id],
    );
    if (rowCount !== 1) throw new OrderBusy(id);
  }

  // Puts a capturing order back to pending, so a later job can capture it.
  async release(id: string): Promise<void> {
    await this.db.query("UPDATE orders SET status = 'pending', updated_at = now() WHERE id = $1 AND status = 'capturing'", [id]);
  }

  async markPaid(id: string, chargeId: string): Promise<void> {
    await this.db.query("UPDATE orders SET status = 'paid', charge_id = $2, updated_at = now() WHERE id = $1", [id, chargeId]);
  }

  async markDeclined(id: string, code: string): Promise<void> {
    await this.db.query("UPDATE orders SET status = 'declined', decline_code = $2, updated_at = now() WHERE id = $1", [id, code]);
  }
}
