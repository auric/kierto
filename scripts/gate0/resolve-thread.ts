// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Gate for U62 to U66 (integration-check.md, "Thread resolve"): resolve and reopen one comment thread with the REST PUT.
// It WRITES to the server. Run it only on your test PR, on a thread that you started and that is open.
// Usage: bun scripts/gate0/resolve-thread.ts --pr <PR URL> --thread <root comment ID> [--forbidden <root comment ID>] [--out <dir>]
//        bun scripts/gate0/resolve-thread.ts --dry-run
// --forbidden: a thread on the same PR that you may not change. The script sends one PUT there and records the status.
// --dry-run: the same steps against a loopback fake server. It reads no secret, and nothing leaves the machine.
// Console output and .gate0/resolve/result.json hold only status codes, versions, booleans, key names, and enum-like strings.
// Never names, hosts, paths, or comment text. A text change shows only as "text unchanged=false".
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsePrUrl } from "../../src/shared/pr-url";
import type { PrRef } from "../../src/shared/types";

const SERVICE = "review-loop";
const ROOT = resolve(import.meta.dir, "../..");
const TIMEOUT_MS = 30_000;
const ACTIVITY_PAGES = 4;

const argv = process.argv.slice(2);
const opt = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
function usage(): never {
  console.error(
    "usage: bun scripts/gate0/resolve-thread.ts --pr <PR URL> --thread <root comment ID> [--forbidden <root comment ID>] [--out <dir>]\n       bun scripts/gate0/resolve-thread.ts --dry-run",
  );
  process.exit(2);
}

// ---------- sanitized shapes ----------
// Strings other than enum values can hold names, paths, or text. Objects keep their keys. Arrays keep their length and first item.
type Shape = string | number | boolean | null | Shape[] | { [k: string]: Shape };
function shape(v: unknown, depth = 0): Shape {
  if (v === null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return /^[A-Z][A-Z0-9_]*$/.test(v) ? v : "<string>";
  if (depth > 3) return "<deep>";
  if (Array.isArray(v)) return v.length ? [`<length ${v.length}>`, shape(v[0], depth + 1)] : [];
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, shape(x, depth + 1)]));
  return `<${typeof v}>`;
}
// A Java exception class name is enum-like enough to keep. Error messages are not kept.
const exceptionNames = (body: unknown): string[] =>
  ((body as { errors?: { exceptionName?: unknown }[] } | null)?.errors ?? [])
    .map((e) => e.exceptionName)
    .filter((n): n is string => typeof n === "string" && /^[A-Za-z0-9_.$]+$/.test(n));
const hash = (s: unknown) => (typeof s === "string" ? createHash("sha256").update(s).digest("hex") : null);

type Call = { status: number; body: unknown };
type Comment = { version?: unknown; text?: unknown; threadResolved?: unknown; threadResolver?: unknown; threadResolvedDate?: unknown };

