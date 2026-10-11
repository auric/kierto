// Gate 0 Bitbucket probe. Read-only unless --write is given.
// Usage: bun scripts/gate0/bitbucket-probe.ts --pr <KEY/repo/id | ~USER/repo/id | PR URL> [--write]
// Gate v3: add --v3 [--phase 1|2] [--ca-file <pem>]. Raw files are then named v3-p<phase>-<step>.json.
// Raw responses go to .gate0/raw/ (gitignored). They hold real names, emails, and the host.
// Console output holds only field names, enum values, types, and shapes.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SERVICE = "review-loop";
const RAW = resolve(import.meta.dir, "../../.gate0/raw");
const TIMEOUT_MS = 30_000;
const MARK = "[review-loop gate0 probe, safe to ignore]";

// ---------- args and secrets ----------
const argv = process.argv.slice(2);
const prArg = argv[argv.indexOf("--pr") + 1];
const WRITE = argv.includes("--write");
const V3 = argv.includes("--v3");
const optArg = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const PHASE = Number(optArg("--phase") ?? 1);
const CA_FILE = optArg("--ca-file");
if (!argv.includes("--pr") || !prArg || prArg.startsWith("--")) usage();
if (![1, 2].includes(PHASE) || (argv.includes("--phase") && !V3) || (argv.includes("--ca-file") && (!V3 || !CA_FILE))) usage();

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
const base = new URL(storedUrl);
const BASE = storedUrl.replace(/\/+$/, "");
const pr = parsePr(prArg!);
const PR_PATH = `/rest/api/1.0/projects/${encodeURIComponent(pr.key)}/repos/${encodeURIComponent(pr.slug)}/pull-requests/${pr.id}`;
mkdirSync(RAW, { recursive: true });

function usage(): never {
  console.error("usage: bun scripts/gate0/bitbucket-probe.ts --pr <KEY/repo/id | ~USER/repo/id | PR URL> [--write] [--v3 [--phase 1|2] [--ca-file <pem>]]");
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
  writeFileSync(join(RAW, V3 ? `v3-p${PHASE}-${label}.json` : `${n}-${label}.json`), JSON.stringify({ method, path, status: res.status, auser: res.headers.get("x-ausername"), body: json ?? text }, null, 2));
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

// The first page can use a smaller limit, so that a short list still shows a page that is not the last.
async function allPages(path: string, label: string, limit: number, firstLimit = limit) {
  const values: any[] = [];
  const pages: any[] = [];
  let start = 0;
  for (let i = 0; i < 50; i++) {
    const r = await api("GET", `${path}?limit=${i ? limit : firstLimit}&start=${start}`, `${label}-p${i}`);
    if (r.status !== 200) return { values, pages, status: r.status };
    values.push(...(r.json.values ?? []));
    pages.push(paging(r.json));
    if (r.json.isLastPage !== false || r.json.nextPageStart === undefined) break;
    start = r.json.nextPageStart;
  }
  return { values, pages, status: 200 };
}
const allActivities = (label: string) => allPages(`${PR_PATH}/activities`, label, 50);

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
console.log(`PR id: ${PR.id}; state: ${PR.state}; mode: ${WRITE ? "READ + WRITE" : "read only"}`);
console.log(`pull-request shape keys: ${Object.keys(PR).join(",")}`);
if (V3) {
  await runV3();
  process.exit(0);
}

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

// ---------- Gate v3 ----------
// Only function declarations below this line. runV3 runs before the top-level code reaches here.
type Created = { id: number; kind: string };
type Anchor = { path: string; line: number; fromHash: string; toHash: string };
type V3State = {
  pr: string;
  head?: string;
  mergeBase?: string;
  commitCount: number;
  created: Created[];
  knownActivities: number[];
  diffHash: Record<string, string>;
};

function encPath(p: string) {
  return p.split("/").map(encodeURIComponent).join("/");
}

function anchorInfo(a: any) {
  return a ? { keys: Object.keys(a), lineType: a.lineType, fileType: a.fileType, diffType: a.diffType, orphaned: a.orphaned } : null;
}

function linkNames(links: any) {
  return Object.entries(links ?? {})
    .map(([k, arr]) => `${k}[${(Array.isArray(arr) ? arr : []).map((x: any) => x.name ?? "-").join("|")}]`)
    .join(",");
}

function diffInfo(d: any) {
  if (!d) return "none";
  const segs = (d.hunks ?? []).flatMap((h: any) => h.segments ?? []);
  return JSON.stringify({ keys: Object.keys(d), hunks: d.hunks?.length, hunkKeys: Object.keys(d.hunks?.[0] ?? {}), segmentTypes: [...new Set(segs.map((s: any) => s.type))] });
}

function sha1(v: unknown) {
  return new Bun.CryptoHasher("sha1").update(JSON.stringify(v ?? null)).digest("hex");
}

async function git(args: string[], env: Record<string, string | undefined>, timeoutMs = TIMEOUT_MS) {
  const p = Bun.spawn(["git", ...args], { env, stdout: "pipe", stderr: "pipe" });
  // On Windows, git starts helper processes. taskkill /T ends the whole tree.
  const timer = setTimeout(() => {
    if (process.platform === "win32") Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(p.pid)]);
    else p.kill();
  }, timeoutMs);
  const [out, errText] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  clearTimeout(timer);
  return { code, out: out.trim(), err: errText };
}

