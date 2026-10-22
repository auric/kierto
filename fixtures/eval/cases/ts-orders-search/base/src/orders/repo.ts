import type { Db } from "../db";
import type { Order } from "./types";

export const ORDER_COLUMNS =
  "id, customer_name AS \"customerName\", status, total_cents AS \"totalCents\", created_at AS \"createdAt\"";

// page counts from 1.
export async function listOrders(db: Db, page: number, pageSize = 50): Promise<Order[]> {
  if (!Number.isInteger(page) || page < 1) throw new RangeError("page must be a positive integer");
  return db.query<Order>(`SELECT ${ORDER_COLUMNS} FROM orders ORDER BY id LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]);
}

export async function getOrder(db: Db, id: number): Promise<Order | null> {
  const rows = await db.query<Order>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [id]);
  return rows[0] ?? null;
}