// ---------- steps ----------
// base: the server origin. token: sent only to base. The PR path comes from parsePrUrl, so it names the stored host only.
async function gate(base: string, token: string, pr: PrRef, thread: number, forbidden: number | null) {
  const prPath = `/rest/api/1.0/projects/${encodeURIComponent(pr.project)}/repos/${encodeURIComponent(pr.repo)}/pull-requests/${pr.id}`;
  const commentPath = (id: number) => `${prPath}/comments/${id}`;
  // Requests run one at a time. That stays under the limit of 2 concurrent requests.
  async function call(method: "GET" | "PUT", path: string, body?: unknown): Promise<Call> {
    try {
      const res = await fetch(base + path, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      return { status: res.status, body: json };
    } catch (e) {
      return { status: 0, body: { network: (e as Error).name } };
    }
  }
  const read = async (id: number) => {
    const r = await call("GET", commentPath(id));
    const c = (r.body ?? {}) as Comment;
    return { status: r.status, version: typeof c.version === "number" ? c.version : null, resolved: c.threadResolved, c };
  };
  const put = (id: number, version: unknown, resolved: boolean) => call("PUT", commentPath(id), { version, threadResolved: resolved });
  const activityIds = async () => {
    const ids = new Map<number, { action: Shape; commentAction: Shape; comment: number | null }>();
    let start = 0;
    for (let i = 0; i < ACTIVITY_PAGES; i++) {
      const r = await call("GET", `${prPath}/activities?limit=50&start=${start}`);
      if (r.status !== 200) break;
      const page = r.body as { values?: { id: number; action?: unknown; commentAction?: unknown; comment?: { id?: unknown } }[]; isLastPage?: boolean; nextPageStart?: number };
      for (const a of page.values ?? [])
        ids.set(a.id, { action: shape(a.action), commentAction: shape(a.commentAction), comment: typeof a.comment?.id === "number" ? a.comment.id : null });
      if (page.isLastPage !== false || typeof page.nextPageStart !== "number") break;
      start = page.nextPageStart;
    }
    return ids;
  };

  const out: Record<string, unknown> = {};
  const before = await read(thread);
  out.before = { status: before.status, version: before.version, threadResolved: shape(before.resolved), keys: Object.keys(before.c) };
  if (before.status !== 200 || before.version === null) return { ok: false, why: `The thread read failed: HTTP ${before.status}.`, out };
  if (before.resolved === true) return { ok: false, why: "The thread is resolved. Reopen it on Bitbucket, or pick an open thread.", out };
  const acts = await activityIds();

  // U62, U64: the PUT body field and the version bump.
  const r1 = await put(thread, before.version, true);
  const after = await read(thread);
  out.resolve = {
    put: { status: r1.status, body: shape(r1.body), exceptions: exceptionNames(r1.body) },
    read: {
      status: after.status,
      version: after.version,
      threadResolved: shape(after.resolved),
      threadResolver: after.c.threadResolver !== undefined && after.c.threadResolver !== null,
      threadResolvedDate: typeof after.c.threadResolvedDate === "number",
      textUnchanged: hash(after.c.text) === hash(before.c.text),
    },
  };
  // U65: an activity for the resolve.
  const newActs = [...(await activityIds())].filter(([id]) => !acts.has(id)).map(([, a]) => ({ ...a, sameThread: a.comment === thread }));
  out.activities = { before: acts.size, new: newActs };

  // U63: a PUT with the old version.
  const r2 = await put(thread, before.version, false);
  const afterStale = await read(thread);
  out.stale = {
    put: { status: r2.status, body: shape(r2.body), exceptions: exceptionNames(r2.body) },
    threadResolved: shape(afterStale.resolved),
    version: afterStale.version,
  };

  // The reopen with a fresh version. A stale PUT that went through reopened it already.
  const fresh = await read(thread);
  const r3 = fresh.resolved === false ? null : await put(thread, fresh.version, false);
  const end = await read(thread);
  out.reopen = {
    put: r3 && { status: r3.status, body: shape(r3.body), exceptions: exceptionNames(r3.body) },
    skipped: r3 === null,
    read: {
      status: end.status,
      version: end.version,
      threadResolved: shape(end.resolved),
      threadResolver: end.c.threadResolver !== undefined && end.c.threadResolver !== null,
      threadResolvedDate: typeof end.c.threadResolvedDate === "number",
      textUnchanged: hash(end.c.text) === hash(before.c.text),
    },
  };

  // U66: a thread that the token owner may not change.
  if (forbidden !== null) {
    const f = await read(forbidden);
    const r4 = f.version === null ? null : await put(forbidden, f.version, f.resolved !== true);
    const fEnd = await read(forbidden);
    out.forbidden = {
      read: f.status,
      put: r4 && { status: r4.status, body: shape(r4.body), exceptions: exceptionNames(r4.body) },
      changed: shape(fEnd.resolved) !== shape(f.resolved),
    };
  }
  return { ok: true, why: null, out };
}

function lines(out: Record<string, unknown>): string[] {
  const o = out as any;
  const put = (p: any) => (p ? `HTTP ${p.status}${p.exceptions?.length ? ` ${p.exceptions.join(",")}` : ""}` : "none");
  return [
    `before: HTTP ${o.before?.status} version=${o.before?.version} threadResolved=${o.before?.threadResolved}`,
    ...(o.resolve
      ? [
          `resolve PUT: ${put(o.resolve.put)} body keys=${typeof o.resolve.put.body === "object" && o.resolve.put.body ? Object.keys(o.resolve.put.body).join(",") : String(o.resolve.put.body)}`,
          `after resolve: version=${o.resolve.read.version} threadResolved=${o.resolve.read.threadResolved} threadResolver=${o.resolve.read.threadResolver} threadResolvedDate=${o.resolve.read.threadResolvedDate} text unchanged=${o.resolve.read.textUnchanged}`,
          `activities: before=${o.activities.before} new=${o.activities.new.length}${o.activities.new.map((a: any) => ` [${a.action}/${a.commentAction} same thread=${a.sameThread}]`).join("")}`,
          `stale PUT: ${put(o.stale.put)} threadResolved after=${o.stale.threadResolved} version=${o.stale.version}`,
          `reopen PUT: ${o.reopen.skipped ? "skipped, the stale PUT reopened it" : put(o.reopen.put)}`,
          `after reopen: version=${o.reopen.read.version} threadResolved=${o.reopen.read.threadResolved} threadResolver=${o.reopen.read.threadResolver} threadResolvedDate=${o.reopen.read.threadResolvedDate} text unchanged=${o.reopen.read.textUnchanged}`,
        ]
      : []),
    ...(o.forbidden ? [`forbidden PUT: ${put(o.forbidden.put)} state changed=${o.forbidden.changed}`] : []),
  ];
}

// ---------- dry run: a loopback fake with the documented behavior (version check, bump, resolver fields) ----------
function fakeServer(token: string) {
  const comments = new Map<number, Record<string, unknown>>([
    [101, { id: 101, version: 3, text: "Synthetic root.", author: { slug: "dry" }, threadResolved: false, comments: [] }],
    [202, { id: 202, version: 0, text: "Synthetic other.", author: { slug: "other" }, threadResolved: false, comments: [] }],
  ]);
  const activities: Record<string, unknown>[] = [{ id: 1, action: "COMMENTED", commentAction: "ADDED", comment: { id: 101 } }];
  const json = (status: number, body: unknown) => Response.json(body, { status });
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (req.headers.get("authorization") !== `Bearer ${token}`) return json(401, { errors: [{ message: "Authentication failed." }] });
      const url = new URL(req.url);
      if (url.pathname.endsWith("/activities")) return json(200, { values: activities, isLastPage: true, start: 0 });
      const id = Number(url.pathname.split("/").pop());
      const c = comments.get(id);
      if (!c) return json(404, { errors: [{ message: "Not found." }] });
      if (req.method === "GET") return json(200, c);
      const body = (await req.json()) as { version?: unknown; threadResolved?: unknown };
      if (id === 202) return json(403, { errors: [{ exceptionName: "com.atlassian.bitbucket.AuthorisationException" }] });
      if (body.version !== c.version)
        return json(409, { errors: [{ exceptionName: "com.atlassian.bitbucket.comment.CommentOutOfDateException" }] });
      const resolved = body.threadResolved === true;
      Object.assign(c, { version: (c.version as number) + 1, threadResolved: resolved });
      if (resolved) Object.assign(c, { threadResolver: { slug: "dry" }, threadResolvedDate: Date.now() });
      else {
        delete c.threadResolver;
        delete c.threadResolvedDate;
      }
      return json(200, c);
    },
  });
}