async function readCommits() {
  const c = await allPages(`${PR_PATH}/commits`, "commits", 100, 2);
  const v = c.values;
  const head = PR.fromRef?.latestCommit;
  const chain = v.every((x, i) => i === v.length - 1 || (x.parents ?? []).some((p: any) => p.id === v[i + 1].id));
  console.log(`  commits: HTTP ${c.status} count=${v.length} pages=${JSON.stringify(c.pages)}`);
  console.log(`  commit shape: ${JSON.stringify(shape(v[0] ?? null))}`);
  console.log(
    `  commit order: first is PR source head=${v[0]?.id === head}; last is PR source head=${v.at(-1)?.id === head}; each parent is the next entry=${chain}; merge commits=${v.filter((x) => (x.parents ?? []).length > 1).length}`,
  );
  return v;
}

// PR refs live in the target repository. Only the fetch gets the token, as an env config header.
async function fetchRefs() {
  const out: any = { attempts: [] };
  const clone = (PR.toRef?.repository?.links?.clone ?? []).find((l: any) => l.name === "http")?.href;
  if (!clone || !PR.toRef?.id) {
    console.log("  fetch: no http clone link or no target ref");
    return out;
  }
  const cu = new URL(clone);
  cu.username = "";
  cu.password = "";
  if (cu.origin !== base.origin) {
    console.log("  fetch: refused, clone origin differs from the stored origin");
    return out;
  }
  const dir = mkdtempSync(join(tmpdir(), "rl-gate-v3-"));
  const globalCfg = join(dir, "empty.gitconfig");
  writeFileSync(globalCfg, "");
  const env = (cfg: [string, string][]) => {
    const all: [string, string][] = [["credential.helper", ""], ...cfg];
    const e: Record<string, string | undefined> = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: globalCfg,
      GIT_CONFIG_COUNT: String(all.length),
    };
    all.forEach(([k, v], i) => {
      e[`GIT_CONFIG_KEY_${i}`] = k;
      e[`GIT_CONFIG_VALUE_${i}`] = v;
    });
    return e;
  };
  const variants: [string, [string, string][]][] = [["isolated", []]];
  if (process.platform === "win32") variants.push(["schannel", [["http.sslBackend", "schannel"]]]);
  if (CA_FILE) {
    const ca = resolve(CA_FILE);
    variants.push(["ca-file", [["http.sslCAInfo", ca]]]);
    if (process.platform === "win32")
      variants.push([
        "schannel+ca-file",
        [
          ["http.sslBackend", "schannel"],
          ["http.sslCAInfo", ca],
          ["http.schannelUseSSLCAInfo", "true"],
        ],
      ]);
  }
  try {
    const bare = join(dir, "repo.git");
    out.initExit = (await git(["init", "--bare", "--quiet", bare], env([]))).code;
    const refspecs = [`+refs/pull-requests/${pr.id}/from:refs/probe/from`, `+${PR.toRef.id}:refs/probe/to`];
    for (const [name, cfg] of variants) {
      const header: [string, string] = ["http.extraHeader", `Authorization: Bearer ${token}`];
      const f = await git(["-C", bare, "fetch", "--no-tags", "--quiet", cu.href, ...refspecs], env([...cfg, header]), 600_000);
      out.attempts.push({ name, exit: f.code, stderr: f.err.replaceAll(token!, "<token>") });
      console.log(`  fetch attempt ${name}: exit=${f.code}`);
      if (f.code === 0) {
        out.worked = name;
        break;
      }
    }
    if (out.worked) {
      out.head = (await git(["-C", bare, "rev-parse", "refs/probe/from"], env([]))).out;
      out.target = (await git(["-C", bare, "rev-parse", "refs/probe/to"], env([]))).out;
      const mb = await git(["-C", bare, "merge-base", "refs/probe/from", "refs/probe/to"], env([]));
      out.mergeBaseExit = mb.code;
      if (mb.code === 0) out.mergeBase = mb.out;
      console.log(
        `  fetch: setting that worked=${out.worked}; head equals fromRef.latestCommit=${out.head === PR.fromRef?.latestCommit}; target equals toRef.latestCommit=${out.target === PR.toRef?.latestCommit}`,
      );
      console.log(`  merge-base: exit=${mb.code}; merge base equals target head=${out.mergeBase === PR.toRef?.latestCommit}`);
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      console.log("  fetch: the temp folder was not removed");
    }
  }
  out.systemSslBackend = (await git(["config", "--system", "--get", "http.sslBackend"], { ...process.env })).out || "unset";
  console.log(`  system http.sslBackend (reference only; the fetch does not read system config)=${out.systemSslBackend}`);
  writeFileSync(join(RAW, `v3-p${PHASE}-git-fetch.json`), JSON.stringify({ method: "GIT", path: "fetch", status: out.worked ? 0 : 1, body: out }, null, 2));
  return out;
}

