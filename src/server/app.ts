// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { validator } from "hono/validator";
import { type ApiError, mcpServerId } from "../shared/dto";
import { createContextRoutes } from "./context/routes";
import { allowedOrigins, type GuardOptions, guard } from "./guard";
import { createInboxRoutes } from "./inbox/routes";
import type { Live } from "./live";
import { createMeta } from "./meta";
import { createOutbox, type Outbox } from "./publish/outbox";
import { createPublishRoutes } from "./publish/routes";
import { createConsultRoutes } from "./review/consult-routes";
import { createDiffRoutes } from "./review/diff-routes";
import { createFixRoutes } from "./review/fix-routes";
import { createReviewJobs, type ReviewJobs } from "./review/jobs";
import { createReviewRoutes } from "./review/routes";
import { discoverSkills, skillDto } from "./review/skills";
import { discoverMcpServers, listUserTools, McpListError, readServers } from "./review/user-mcp";
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
  // Absent: the OS file manager. serve.ts passes a recorder.
  openFolder?: (path: string) => Promise<boolean>;
};

export function createApp(opts: AppOptions) {
  const page = opts.indexHtml?.replaceAll(TOKEN_PLACEHOLDER, opts.token);
  const settings = opts.settings ?? createSettings();
  const sync = opts.sync ?? createSyncEngine({ settings, live: opts.live });
  const review = opts.review ?? createReviewJobs({ settings, live: opts.live });
  const outbox = opts.outbox ?? createOutbox({ settings, live: opts.live });

  const headers = secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  });

  const app = new Hono()
    .use(guard(opts))
    // A route with its own policy keeps it: the attachment files send "sandbox". secureHeaders sets its policy on every answer.
    .use(async (c, next) => {
      let own: string | null = null;
      await headers(c, async () => {
        await next();
        own = c.res.headers.get("Content-Security-Policy");
      });
      if (own) c.res.headers.set("Content-Security-Policy", own);
    })
    .use(csrf({ origin: allowedOrigins(opts) }))
    .get("/api/live", (c) => opts.live.handler(c))
    .route("/api/settings", settings.routes)
    .route("/api/meta", createMeta(review, settings))
    // The skills of the Claude Code config folder, read from disk on each call.
    .get("/api/skills", (c) => c.json(discoverSkills().map(skillDto)))
    // The MCP servers of the user's Claude config and of the enabled plugins: IDs and transports only.
    .get("/api/mcp-servers", (c) => c.json(discoverMcpServers()))
    // POST: the call can start a process from the user's config, so it needs the session token (BRIEF 3.6).
    .post(
      "/api/mcp-servers/:name/tools",
      validator("param", (v: Record<string, string>, c) => {
        const r = mcpServerId.safeParse(v.name);
        return r.success ? { name: r.data } : c.json<ApiError>({ error: "Invalid MCP server name." }, 400);
      }),
      async (c) => {
        const { name } = c.req.valid("param");
        const entry = readServers().get(name)?.entry;
        if (!entry) return c.json<ApiError>({ error: `MCP server ${name} is not in the Claude config.` }, 404);
        try {
          return c.json(await listUserTools(entry), 200);
        } catch (e) {
          const why = e instanceof McpListError ? e.message : "error";
          return c.json<ApiError>({ error: `Could not list the tools of ${name}: ${why}.` }, 502);
        }
      },
    )
    .post("/api/sync", (c) => {
      void sync.syncNow();
      return c.json(sync.status(), 202);
    })
    .route("/api", createInboxRoutes({ settings, sync, live: opts.live }))
    .route("/api", createReviewRoutes({ review, live: opts.live }))
    .route("/api", createDiffRoutes({ review }))
    .route("/api", createConsultRoutes({ review, settings, live: opts.live }))
    .route("/api", createFixRoutes({ review, settings, live: opts.live, openFolder: opts.openFolder }))
    .route("/api", createContextRoutes({ settings, review, live: opts.live, openFolder: opts.openFolder }))
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
