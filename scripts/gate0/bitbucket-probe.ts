// Gate 0 Bitbucket probe. Read-only unless --write is given.
// Usage: bun scripts/gate0/bitbucket-probe.ts --pr <KEY/repo/id | ~USER/repo/id | PR URL> [--write]
// Raw responses go to .gate0/raw/ (gitignored). They hold real names, emails, and the host.
// Console output holds only field names, enum values, types, and shapes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SERVICE = "review-loop";
const RAW = resolve(import.meta.dir, "../../.gate0/raw");
const TIMEOUT_MS = 30_000;
const MARK = "[review-loop gate0 probe, safe to ignore]";

// ---------- args and secrets ----------
const argv = process.argv.slice(2);
const prArg = argv[argv.indexOf("--pr") + 1];
const WRITE = argv.includes("--write");
if (!argv.includes("--pr") || !prArg || prArg.startsWith("--")) usage();

const storedUrl = await Bun.secrets.get({ service: SERVICE, name: "bitbucket-url" });
const token = await Bun.secrets.get({ service: SERVICE, name: "bitbucket-token" });
if (!storedUrl || !token) {
  console.error("Missing secrets. Run: bun scripts/gate0/set-token.ts");
  process.exit(2);
}
const base = new URL(storedUrl);
const BASE = storedUrl.replace(/\/+$/, "");
const pr = parsePr(prArg!);
const PR_PATH = `/rest/api/1.0/projects/${encodeURIComponent(pr.key)}/repos/${encodeURIComponent(pr.slug)}/pull-requests/${pr.id}`;
mkdirSync(RAW, { recursive: true });

function usage(): never {
  console.error("usage: bun scripts/gate0/bitbucket-probe.ts --pr <KEY/repo/id | ~USER/repo/id | PR URL> [--write]");
  process.exit(2);
}

function parsePr(s: string): { key: string; slug: string; id: number } {
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    // The token goes only to the stored host. A URL for another origin stops the probe before any request.
    if (u.origin !== base.origin) {
      console.error("Refused: the PR URL origin differs from the stored bitbucket-url origin. Nothing was sent.");
      process.exit(2);
    }
    const m = u.pathname.match(/\/(projects|users)\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)(?:\/|$)/);
    if (!m) usage();
    const owner = decodeURIComponent(m[2]!);
    return { key: m[1] === "users" ? `~${owner.toUpperCase()}` : owner, slug: decodeURIComponent(m[3]!), id: Number(m[4]) };
  }
  const parts = s.split("/");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !/^\d+$/.test(parts[2]!)) usage();
  return { key: parts[0]!, slug: parts[1]!, id: Number(parts[2]) };
}

// ---------- HTTP ----------
// Requests run one at a time. That stays under the limit of 2 concurrent requests.
let seq = 0;
async function api(method: string, path: string, label: string, body?: unknown) {
  const n = String(++seq).padStart(2, "0");
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    console.log(`  ${n} ${method} ${label}: network error ${(e as Error).name}`);
    return { status: 0, json: null as any, headers: new Headers() };
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  writeFileSync(join(RAW, `${n}-${label}.json`), JSON.stringify({ method, path, status: res.status, auser: res.headers.get("x-ausername"), body: json ?? text }, null, 2));
  if (res.status >= 300 && res.status < 400) console.log(`  ${n} ${method} ${label}: redirect ${res.status} not followed`);
  return { status: res.status, json, headers: res.headers };
}

const err = (j: any) => (j?.errors ?? []).map((e: any) => e.exceptionName ?? "error").join(",");

// Types only, no values. Arrays show the shape of their first element.
function shape(v: any, depth = 0): any {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1)] : [];
  if (typeof v === "object") {
    if (depth > 6) return "object";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return typeof v;
}

const paging = (j: any) => ({ isLastPage: j?.isLastPage, nextPageStart: j?.nextPageStart, size: j?.size, limit: j?.limit, start: j?.start });

async function allActivities(label: string) {
  const values: any[] = [];
  const pages: any[] = [];
  let start = 0;
  for (let i = 0; i < 50; i++) {
    const r = await api("GET", `${PR_PATH}/activities?limit=50&start=${start}`, `${label}-p${i}`);
    if (r.status !== 200) return { values, pages, status: r.status };
    values.push(...(r.json.values ?? []));
    pages.push(paging(r.json));
    if (r.json.isLastPage !== false || r.json.nextPageStart === undefined) break;
    start = r.json.nextPageStart;
  }
  return { values, pages, status: 200 };
}

function walkComments(c: any, depth: number, out: { maxDepth: number; count: number }) {
  if (!c) return;
  out.count++;
  out.maxDepth = Math.max(out.maxDepth, depth);
  for (const r of c.comments ?? []) walkComments(r, depth + 1, out);
}

