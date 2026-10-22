export type Request = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  // The raw body. Read it with readRawBody().
  body: AsyncIterable<Uint8Array>;
};

export type Response = { status: number; body?: unknown };

export type Handler = (req: Request) => Promise<Response>;

export const json = (status: number, body: unknown): Response => ({ status, body });

// Dispatches "METHOD /path" to its handler.
export function router(routes: Record<string, Handler>): Handler {
  return async (req) => {
    const h = routes[`${req.method} ${req.path}`];
    return h ? h(req) : json(404, { error: "not found" });
  };
}
