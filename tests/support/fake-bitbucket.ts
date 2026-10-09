// Fake Bitbucket Server for tests. It listens on 127.0.0.1 only and replays fixture payloads.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TLS_DIR = join(import.meta.dir, "../../fixtures/tls");
export const TEST_CA_FILE = join(TLS_DIR, "ca.pem");
export const FAKE_TOKEN = "fake-token-0123456789abcdef";
export const FAKE_USER = "jdoe";

export type Reply =
  | { status: number; body?: unknown; headers?: Record<string, string>; delayMs?: number }
  // Holds the request until release() or stop().
  | { hang: true }
  // Sends the status line, then resets the connection mid-body.
  | { drop: true };

export type Route = Reply | ((req: Request) => Reply | Promise<Reply>);

// port: absent picks a free port.
export type FakeOptions = { routes?: Record<string, Route>; https?: boolean; port?: number };

// A route key is "METHOD /path" or "METHOD /path start=N". The start form wins.
export const key = (method: string, path: string, start?: number) => `${method} ${path}${start === undefined ? "" : ` start=${start}`}`;

export function startFakeBitbucket(opts: FakeOptions = {}) {
  const routes: Record<string, Route> = { ...opts.routes };
  const requests: string[] = [];
  let release: () => void = () => {};
  let released = new Promise<void>((r) => {
    release = r;
  });
  const state = {
    routes,
    requests,
    token: FAKE_TOKEN,
    // null omits the X-AUSERNAME header.
    user: FAKE_USER as string | null,
    inFlight: 0,
    maxInFlight: 0,
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    tls: opts.https
      ? { cert: readFileSync(join(TLS_DIR, "server.pem"), "utf8"), key: readFileSync(join(TLS_DIR, "server.key"), "utf8") }
      : undefined,
    async fetch(req) {
      const url = new URL(req.url);
      const start = url.searchParams.get("start");
      const base = key(req.method, url.pathname);
      requests.push(`${base}${url.search}`);
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        if (req.headers.get("authorization") !== `Bearer ${state.token}`) {
          return Response.json({ errors: [{ message: "Authentication failed." }] }, { status: 401 });
        }
        const route = (start !== null ? routes[`${base} start=${start}`] : undefined) ?? routes[base];
        const reply: Reply =
          typeof route === "function" ? await route(req) : (route ?? { status: 404, body: { errors: [{ message: "Not found." }] } });
        if ("hang" in reply) {
          await released;
          return new Response(null, { status: 503 });
        }
        const headers = new Headers(state.user === null ? {} : { "X-AUSERNAME": state.user });
        if ("drop" in reply) {
          const body = new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("{"));
              // Bun.serve logs an Error value. An undefined reason resets the connection silently.
              c.error(undefined);
            },
          });
          return new Response(body, { status: 200, headers });
        }
        if (reply.delayMs) await Bun.sleep(reply.delayMs);
        for (const [k, v] of Object.entries(reply.headers ?? {})) headers.set(k, v);
        if (reply.body === undefined) return new Response(null, { status: reply.status, headers });
        headers.set("Content-Type", "application/json");
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers });
      } finally {
        state.inFlight--;
      }
    },
  });

  return Object.assign(state, {
    url: `${opts.https ? "https" : "http"}://127.0.0.1:${server.port}`,
    release() {
      release();
      released = new Promise<void>((r) => {
        release = r;
      });
    },
    stop() {
      release();
      server.stop(true);
    },
  });
}

export type FakeBitbucket = ReturnType<typeof startFakeBitbucket>;

// Reads a recorded fixture: { status, body }.
export function fixture<T = unknown>(name: string): { status: number; body: T } {
  return JSON.parse(readFileSync(join(import.meta.dir, "../../fixtures/bitbucket", name), "utf8"));
}
