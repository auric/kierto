import { afterAll, expect, test } from "bun:test";
import { createLive } from "../../src/server/live";
import { startServer } from "../../src/server/main";

const TOKEN = "c".repeat(64);
const live = createLive(20);
const server = startServer({ port: 0, token: TOKEN, live });
const base = `http://127.0.0.1:${server.port}`;

afterAll(() => server.stop(true));

async function waitFor(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timeout");
    await Bun.sleep(10);
  }
}

test("started server reports hostname 127.0.0.1", () => {
  expect(server.hostname).toBe("127.0.0.1");
});

test("SSE client gets a broadcast and a heartbeat, and abort removes it", async () => {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5000);
  const res = await fetch(`${base}/api/live`, { signal: abort.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  await waitFor(() => live.size() === 1);

  live.broadcast("changed", { pr: 1 });
  if (!res.body) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  // The first ping comes at connect. A second ping proves the periodic heartbeat.
  while (!(text.includes("event: changed") && text.split(": ping").length > 2)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  expect(text).toContain('event: changed\ndata: {"pr":1}');
  expect(text).toContain(": ping");

  abort.abort();
  clearTimeout(timeout);
  await waitFor(() => live.size() === 0);
});