// First REMOVED line, first ADDED line, and a CONTEXT line exactly 3 lines from a change.
async function findAnchors(changes: any[]) {
  const found: Record<string, Anchor> = {};
  let n = 0;
  for (const ch of changes) {
    if ((found.removed && found.added && found.context) || n >= 20) break;
    const path: string = typeof ch.path?.toString === "string" ? ch.path.toString : (ch.path?.components ?? []).join("/");
    if (!path || !["ADD", "MODIFY", "DELETE"].includes(ch.type)) continue;
    const d = await api("GET", `${PR_PATH}/diff/${encPath(path)}?contextLines=10`, `diff-${n++}`);
    const h = { path, fromHash: d.json?.fromHash, toHash: d.json?.toHash };
    for (const hunk of d.json?.diffs?.[0]?.hunks ?? []) {
      const segs: any[] = hunk.segments ?? [];
      segs.forEach((s, j) => {
        const lines: any[] = s.lines ?? [];
        if (!lines.length) return;
        if (s.type === "REMOVED") found.removed ??= { ...h, line: lines[0].source };
        if (s.type === "ADDED") found.added ??= { ...h, line: lines[0].destination };
        if (s.type === "CONTEXT" && !found.context && lines.length >= 3) {
          if (segs[j + 1] && segs[j + 1].type !== "CONTEXT") found.context = { ...h, line: lines[lines.length - 3].destination };
          else if (segs[j - 1] && segs[j - 1].type !== "CONTEXT") found.context = { ...h, line: lines[2].destination };
        }
      });
    }
  }
  console.log(`  diff lines found: REMOVED=${!!found.removed} ADDED=${!!found.added} CONTEXT 3 lines from a change=${!!found.context}`);
  return found;
}

