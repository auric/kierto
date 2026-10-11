import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { allowedOrigins, type GuardOptions, guard } from "./guard";
import { createInboxRoutes } from "./inbox/routes";
import type { Live } from "./live";
import { createMeta } from "./meta";
import { createOutbox, type Outbox } from "./publish/outbox";
import { createPublishRoutes } from "./publish/routes";
import { createReviewJobs, type ReviewJobs } from "./review/jobs";
import { createReviewRoutes } from "./review/routes";
import { createSettings, type Settings } from "./settings";
import { createSyncEngine, type SyncEngine } from "./sync/engine";

export const TOKEN_PLACEHOLDER = "__RL_SESSION__";

export type AppOptions = GuardOptions & {
  live: Live;
  // Absent: a default instance from REVIEW_LOOP_DATA_DIR and REVIEW_LOOP_SECRETS.
  settings?: Settings;
  // Absent: an engine that is not started. POST /api/sync then runs one cycle.
  sync?: SyncEngine;
  // Absent: jobs that run claude from PATH, with no start-up recovery. main.ts and serve.ts pass their own.
  review?: ReviewJobs;
  // Absent: an outbox that resumes on the first use of the database. main.ts and serve.ts pass their own and start it.
  outbox?: Outbox;
  // The built index.html. Absent in dev, where Vite serves the page.
  indexHtml?: string;
  // Middleware for the built assets. Absent in dev and in tests.
  assets?: Parameters<Hono["use"]>[1];
};

export function createApp(opts: AppOptions) {
  const page = opts.indexHtml?.replaceAll(TOKEN_PLACEHOLDER, opts.token);
  const settings = opts.settings ?? createSettings();
  const sync = opts.sync ?? createSyncEngine({ settings, live: opts.live });
  const review = opts.review ?? createReviewJobs({ settings, live: opts.live });
  const outbox = opts.outbox ?? createOutbox({ settings, live: opts.live });

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
    .get("/api/live", (c) => opts.live.handler(c))
    .route("/api/settings", settings.routes)
    .route("/api/meta", createMeta(review))
    .post("/api/sync", (c) => {
      void sync.syncNow();
      return c.json(sync.status(), 202);
    })
    .route("/api", createInboxRoutes({ settings, sync, live: opts.live }))
    .route("/api", createReviewRoutes({ review, live: opts.live }))
    .route("/api", createPublishRoutes({ review, settings, outbox }));

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
