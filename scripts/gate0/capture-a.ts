// Gate A capture for U2 (range comment, manual step a) and U12 (orphaned comment after a push, manual step b). GET requests only.
// Usage: bun scripts/gate0/capture-a.ts --pr <PR URL> --step a|b|both [--raw <dir>] [--out <dir>]
//        bun scripts/gate0/capture-a.ts --dry-run
// Raw responses go to .gate0/a-capture/raw/ (gitignored). They hold real names, emails, paths, and the host.
// The sanitizer writes fixtures/bitbucket/real-u2-*.json and real-u12-*.json. Rename the files that tests use (fixtures/bitbucket/README.md).
// Console output holds only key names, enum values, numbers, booleans, and counts. Never names, hosts, paths, or text.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parsePrUrl } from "../../src/shared/pr-url";
import type { PrRef } from "../../src/shared/types";

const SERVICE = "review-loop";
const ROOT = resolve(import.meta.dir, "../..");
const SANITIZER = join(import.meta.dir, "sanitize-fixtures.ts");
const TIMEOUT_MS = 30_000;
const MAX_PAGES = 50;
const MAX_PATHS = 20;
const DRY_FIXTURES = [
  "pull-request.json",
  "activities-v3-after-write.json",
  "activities-u2-range.json",
  "activities-u12-orphaned-range.json",
  "comment-inline-context-response.json",
  "pull-request-commits-u12.json",
];

const argv = process.argv.slice(2);
const opt = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
function usage(): never {
  console.error("usage: bun scripts/gate0/capture-a.ts --pr <PR URL> --step a|b|both [--raw <dir>] [--out <dir>]\n       bun scripts/gate0/capture-a.ts --dry-run");
  process.exit(2);
}

// ---------- summary ----------
type RawFile = { name: string; body: any };

const walk = (v: any, fn: (o: any) => void) => {
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
  else if (v && typeof v === "object") {
    fn(v);
    Object.values(v).forEach((x) => walk(x, fn));
  }
};

// Strings other than enum values can hold paths, hashes, or names.
const fieldValue = (v: unknown) =>
  typeof v === "number" || typeof v === "boolean" || v === null ? String(v) : typeof v === "string" ? (/^[A-Z][A-Z_]*$/.test(v) ? v : "<string>") : `<${Array.isArray(v) ? "array" : "object"}>`;
const anchorText = (a: any) => `keys=${Object.keys(a).join(",")} ${Object.entries(a).map(([k, v]) => `${k}=${fieldValue(v)}`).join(" ")}`;
const counts = (xs: unknown[]) => JSON.stringify(xs.reduce<Record<string, number>>((m, x) => ((m[String(x)] = (m[String(x)] ?? 0) + 1), m), {}));

function summarize(files: RawFile[]) {
  const commentNo = new Map<number, number>();
  const no = (id: number) => {
    if (!commentNo.has(id)) commentNo.set(id, commentNo.size + 1);
    return commentNo.get(id)!;
  };
  // One line per comment, source, and anchor content. The file list shows where it occurred.
  const anchors = new Map<string, string[]>();
  const seen = (line: string, file: string) => anchors.set(line, [...(anchors.get(line) ?? []), file]);
  const out: string[] = [];
  const pr = files.find((f) => f.body?.fromRef)?.body;
  for (const { name, body } of files) {
    const values: any[] = Array.isArray(body?.values) ? body.values : [];
    if (body?.fromRef) out.push(`${name}: pull request state=${fieldValue(body.state)} version=${body.version}`);
    else if (values.some((v) => v?.action)) {
      out.push(`${name}: activities count=${values.length} isLastPage=${body.isLastPage} actions=${counts(values.map((a) => a.action))} commentActions=${counts(values.filter((a) => a.commentAction).map((a) => a.commentAction))}`);
      for (const a of values.filter((x) => x.action === "RESCOPED"))
        out.push(`  RESCOPED keys=${Object.keys(a).join(",")} added.commits=${a.added?.commits?.length} added.total=${a.added?.total} removed.commits=${a.removed?.commits?.length} removed.total=${a.removed?.total}`);
      for (const a of values.filter((x) => x.commentAnchor && x.comment)) {
        seen(`#${no(a.comment.id)} activity.commentAnchor ${anchorText(a.commentAnchor)}`, name);
        if (a.diff) seen(`#${no(a.comment.id)} activity.diff keys=${Object.keys(a.diff).join(",")} hunks=${a.diff.hunks?.length ?? 0}`, name);
      }
    } else if (values.some((v) => Array.isArray(v?.parents))) {
      out.push(`${name}: commits count=${values.length} isLastPage=${body.isLastPage} first is PR source head=${pr ? values[0]?.id === pr.fromRef?.latestCommit : "no PR file"}`);
    } else if (Array.isArray(body?.diffs)) {
      const d = body.diffs;
      const lines = d.flatMap((x: any) => (x.hunks ?? []).flatMap((h: any) => (h.segments ?? []).flatMap((s: any) => s.lines ?? [])));
      out.push(`${name}: diff keys=${Object.keys(body).join(",")} file keys=${[...new Set(d.flatMap((x: any) => Object.keys(x)))].join(",")} files=${d.length} lines with commentIds=${lines.filter((l: any) => l.commentIds?.length).length}`);
    } else out.push(`${name}: other, keys=${Object.keys(body ?? {}).join(",")}`);
    // Every comment in any response: an object with a numeric id and an anchor object.
    walk(body, (o) => {
      if (typeof o.id === "number" && o.anchor && typeof o.anchor === "object") seen(`#${no(o.id)} comment.anchor ${anchorText(o.anchor)}`, name);
    });
  }
  out.push(`comments with an anchor: ${commentNo.size}`);
  for (const [line, where] of anchors) out.push(`  ${line}  [${[...new Set(where)].join(", ")}]`);
  return out.join("\n");
}

