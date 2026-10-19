// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { type AppOptions, createApp } from "./app";
import { BUILD_COMMIT } from "./build";
import { sweep } from "./context/attachments";
import { createLive } from "./live";
import { log } from "./log";
import { createOutbox } from "./publish/outbox";
import { runGitMcp } from "./review/git-mcp";
import { createReviewJobs } from "./review/jobs";
import { createSettings } from "./settings";
import { createSyncEngine } from "./sync/engine";

export const DEFAULT_PORT = 7317;
// scripts/compile.ts embeds dist/web with --asset. Bun puts an asset folder under import.meta.dir by its base name.
const WEB_DIR = BUILD_COMMIT === null ? resolve(import.meta.dir, "../../dist/web") : join(import.meta.dir, "web");

export function startServer(opts: Omit<AppOptions, "port"> & { port: number }) {
  let app = createApp(opts);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    // Bun closes a connection after idleTimeout seconds with no bytes, also mid-stream. The SSE heartbeat must stay below it.
    idleTimeout: 30,
    fetch: (req, srv) => app.fetch(req, srv),
  });
  // Port 0 picks a free port. The guard needs the real one.
  if (server.port !== opts.port) app = createApp({ ...opts, port: server.port ?? opts.port });
  return server;
}

// A compiled binary puts extra entries before --git-mcp in argv (U13), so the flag position varies.
const gitMcpAt = process.argv.indexOf("--git-mcp");
if (import.meta.main && gitMcpAt >= 0) {
  await runGitMcp(process.argv.slice(gitMcpAt + 1));
} else if (import.meta.main) {
  const port = Number(process.env.REVIEW_LOOP_PORT ?? DEFAULT_PORT);
  const devOrigin = process.env.REVIEW_LOOP_DEV_ORIGIN;
  const token = process.env.REVIEW_LOOP_SESSION ?? randomBytes(32).toString("hex");
  delete process.env.REVIEW_LOOP_SESSION;

  let indexHtml: string | undefined;
  if (!devOrigin) {
    const index = join(WEB_DIR, "index.html");
    if (!existsSync(index)) {
      console.error(`Missing ${index}. Run "bun run build" first.`);
      process.exit(1);
    }
    indexHtml = readFileSync(index, "utf8");
  }

  const live = createLive();
  const settings = createSettings();
  const sync = createSyncEngine({ settings, live });
  const review = createReviewJobs({ settings, live });
  const outbox = createOutbox({ settings, live });
  // Before the server starts, so no download runs.
  const db = settings.db();
  try {
    if (db) sweep(db, review.dataDir);
  } catch (e) {
    log(`Could not clean up the attachments folder: ${(e as Error).message}`);
  }
  try {
    const server = startServer({
      port,
      token,
      devOrigin,
      live,
      settings,
      sync,
      review,
      outbox,
      indexHtml,
      assets: indexHtml === undefined ? undefined : serveStatic({ root: WEB_DIR }),
    });
    console.log(`Revido (${BUILD_COMMIT ?? "source"}): http://127.0.0.1:${server.port}/`);
    sync.start();
    void review.start();
    outbox.start();
  } catch (err) {
    if ((err as { code?: string }).code === "EADDRINUSE") {
      console.error(`Port ${port} is busy. Stop the other process or set REVIEW_LOOP_PORT.`);
      process.exit(1);
    }
    throw err;
  }
}