function summarizeActivities(values: any[]) {
  const nest = { maxDepth: 0, count: 0 };
  for (const a of values) walkComments(a.comment, 0, nest);
  return {
    count: values.length,
    actions: [...new Set(values.map((a) => a.action))],
    commentActions: [...new Set(values.filter((a) => a.commentAction).map((a) => a.commentAction))],
    commentAnchorKeys: [...new Set(values.flatMap((a) => Object.keys(a.commentAnchor ?? {})))],
    nestedReplyDepth: nest.maxDepth,
    commentVersionType: typeof values.find((a) => a.comment)?.comment?.version,
  };
}

// Activities that reference one of our created comments, as action/commentAction plus comment shape.
async function trace(step: string, ids: number[]) {
  const r = await api("GET", `${PR_PATH}/activities?limit=50`, `trace-${step}`);
  const hits = (r.json?.values ?? []).filter((a: any) => ids.includes(a.comment?.id));
  console.log(`  after ${step}: ${JSON.stringify(hits.map((a: any) => ({ action: a.action, commentAction: a.commentAction, commentId: ids.indexOf(a.comment.id), version: a.comment.version })))}`);
  return hits;
}

// ---------- read part ----------
const prRes = await api("GET", PR_PATH, "pull-request");
if (prRes.status !== 200) {
  console.error(`PR read failed: HTTP ${prRes.status} ${err(prRes.json)}`);
  process.exit(1);
}
const PR = prRes.json;
console.log(`PR title: ${PR.title}`);
console.log(`PR author: ${PR.author?.user?.displayName ?? PR.author?.user?.name}`);
console.log(`PR state: ${PR.state}; mode: ${WRITE ? "READ + WRITE" : "read only"}`);
console.log(`pull-request shape keys: ${Object.keys(PR).join(",")}`);

console.log("\n[read]");
const props = await api("GET", "/rest/api/1.0/application-properties", "application-properties");
console.log(`  application-properties: HTTP ${props.status} version=${props.json?.version} buildNumber=${props.json?.buildNumber} keys=${Object.keys(props.json ?? {}).join(",")}`);
console.log(`  X-AUSERNAME header: ${props.headers.get("x-ausername") ? "present" : "absent"}`);

for (const role of ["REVIEWER", "AUTHOR"]) {
  const d = await api("GET", `/rest/api/1.0/dashboard/pull-requests?state=OPEN&role=${role}&limit=1`, `dashboard-${role}`);
  console.log(`  dashboard role=${role}: HTTP ${d.status} paging=${JSON.stringify(paging(d.json))} valueKeys=${Object.keys(d.json?.values?.[0] ?? {}).join(",")}`);
}

const acts = await allActivities("activities");
console.log(`  activities: HTTP ${acts.status} pages=${JSON.stringify(acts.pages)}`);
console.log(`  activities summary: ${JSON.stringify(summarizeActivities(acts.values))}`);
const firstComment = acts.values.find((a) => a.comment)?.comment;
if (firstComment) console.log(`  comment shape: ${JSON.stringify(shape({ ...firstComment, comments: firstComment.comments?.slice(0, 1) }))}`);

const changes = await api("GET", `${PR_PATH}/changes?limit=100`, "changes");
console.log(`  changes: HTTP ${changes.status} paging=${JSON.stringify(paging(changes.json))} fromHash=${typeof changes.json?.fromHash} toHash=${typeof changes.json?.toHash} changeTypes=${[...new Set((changes.json?.values ?? []).map((c: any) => c.type))].join(",")}`);

// First ADDED line from the per-file PR diff.
let added: { path: string; line: number; fromHash: string; toHash: string } | null = null;
for (const ch of changes.json?.values ?? []) {
  if (!["ADD", "MODIFY"].includes(ch.type)) continue;
  const path: string = typeof ch.path?.toString === "string" ? ch.path.toString : (ch.path?.components ?? []).join("/");
  if (!path) continue;
  const d = await api("GET", `${PR_PATH}/diff/${path.split("/").map(encodeURIComponent).join("/")}?contextLines=0`, "diff-file");
  const diff = d.json?.diffs?.[0];
  const seg = diff?.hunks?.flatMap((h: any) => h.segments ?? []).find((s: any) => s.type === "ADDED");
  if (d.status === 200) console.log(`  diff: HTTP 200 top keys=${Object.keys(d.json).join(",")} segment types=${[...new Set(diff?.hunks?.flatMap((h: any) => (h.segments ?? []).map((s: any) => s.type)) ?? [])].join(",")} line keys=${Object.keys(seg?.lines?.[0] ?? {}).join(",")}`);
  if (seg) {
    added = { path, line: seg.lines[0].destination, fromHash: d.json.fromHash, toHash: d.json.toHash };
    console.log(`  ADDED line found; diff fromHash=${typeof added.fromHash} toHash=${typeof added.toHash}; toHash equals PR source head=${added.toHash === PR.fromRef?.latestCommit}`);
    break;
  }
}
if (!added) console.log("  no ADDED line found in the first 100 changes");

