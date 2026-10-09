import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { allowedOrigins, type GuardOptions, guard } from "./guard";
import type { Live } from "./live";

export const TOKEN_PLACEHOLDER = "__RL_SESSION__";

export type AppOptions = GuardOptions & {
  live: Live;
  // The built index.html. Absent in dev, where Vite serves the page.
  indexHtml?: string;
  // Middleware for the built assets. Absent in dev and in tests.
  assets?: Parameters<Hono["use"]>[1];
};

export function createApp(opts: AppOptions) {
  const page = opts.indexHtml?.replaceAll(TOKEN_PLACEHOLDER, opts.token);

  const app = new Hono()
    .use(guard(opts))
    .use(
      secureHeaders({
        contentSecurityPolicy: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      }),
    )
    .use(csrf({ origin: allowedOrigins(opts) }))
    .get("/api/live", (c) => opts.live.handler(c));

  if (opts.assets) app.use("/assets/*", opts.assets);
  if (page !== undefined) {
    app.get("*", (c, next) => {
      if (c.req.path.startsWith("/api/")) return next();
      c.header("Cache-Control", "no-store");
      return c.html(page);
    });
  }
  return app;
}

export type AppType = ReturnType<typeof createApp>;