async function runV3() {
  // .txt keeps the state out of the sanitizer input, which reads only .json files.
  const STATE = join(RAW, "v3-state.txt");
  const prKey = `${pr.key}/${pr.slug}/${pr.id}`;
  const prLink = PR.links?.self?.[0]?.href;
  const save = (s: V3State) => writeFileSync(STATE, JSON.stringify(s, null, 2));
  const load = (): V3State | null => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null);
  const cmd = "bun scripts/gate0/bitbucket-probe.ts --pr <same PR> --v3";

  if (PHASE === 1) {
    if (WRITE && load()?.created.length) {
      console.error("Refused: probe comments from an earlier phase 1 still exist. Run phase 2 with --write first.");
      process.exit(1);
    }
    console.log("\n[v3 phase 1: read]");
    const commits = await readCommits();
    const ch = await allPages(`${PR_PATH}/changes`, "changes", 100);
    console.log(
      `  changes: HTTP ${ch.status} count=${ch.values.length} pages=${JSON.stringify(ch.pages)} types=${[...new Set(ch.values.map((c) => c.type))].join(",")} srcPath present=${ch.values.some((c) => c.srcPath)} value keys=${Object.keys(ch.values[0] ?? {}).join(",")}`,
    );

    const jiraPath = `/rest/jira/1.0/projects/${encodeURIComponent(pr.key)}/repos/${encodeURIComponent(pr.slug)}/pull-requests/${pr.id}/issues`;
    const jira = await api("GET", jiraPath, "jira-issues");
    if (jira.status === 404) console.log("  jira issues: HTTP 404, not available");
    else {
      const list: any[] | undefined = Array.isArray(jira.json) ? jira.json : jira.json?.values;
      const origin = (u: unknown) => {
        try {
          return new URL(String(u)).origin === base.origin ? "bitbucket" : "other";
        } catch {
          return "not a URL";
        }
      };
      const body = Array.isArray(jira.json) ? "array" : jira.json === null ? "not JSON" : "object";
      console.log(`  jira issues: HTTP ${jira.status} ${err(jira.json)} body=${body} count=${list?.length} item shape=${JSON.stringify(shape(list?.[0] ?? null))}`);
      if (list?.length)
        console.log(
          `  jira issues: every key has the form ABC-123=${list.every((i) => /^[A-Z][A-Z0-9_]*-\d+$/.test(String(i?.key)))}; url origins=${[...new Set(list.map((i) => origin(i?.url)))].join(",")}`,
        );
    }

    const repo = await api("GET", `/rest/api/1.0/projects/${encodeURIComponent(pr.key)}/repos/${encodeURIComponent(pr.slug)}`, "repository");
    console.log(`  repository: HTTP ${repo.status} links=${linkNames(repo.json?.links)}; self ends with /browse=${String(repo.json?.links?.self?.[0]?.href).endsWith("/browse")}`);
    console.log(
      `  PR links=${linkNames(PR.links)}; fromRef repository links=${linkNames(PR.fromRef?.repository?.links)}; toRef repository links=${linkNames(PR.toRef?.repository?.links)}; same repository=${PR.fromRef?.repository?.id === PR.toRef?.repository?.id}`,
    );

    const fetched = await fetchRefs();
    const A = await findAnchors(ch.values);

    if (!WRITE) {
      console.log("\nRead-only phase 1 complete. Add --write for the inline comments and the task.");
      return;
    }

    console.log("\n[v3 phase 1: write]");
    const state: V3State = {
      pr: prKey,
      head: fetched.head ?? PR.fromRef?.latestCommit,
      mergeBase: fetched.mergeBase,
      commitCount: commits.length,
      created: [],
      knownActivities: [],
      diffHash: {},
    };
    save(state);
    const post = async (kind: string, body: object) => {
      const r = await api("POST", `${PR_PATH}/comments`, `post-${kind}`, { text: `${MARK} v3 ${kind}`, ...body });
      console.log(`  post ${kind}: HTTP ${r.status} ${err(r.json)} severity=${r.json?.severity} state=${r.json?.state} anchor=${JSON.stringify(anchorInfo(r.json?.anchor))}`);
      if (!r.json?.id) return null;
      state.created.push({ id: r.json.id, kind });
      save(state);
      return r.json;
    };
    const inline = (a: Anchor, lineType: string, fileType: string, fromHash?: string, toHash?: string) => ({
      anchor: { path: a.path, line: a.line, lineType, fileType, diffType: "COMMIT", fromHash, toHash },
    });

    if (A.removed) await post("removed", inline(A.removed, "REMOVED", "FROM", A.removed.fromHash, A.removed.toHash));
    else console.log("  removed: not tried, the diff has no REMOVED line");
    const ctx = A.context ? await post("context", inline(A.context, "CONTEXT", "TO", A.context.fromHash, A.context.toHash)) : null;
    if (!A.context) console.log("  context: not tried, no CONTEXT line 3 lines from a change");
    const mb = A.added && state.mergeBase ? await post("merge-base", inline(A.added, "ADDED", "TO", state.mergeBase, state.head)) : null;
    if (!A.added || !state.mergeBase) console.log("  merge-base: not tried, no ADDED line or no merge base");
    else console.log(`  merge-base anchor: merge base equals target head=${state.mergeBase === PR.toRef?.latestCommit} (true repeats the Gate 0 case)`);

    const task = await post("blocker", { severity: "BLOCKER" });
    if (task) {
      const res = await api("PUT", `${PR_PATH}/comments/${task.id}`, "resolve-blocker", { text: task.text, version: task.version, state: "RESOLVED" });
      console.log(`  resolve blocker: HTTP ${res.status} ${err(res.json)} severity=${res.json?.severity} state=${res.json?.state} version=${res.json?.version}`);
      const got = await api("GET", `${PR_PATH}/comments/${task.id}`, "get-blocker");
      console.log(`  blocker read back: HTTP ${got.status} severity=${got.json?.severity} state=${got.json?.state} keys=${Object.keys(got.json ?? {}).join(",")}`);
    }

    const after = await allActivities("activities-after-write");
    state.knownActivities = after.values.map((a) => a.id);
    console.log(
      `  activities after write: HTTP ${after.status} actions=${[...new Set(after.values.map((a) => a.action))].join(",")} commentActions=${[...new Set(after.values.map((a) => a.commentAction).filter(Boolean))].join(",")}`,
    );
    for (const c of state.created) {
      const a = after.values.find((x) => x.comment?.id === c.id);
      if (a?.diff) state.diffHash[c.kind] = sha1(a.diff);
      const info = a && { action: a.action, commentAction: a.commentAction, severity: a.comment.severity, state: a.comment.state, commentAnchor: anchorInfo(a.commentAnchor) };
      console.log(`  activity for ${c.kind}: ${info ? JSON.stringify(info) : "none"}; diff=${diffInfo(a?.diff)}`);
    }
    save(state);

    const browse = PR.fromRef?.repository?.links?.self?.[0]?.href;
    const at = ctx ? A.context : mb ? A.added : undefined;
    const linkId = ctx?.id ?? mb?.id ?? state.created[0]?.id;
    console.log("\n[open these two links and confirm each place; the links hold the host and a path, so do not paste them]");
    console.log(at && browse ? `  file line: ${browse}/${encPath(at.path)}?at=${state.head}#${at.line}` : "  file line: no link, no inline comment on the TO side");
    console.log(linkId && prLink ? `  comment:   ${prLink}/overview?commentId=${linkId}` : "  comment: no link, no comment was created");
    console.log("\n[manual steps before phase 2]");
    console.log("  a) In the web UI, open the PR diff. Select two or more lines and add one comment on that range.");
    console.log(
      at
        ? `  b) Push one commit to the PR source branch that changes line ${at.line} of ${at.path}. The probe commented on that line.`
        : "  b) No TO-side probe comment exists. Step b cannot show an orphaned comment.",
    );
    console.log(`  Then run: ${cmd} --phase 2`);
    console.log(`  Then run: ${cmd} --phase 2 --write   (deletes the probe comments)`);
    return;
  }

  const state = load();
  if (!state || state.pr !== prKey) {
    console.error("No phase 1 state for this PR. Run phase 1 with --write first.");
    process.exit(1);
  }
  console.log("\n[v3 phase 2: read]");
  console.log(`  PR source head changed since phase 1=${PR.fromRef?.latestCommit !== state.head}`);
  const acts = await allActivities("activities");
  console.log(`  activities: HTTP ${acts.status} count=${acts.values.length} pages=${JSON.stringify(acts.pages)} actions=${[...new Set(acts.values.map((a) => a.action))].join(",")}`);
  const resc = acts.values.filter((a) => a.action === "RESCOPED");
  console.log(`  RESCOPED activities=${resc.length} shape=${JSON.stringify(shape(resc[0] ?? null))}`);

  const known = new Set(state.knownActivities);
  const probeIds = new Set(state.created.map((c) => c.id));
  const userInline = acts.values.filter((a) => !known.has(a.id) && a.comment && !probeIds.has(a.comment.id) && (a.commentAnchor || a.comment.anchor));
  console.log(`  new inline comments by you since phase 1: ${userInline.length}`);
  for (const a of userInline) {
    console.log(`  your inline comment: commentAnchor shape=${JSON.stringify(shape(a.commentAnchor ?? null))} enums=${JSON.stringify(anchorInfo(a.commentAnchor))}`);
    console.log(`    comment.anchor shape=${JSON.stringify(shape(a.comment.anchor ?? null))} diff=${diffInfo(a.diff)}`);
  }

  for (const c of state.created) {
    const g = await api("GET", `${PR_PATH}/comments/${c.id}`, `get-${c.kind}`);
    const a = acts.values.find((x) => x.comment?.id === c.id);
    const same = state.diffHash[c.kind] && a?.diff ? state.diffHash[c.kind] === sha1(a.diff) : "n/a";
    console.log(`  ${c.kind}: GET HTTP ${g.status} severity=${g.json?.severity} state=${g.json?.state} anchor=${JSON.stringify(anchorInfo(g.json?.anchor))}`);
    console.log(`    activity: ${a ? "present" : "absent"} commentAnchor.orphaned=${a?.commentAnchor?.orphaned} diff=${diffInfo(a?.diff)} diff unchanged since phase 1=${same}`);
  }

  const commits = await readCommits();
  console.log(`  commits since phase 1: before=${state.commitCount} now=${commits.length}`);

  if (!WRITE) {
    console.log("\nRead-only phase 2 complete. Run again with --write to delete the probe comments.");
    return;
  }

  console.log("\n[v3 phase 2: cleanup]");
  // Replies first: a probe reply sits after its parent in the created list. A reply by someone else blocks the delete.
  for (const c of [...state.created].reverse()) {
    let cur = await api("GET", `${PR_PATH}/comments/${c.id}`, `pre-delete-${c.kind}`);
    let del = cur.status === 404 ? cur : await api("DELETE", `${PR_PATH}/comments/${c.id}?version=${cur.json?.version}`, `delete-${c.kind}`);
    if (cur.status !== 404 && del.status === 409 && cur.json?.state === "RESOLVED") {
      const reopen = await api("PUT", `${PR_PATH}/comments/${c.id}`, `reopen-${c.kind}`, { text: cur.json.text, version: cur.json.version, state: "OPEN" });
      console.log(`  reopen ${c.kind} before delete: HTTP ${reopen.status} ${err(reopen.json)}`);
      cur = await api("GET", `${PR_PATH}/comments/${c.id}`, `pre-delete2-${c.kind}`);
      del = await api("DELETE", `${PR_PATH}/comments/${c.id}?version=${cur.json?.version}`, `delete2-${c.kind}`);
    }
    console.log(`  delete ${c.kind}: HTTP ${del.status} ${err(del.json)}${cur.status === 404 ? " (already gone)" : ""}`);
    if ([200, 204, 404].includes(del.status)) state.created = state.created.filter((x) => x.id !== c.id);
    save(state);
  }
  if (state.created.length) console.log(`  NOT deleted: ${state.created.map((c) => c.kind).join(",")}. Run phase 2 with --write again, or delete them by hand.`);
  else {
    rmSync(STATE, { force: true });
    console.log("  every probe comment is deleted");
  }
  console.log("\n[delete by hand in the web UI; the links hold the host]");
  if (!userInline.length) console.log("  your range comment: not found in the activities. Delete it by hand if it exists.");
  for (const a of userInline) console.log(`  your range comment: ${prLink}/overview?commentId=${a.comment.id}`);
  console.log("  Revert the commit from step b if the test branch needs it.");
}