if (argv.includes("--dry-run")) {
  const token = "dry-run-token";
  const server = fakeServer(token);
  try {
    const r = await gate(`http://127.0.0.1:${server.port}`, token, { project: "DRY", repo: "dry-repo", id: 1 }, 101, 202);
    console.log("[dry run: loopback fake server, no secret read]");
    for (const l of lines(r.out)) console.log(l);
    const o = r.out as any;
    const expected =
      r.ok &&
      o.resolve.put.status === 200 &&
      o.resolve.read.threadResolved === true &&
      o.stale.put.status === 409 &&
      o.reopen.read.threadResolved === false &&
      o.forbidden.put.status === 403 &&
      o.resolve.read.textUnchanged === true;
    console.log(expected ? "dry run: PASS" : `dry run: FAIL ${r.why ?? ""}`);
    process.exit(expected ? 0 : 1);
  } finally {
    server.stop(true);
  }
}

// ---------- live run ----------
const prArg = opt("--pr");
const thread = Number(opt("--thread"));
const forbiddenArg = opt("--forbidden");
const forbidden = forbiddenArg === undefined ? null : Number(forbiddenArg);
if (!prArg || prArg.startsWith("--") || !Number.isSafeInteger(thread) || thread <= 0) usage();
if (forbidden !== null && (!Number.isSafeInteger(forbidden) || forbidden <= 0)) usage();

// Test hook for the fake server. It accepts only a loopback URL, so no token from the OS store can leave this way.
const testUrl = process.env.GATE0_PROBE_TEST_URL;
if (testUrl && new URL(testUrl).hostname !== "127.0.0.1") {
  console.error("Refused: GATE0_PROBE_TEST_URL must use host 127.0.0.1.");
  process.exit(2);
}
const storedUrl = testUrl ?? (await Bun.secrets.get({ service: SERVICE, name: "bitbucket-url" }));
const token = testUrl ? process.env.GATE0_PROBE_TEST_TOKEN : await Bun.secrets.get({ service: SERVICE, name: "bitbucket-token" });
if (!storedUrl || !token) {
  console.error("Missing secrets. Run: bun scripts/gate0/set-token.ts");
  process.exit(2);
}
let pr: PrRef;
try {
  // The token goes only to the stored host. A URL for another origin stops the script before any request.
  pr = parsePrUrl(prArg, storedUrl);
} catch (e) {
  console.error(`Refused: ${(e as Error).message} Nothing was sent.`);
  process.exit(2);
}
const r = await gate(storedUrl.replace(/\/+$/, ""), token, pr, thread, forbidden);
const dir = resolve(opt("--out") ?? join(ROOT, ".gate0", "resolve"));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "result.json"), JSON.stringify({ at: new Date().toISOString(), ok: r.ok, why: r.why, ...r.out }, null, 2));
for (const l of lines(r.out)) console.log(l);
console.log(r.ok ? `Recorded in ${join(dir, "result.json")}. Copy the lines above into integration-check.md U62 to U66.` : `Stopped: ${r.why}`);
process.exit(r.ok ? 0 : 1);
