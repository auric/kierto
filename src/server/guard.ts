import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";

export type GuardOptions = { port: number; token: string; devOrigin?: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function allowedOrigins({ port, devOrigin }: GuardOptions): string[] {
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  return devOrigin ? [...origins, devOrigin] : origins;
}

// BRIEF 3.6: Host and Origin checks on every request, session token on every mutation.
export function guard(opts: GuardOptions) {
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const origins = new Set(allowedOrigins(opts));
  const expected = Buffer.from(opts.token);

  return createMiddleware(async (c, next) => {
    const host = c.req.header("host");
    const origin = c.req.header("origin");
    if (!host || !hosts.has(host)) return c.text("forbidden", 403);
    if (origin !== undefined && !origins.has(origin)) return c.text("forbidden", 403);
    // Page navigations stay allowed, so that a link from another site opens the app.
    if (c.req.path.startsWith("/api/") && c.req.header("sec-fetch-site") === "cross-site") return c.text("forbidden", 403);

    if (!SAFE_METHODS.has(c.req.method)) {
      if (origin === undefined) return c.text("forbidden", 403);
      const sent = c.req.header("x-rl-session");
      if (sent === undefined) return c.text("forbidden", 403);
      const got = Buffer.from(sent);
      // timingSafeEqual throws on a length mismatch.
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) return c.text("session_stale", 403);
    }
    await next();
  });
}
