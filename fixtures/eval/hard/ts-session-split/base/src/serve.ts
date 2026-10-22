import type { Handler, Request } from "./http/server";

// Routes "METHOD /path" to a handler. Bodies are JSON.
export function serve(port: number, routes: Record<string, Handler>) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(raw, server) {
      const url = new URL(raw.url);
      const handler = routes[`${raw.method} ${url.pathname}`];
      if (!handler) return new Response("not found", { status: 404 });
      const req: Request = {
        method: raw.method,
        path: url.pathname,
        headers: Object.fromEntries(raw.headers),
        ip: server.requestIP(raw)?.address ?? "",
        body: raw.method === "GET" ? null : await raw.json().catch(() => null),
      };
      const res = await handler(req);
      return Response.json(res.body ?? null, { status: res.status, headers: res.headers });
    },
  });
}
