import type { Db } from "../db";
import { listOrders } from "../orders/repo";
import type { OrderStatus } from "../orders/types";

export type DailyTotals = { orders: number; revenueCents: number; byStatus: Partial<Record<OrderStatus, number>> };

const BATCH = 200;

// Walks every order once. The nightly job sends the totals to the finance mailbox.
export async function dailyTotals(db: Db, day: string): Promise<DailyTotals> {
  const totals: DailyTotals = { orders: 0, revenueCents: 0, byStatus: {} };
  for (let page = 1; ; page++) {
    const rows = await listOrders(db, page, BATCH);
    if (rows.length === 0) break;
    for (const o of rows) {
      if (!o.createdAt.startsWith(day)) continue;
      totals.orders++;
      if (o.status === "paid" || o.status === "shipped") totals.revenueCents += o.totalCents;
      totals.byStatus[o.status] = (totals.byStatus[o.status] ?? 0) + 1;
    }
    if (rows.length < BATCH) break;
  }
  return totals;
}
