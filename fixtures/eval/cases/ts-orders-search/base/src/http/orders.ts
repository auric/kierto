import type { Db } from "../db";
import { getOrder, listOrders } from "../orders/repo";

export type Request = { query: Record<string, string | undefined>; params: Record<string, string> };
export type Response = { status: number; body: unknown };

export function orderRoutes(db: Db) {
  return {
    // GET /orders?page=2
    async list(req: Request): Promise<Response> {
      const page = Number(req.query.page ?? "1");
      if (!Number.isInteger(page) || page < 1) return { status: 400, body: { error: "page must be a positive integer" } };
      return { status: 200, body: await listOrders(db, page) };
    },

    // GET /orders/:id
    async get(req: Request): Promise<Response> {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return { status: 400, body: { error: "invalid id" } };
      const order = await getOrder(db, id);
      return order ? { status: 200, body: order } : { status: 404, body: { error: "not found" } };
    },
  };
}