// ---------- refs ----------
const clone = (PR.fromRef?.repository?.links?.clone ?? []).find((l: any) => l.name === "http")?.href;
if (!clone) console.log("  refs: no http clone link");
else {
  const cu = new URL(clone);
  cu.username = "";
  cu.password = "";
  if (cu.origin !== base.origin) console.log("  refs: refused, clone origin differs from the stored origin");
  else {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}` };
    const p = Bun.spawn(["git", "ls-remote", cu.href, `refs/pull-requests/${pr.id}/*`], { env, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), TIMEOUT_MS);
    const out = await new Response(p.stdout).text();
    await new Response(p.stderr).text();
    const code = await p.exited;
    clearTimeout(timer);
    writeFileSync(join(RAW, "ls-remote.txt"), out);
    const refs = out.split("\n").filter(Boolean).map((l) => l.split("\t")[1]!.replace(`/${pr.id}/`, "/<id>/"));
    console.log(`  refs: git ls-remote exit=${code} refs=${refs.join(",") || "none"}`);
  }
}

// ---------- write part ----------
if (!WRITE) {
  console.log("\nRead-only run complete. Add --write for the comment lifecycle.");
  process.exit(0);
}

console.log("\n[write]");
const created: number[] = [];
try {
  const g = await api("POST", `${PR_PATH}/comments`, "post-general", { text: `${MARK} general` });
  console.log(`  post general: HTTP ${g.status} version=${g.json?.version} shape=${JSON.stringify(shape(g.json))}`);
  if (g.status !== 201 && g.status !== 200) throw new Error(`post failed ${err(g.json)}`);
  created.push(g.json.id);
  await trace("post", created);

  const got = await api("GET", `${PR_PATH}/comments/${g.json.id}`, "get-general");
  console.log(`  read back: HTTP ${got.status} version=${got.json?.version}`);

  const ed = await api("PUT", `${PR_PATH}/comments/${g.json.id}`, "edit-general", { text: `${MARK} general, edited`, version: got.json?.version });
  console.log(`  edit: HTTP ${ed.status} newVersion=${ed.json?.version} ${err(ed.json)}`);
  await trace("edit", created);

  const stale = await api("PUT", `${PR_PATH}/comments/${g.json.id}`, "edit-stale-version", { text: `${MARK} stale`, version: got.json?.version });
  console.log(`  edit with stale version: HTTP ${stale.status} ${err(stale.json)}`);

  const rp = await api("POST", `${PR_PATH}/comments`, "post-reply", { text: `${MARK} reply`, parent: { id: g.json.id } });
  console.log(`  reply: HTTP ${rp.status} ${err(rp.json)}`);
  if (rp.json?.id) created.push(rp.json.id);
  await trace("reply", created);
  const parent = await api("GET", `${PR_PATH}/comments/${g.json.id}`, "get-parent-with-reply");
  console.log(`  parent after reply: nested comments=${parent.json?.comments?.length} replyShape=${JSON.stringify(shape(parent.json?.comments?.[0] ?? null))}`);

  if (added) {
    for (const diffType of ["COMMIT", "EFFECTIVE"]) {
      const anchor = { path: added.path, line: added.line, lineType: "ADDED", fileType: "TO", diffType, fromHash: added.fromHash, toHash: added.toHash };
      const il = await api("POST", `${PR_PATH}/comments`, `post-inline-${diffType}`, { text: `${MARK} inline ${diffType}`, anchor });
      console.log(`  inline diffType=${diffType}: HTTP ${il.status} ${err(il.json)} anchorKeys=${Object.keys(il.json?.anchor ?? {}).join(",")}`);
      if (il.json?.id) {
        created.push(il.json.id);
        await trace(`inline-${diffType}`, created);
        break;
      }
    }
  }
} catch (e) {
  console.log(`  write part stopped: ${(e as Error).message}`);
} finally {
  // Replies first. The server can refuse to delete a comment that has replies.
  for (const id of [...created].reverse()) {
    const cur = await api("GET", `${PR_PATH}/comments/${id}`, `pre-delete-${created.indexOf(id)}`);
    const del = await api("DELETE", `${PR_PATH}/comments/${id}?version=${cur.json?.version}`, `delete-${created.indexOf(id)}`);
    const after = await api("GET", `${PR_PATH}/comments/${id}`, `post-delete-${created.indexOf(id)}`);
    console.log(`  delete comment ${created.indexOf(id)}: HTTP ${del.status} ${err(del.json)}; read after delete: HTTP ${after.status} ${err(after.json)}`);
  }
  if (created.length) {
    const hits = await trace("delete", created);
    console.log(`  deleted-comment activity shape: ${JSON.stringify(shape(hits[0] ?? null))}`);
  }
}
