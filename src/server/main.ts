import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { type AppOptions, createApp } from "./app";
import { createLive } from "./live";
import { createSettings } from "./settings";
import { createSyncEngine } from "./sync/engine";

export const DEFAULT_PORT = 7317;
const WEB_DIR = resolve(import.meta.dir, "../../dist/web");

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

if (import.meta.main) {
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
  try {
    const server = startServer({
      port,
      token,
      devOrigin,
      live,
      settings,
      sync,
      indexHtml,
      assets: indexHtml === undefined ? undefined : serveStatic({ root: WEB_DIR }),
    });
    console.log(`Review Loop: http://127.0.0.1:${server.port}/`);
    sync.start();
  } catch (err) {
    if ((err as { code?: string }).code === "EADDRINUSE") {
      console.error(`Port ${port} is busy. Stop the other process or set REVIEW_LOOP_PORT.`);
      process.exit(1);
    }
    throw err;
  }
}
