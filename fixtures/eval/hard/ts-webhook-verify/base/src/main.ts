import { loadConfig } from "./config";
import { connect } from "./db";
import { EventStore } from "./events/store";
import { withErrors } from "./http/errors";
import { router } from "./http/server";
import { carrierWebhook } from "./webhooks/carrier";

const config = loadConfig();
const events = new EventStore(connect(config.databaseUrl));

const app = withErrors(
  router({
    "POST /hooks/carrier": carrierWebhook(config.carrierToken, events),
  }),
  (m) => console.error(m),
);

Bun.serve({
  port: config.port,
  async fetch(raw) {
    const url = new URL(raw.url);
    const res = await app({
      method: raw.method,
      path: url.pathname,
      headers: Object.fromEntries(raw.headers),
      body: raw.body ?? (async function* () {})(),
    });
    return Response.json(res.body ?? null, { status: res.status });
  },
});