function sanitize(raw: string, out: string, extra: string[] = []) {
  const p = Bun.spawnSync([process.execPath, SANITIZER, "--raw", raw, "--out", out, "--prefix", "real-", ...extra], { stdout: "pipe", stderr: "pipe", timeout: 120_000 });
  console.log(`sanitizer: ${p.stdout.toString().trim()}${p.stderr.length ? ` stderr: ${p.stderr.toString().trim().split("\n")[0]}` : ""}`);
  return p.exitCode;
}

const readRaw = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((name) => ({ name, body: JSON.parse(readFileSync(join(dir, name), "utf8")).body }));

// ---------- dry run ----------
if (argv.includes("--dry-run")) {
  const tmp = mkdtempSync(join(tmpdir(), "rl-capture-a-"));
  let code: number | null = 1;
  try {
    const raw = join(tmp, "raw");
    mkdirSync(raw);
    for (const f of DRY_FIXTURES) writeFileSync(join(raw, `dry-${f}`), readFileSync(join(ROOT, "fixtures/bitbucket", f)));
    // The fixtures are already fake, so the leak scan would only match fake values.
    code = sanitize(raw, join(tmp, "out"), ["--no-scan"]);
    console.log(summarize(readRaw(raw)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(code ?? 1);
}

// ---------- live capture ----------
const prArg = opt("--pr");
const STEP = opt("--step");
if (!prArg || prArg.startsWith("--") || !["a", "b", "both"].includes(STEP ?? "")) usage();
const RAW = resolve(opt("--raw") ?? join(ROOT, ".gate0/a-capture/raw"));
const OUT = resolve(opt("--out") ?? join(ROOT, "fixtures/bitbucket"));

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
const BASE = storedUrl.replace(/\/+$/, "");
let pr: PrRef;
try {
  // The token goes only to the stored host. A URL for another origin stops the script before any request.
  pr = parsePrUrl(prArg, storedUrl);
} catch (e) {
  console.error(`Refused: ${(e as Error).message} Nothing was sent.`);
  process.exit(2);
}
const PR_PATH = `/rest/api/1.0/projects/${encodeURIComponent(pr.project)}/repos/${encodeURIComponent(pr.repo)}/pull-requests/${pr.id}`;

// Requests run one at a time. That stays under the limit of 2 concurrent requests.
async function get(path: string, label: string) {
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  } catch (e) {
    console.log(`  GET ${label}: network error ${(e as Error).name}`);
    return { status: 0, json: null as any };
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  writeFileSync(join(RAW, `${label}.json`), JSON.stringify({ method: "GET", path, status: res.status, auser: res.headers.get("x-ausername"), body: json ?? text }, null, 2));
  if (res.status !== 200) console.log(`  GET ${label}: HTTP ${res.status}${res.status >= 300 && res.status < 400 ? " redirect not followed" : ""}`);
  return { status: res.status, json };
}

async function allPages(path: string, label: string, limit: number) {
  const values: any[] = [];
  let start = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await get(`${path}${path.includes("?") ? "&" : "?"}limit=${limit}&start=${start}`, `${label}-p${i}`);
    if (r.status !== 200) break;
    values.push(...(r.json?.values ?? []));
    if (r.json?.isLastPage !== false || r.json?.nextPageStart == null) break;
    start = r.json.nextPageStart;
  }
  return values;
}

async function capture(step: "u2" | "u12") {
  for (const f of readdirSync(RAW)) if (f.startsWith(`${step}-`)) rmSync(join(RAW, f));
  const prRes = await get(PR_PATH, `${step}-pull-request`);
  if (prRes.status !== 200) {
    console.error(`PR read failed: HTTP ${prRes.status}`);
    process.exit(1);
  }
  const acts = await allPages(`${PR_PATH}/activities`, `${step}-activities`, 50);
  const paths = new Set<string>();
  walk(acts, (o) => {
    for (const a of [o.commentAnchor, o.anchor]) if (typeof a?.path === "string") paths.add(a.path);
  });
  if (paths.size > MAX_PATHS) console.log(`  ${paths.size} commented files; only the first ${MAX_PATHS} are read`);
  let n = 0;
  for (const path of [...paths].slice(0, MAX_PATHS)) {
    // anchorState=ALL also returns orphaned anchors. The default is ACTIVE.
    await allPages(`${PR_PATH}/comments?path=${encodeURIComponent(path)}&anchorState=ALL`, `${step}-comments-${n}`, 100);
    await get(`${PR_PATH}/diff/${path.split("/").map(encodeURIComponent).join("/")}?withComments=true`, `${step}-diff-${n}`);
    n++;
  }
  if (step === "u12") await allPages(`${PR_PATH}/commits`, `${step}-commits`, 100);
}

mkdirSync(RAW, { recursive: true });
const steps: ("u2" | "u12")[] = STEP === "a" ? ["u2"] : STEP === "b" ? ["u12"] : ["u2", "u12"];
for (const s of steps) {
  console.log(`[capture ${s}]`);
  await capture(s);
  if (existsSync(OUT)) for (const f of readdirSync(OUT)) if (f.startsWith(`real-${s}-`)) rmSync(join(OUT, f));
}
const code = sanitize(RAW, OUT);
console.log(summarize(readRaw(RAW).filter((f) => steps.some((s) => f.name.startsWith(`${s}-`)))));
if (code !== 0) console.log("The sanitizer failed. Do not commit the real-* fixtures.");
process.exit(code ?? 1);
