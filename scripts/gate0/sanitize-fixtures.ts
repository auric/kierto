// Regenerates fixtures/bitbucket/ from the Gate 0 probe output in .gate0/raw/.
// Usage: bun scripts/gate0/sanitize-fixtures.ts
// Every sensitive string and number comes from .gate0/raw/ at run time. This file holds no real values.
// Output is counts only. Exit code 1 when a scan hit or a structure difference exists.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const RAW = join(ROOT, ".gate0/raw");
const OUT = join(ROOT, "fixtures/bitbucket");
const SCAN_TARGETS = [OUT, join(ROOT, "integration-check.md")];
const FAKE_HOST = "bitbucket.example.test";
const FAKE_SSH_PORT = "7999";

// Raw probe step -> fixture file.
const FILES: Record<string, string> = {
  "01-pull-request.json": "pull-request.json",
  "02-application-properties.json": "application-properties.json",
  "03-dashboard-REVIEWER.json": "dashboard-reviewer-page.json",
  "04-dashboard-AUTHOR.json": "dashboard-pull-requests-page.json",
  "05-activities-p0.json": "activities-opened-only.json",
  "06-changes.json": "pull-request-changes.json",
  "11-edit-general.json": "comment-edit-response.json",
  "12-trace-edit.json": "activities-after-edit.json",
  "13-edit-stale-version.json": "comment-edit-stale-version-409.json",
  "15-trace-reply.json": "activities-nested-reply.json",
  "16-get-parent-with-reply.json": "comment-with-nested-reply.json",
  "17-post-inline-COMMIT.json": "comment-inline-commit-response.json",
  "18-trace-inline-COMMIT.json": "activities-inline-anchored.json",
  "26-delete-0.json": "comment-delete-204.json",
  "27-post-delete-0.json": "comment-get-after-delete-404.json",
  "28-trace-delete.json": "activities-after-delete.json",
};

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const raw = readdirSync(RAW).filter((f) => f.endsWith(".json")).sort().map((f) => readJson(join(RAW, f)));
const walk = (v: any, fn: (v: any, k: string) => void, k = "") => {
  fn(v, k);
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn, k));
  else if (v && typeof v === "object") for (const [kk, x] of Object.entries(v)) walk(x, fn, kk);
};
const isIdKey = (k: string) => k === "id" || k === "repositoryId" || k === "commentIds";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (t: string) => `(?<![a-z0-9])${esc(t)}(?![a-z0-9])`;
const hex = (seed: string) => new Bun.CryptoHasher("sha1").update(`fixture:${seed}`).digest("hex");

// ---------- collect real values ----------
const strMap = new Map<string, string>(); // lowercased real -> fake
const scanOnly = new Set<string>(); // lowercased real values that only the scan uses
const counters: Record<string, number> = {};
const add = (real: unknown, kind: string, make: (n: number) => string) => {
  if (typeof real !== "string" || !real) return;
  const k = real.toLowerCase();
  if (!strMap.has(k)) strMap.set(k, make((counters[kind] = (counters[kind] ?? 0) + 1)));
};
const hashMap = new Map<string, string>();
const idMap = new Map<number, number>();
const hosts = new Set<string>();
const sshPorts = new Set<string>();
const freeText = new Set<string>();

const USERS = ["jdoe", "asmith", "bwong", "cmiller", "dlee", "egarcia", "fkhan", "gnovak"];
const NAMES = ["Jane Doe", "Alex Smith", "Ben Wong", "Chris Miller", "Dana Lee", "Eva Garcia", "Farid Khan", "Gita Novak"];
let users = 0;

for (const r of raw) {
  if (typeof r.auser === "string") scanOnly.add(r.auser.toLowerCase());
  walk(r.body, (v, k) => {
    if (typeof v === "number" && isIdKey(k)) idMap.set(v, 0);
    if (typeof v === "string") {
      if (/^[0-9a-f]{40}$/.test(v) && !hashMap.has(v)) hashMap.set(v, hex(`h${hashMap.size}`));
      if (k === "href") {
        const u = new URL(v);
        hosts.add(u.hostname.toLowerCase());
        if (u.port) sshPorts.add(u.port);
      }
      if (["title", "description", "text", "line"].includes(k) && v.length >= 6 && !v.includes("review-loop gate0 probe")) freeText.add(v.toLowerCase());
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) return;
    if ("emailAddress" in v || (["NORMAL", "SERVICE"].includes(v.type) && "slug" in v)) {
      const key = String(v.slug ?? v.name).toLowerCase();
      if (!strMap.has(key)) {
        const i = users++;
        const u = USERS[i] ?? `user${i}`;
        for (const x of [v.slug, v.name]) if (x) strMap.set(x.toLowerCase(), u);
        if (v.displayName) {
          strMap.set(v.displayName.toLowerCase(), NAMES[i] ?? `User ${i}`);
          for (const p of v.displayName.split(/\s+/)) if (p.length >= 3) scanOnly.add(p.toLowerCase());
        }
        if (v.emailAddress) {
          strMap.set(v.emailAddress.toLowerCase(), `${u}@example.test`);
          scanOnly.add(v.emailAddress.split("@")[1].toLowerCase());
          scanOnly.add(v.emailAddress.split("@")[0].toLowerCase());
        }
      }
    }
    if ("scmId" in v) {
      add(v.slug, "repo", (n) => `sample-repo-${n}`);
      add(v.name, "repo", (n) => `sample-repo-${n}`);
      add(v.hierarchyId, "hid", (n) => hex(`hid${n}`).slice(0, v.hierarchyId.length));
    }
    if (typeof v.key === "string" && "type" in v) {
      if (v.type !== "PERSONAL") add(v.key, "proj", (n) => `PROJ${n}`);
      add(v.name, "pname", (n) => `Sample Project ${n}`);
    }
    if (typeof v.id === "string" && v.id.startsWith("refs/")) add(v.displayId, "branch", (n) => `topic/sample-${n}`);
    if (Array.isArray(v.components))
      v.components.forEach((c: string, i: number, a: string[]) => add(c, "pc", (n) => (i === a.length - 1 ? `sample${n}${v.extension ? `.${v.extension}` : ""}` : `dir${n}`)));
  });
}
// The instance display name is not a user. It is mapped only when it differs from the product name.
const props = raw.find((r) => String(r.path).endsWith("/application-properties"))?.body;
if (props?.displayName && props.displayName.toLowerCase() !== "bitbucket") add(props.displayName, "srv", () => "Bitbucket");
for (const h of hosts) {
  strMap.set(h, FAKE_HOST);
  for (const p of h.split(".")) if (p.length >= 4) scanOnly.add(p);
}

// Fake IDs keep the digit count. They never reuse a real ID value.
{
  const used = new Set(idMap.keys());
  const next: Record<number, number> = {};
  for (const real of [...idMap.keys()].sort((a, b) => a - b)) {
    const d = String(real).length;
    let f = next[d] ?? (d === 1 ? 1 : 10 ** (d - 1) + 1);
    while (used.has(f)) f++;
    if (String(f).length !== d) throw new Error(`no fake ID left for ${d} digits`);
    used.add(f);
    idMap.set(real, f);
    next[d] = f + 1;
  }
}

// ---------- sanitize ----------
const tokens = [...strMap.keys()].filter((t) => t.length >= 3 && strMap.get(t)!.toLowerCase() !== t).sort((a, b) => b.length - a.length);
const tokenRe = new RegExp(tokens.map(word).join("|"), "gi");
const keepCase = (src: string, dst: string) => (src === src.toUpperCase() && src !== src.toLowerCase() ? dst.toUpperCase() : dst);
const mapId = (n: number) => idMap.get(n) ?? n;
// Numbers in messages: "Comment 1,234,567 does not exist." uses group separators.
const mapNumText = (s: string) => s.replace(/\d{1,3}(?:,\d{3})+|\d{4,}/g, (m) => {
  const n = Number(m.replace(/,/g, ""));
  return idMap.has(n) ? (m.includes(",") ? mapId(n).toLocaleString("en-US") : String(mapId(n))) : m;
});

let textN = 0;
function fixStr(s: string, k: string): string {
  if (k === "title") return "Sample pull request";
  if (k === "description") return "Sample description.";
  if (k === "line") return `sample line ${++textN}`;
  if (k === "text") {
    const m = s.match(/^(\[review-loop gate0 probe, safe to ignore\]) (.*)$/);
    return m ? `${m[1]} ${m[2]}` : `Sample comment ${++textN}.`;
  }
  let out = s.replace(/[0-9a-f]{40}/g, (h) => hashMap.get(h) ?? h).replace(tokenRe, (m) => keepCase(m, strMap.get(m.toLowerCase())!));
  if (k === "href") {
    const u = new URL(out);
    if (u.port) out = out.replace(`${u.hostname}:${u.port}`, `${u.hostname}:${FAKE_SSH_PORT}`);
    out = out.replace(/\/pull-requests\/(\d+)/, (_, n) => `/pull-requests/${mapId(Number(n))}`);
  }
  if (k === "message") out = mapNumText(out);
  return out;
}
function sanitize(v: any, k = ""): any {
  if (Array.isArray(v)) return v.map((x) => sanitize(x, k));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, sanitize(x, kk)]));
  if (typeof v === "number" && isIdKey(k)) return mapId(v);
  return typeof v === "string" ? fixStr(v, k) : v;
}

mkdirSync(OUT, { recursive: true });
for (const [src, dst] of Object.entries(FILES)) {
  const r = readJson(join(RAW, src));
  writeFileSync(join(OUT, dst), JSON.stringify({ status: r.status, body: sanitize(r.body) }, null, 2) + "\n");
}

// ---------- structure comparison ----------
const ENUM_KEYS = new Set(["action", "commentAction", "state", "type", "lineType", "fileType", "diffType", "severity", "role", "status", "nodeType", "gitChangeType", "changeScope", "scmId", "whitespace", "version", "buildNumber"]);
let structDiffs = 0;
function cmp(a: any, b: any, k: string) {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) return structDiffs++;
  if (Array.isArray(a)) {
    if (a.length !== b.length) structDiffs++;
    return a.forEach((x, i) => cmp(x, b[i], k));
  }
  if (a && typeof a === "object") {
    if (Object.keys(a).join() !== Object.keys(b).join()) structDiffs++;
    return Object.keys(a).forEach((x) => cmp(a[x], b[x], x));
  }
  if (typeof a === "number") {
    if (isIdKey(k) ? b !== idMap.get(a) || String(a).length !== String(b).length : a !== b) structDiffs++;
  } else if (typeof a === "boolean") {
    if (a !== b) structDiffs++;
  } else if (ENUM_KEYS.has(k) && a !== b) structDiffs++;
  else if (/^[0-9a-f]{40}$/.test(a) && b !== hashMap.get(a)) structDiffs++;
}
for (const [src, dst] of Object.entries(FILES)) {
  const a = readJson(join(RAW, src));
  const b = readJson(join(OUT, dst));
  if (a.status !== b.status) structDiffs++;
  cmp(a.body, b.body, "");
}
if (new Set(idMap.values()).size !== idMap.size || new Set(hashMap.values()).size !== hashMap.size) structDiffs++;

// ---------- scan ----------
// Free text (title, description, comment, code lines) is scanned only in the fixtures. Hand-written docs can share short generic words with it.
const files = (p: string): string[] => {
  try {
    return readdirSync(p).flatMap((f) => files(join(p, f)));
  } catch {
    return [p];
  }
};
const strTokens = [...new Set([...strMap.keys(), ...scanOnly, ...hashMap.keys()])].filter((t) => t.length >= 3 && strMap.get(t)?.toLowerCase() !== t && t !== "bitbucket");
const idTokens = [...idMap.keys()];
let hits = 0;
let checked = 0;
for (const f of SCAN_TARGETS.flatMap(files)) {
  const s = readFileSync(f, "utf8").toLowerCase();
  const inFixtures = f.startsWith(OUT);
  const res: RegExp[] = [
    ...strTokens.map((t) => new RegExp(word(t))),
    ...(inFixtures ? [...freeText].map((t) => new RegExp(esc(t))) : []),
    // IDs of 3 or more digits anywhere. Shorter IDs only as JSON id values and in PR URLs.
    ...idTokens.flatMap((n) => (String(n).length >= 3 ? [new RegExp(`(?<![0-9,])(?:${n}|${esc(n.toLocaleString("en-US"))})(?![0-9])`)] : [new RegExp(`"(?:id|repositoryid)": ${n}(?![0-9])`), new RegExp(`pull-requests/${n}(?![0-9])`)])),
    ...[...sshPorts].map((p) => new RegExp(`:${p}(?![0-9])`)),
  ];
  checked = Math.max(checked, res.length);
  for (const re of res) if (re.test(s)) hits++;
}

console.log(`files written=${Object.keys(FILES).length} sensitive values checked=${checked} (strings=${strTokens.length} freeText=${freeText.size} ids=${idTokens.length} ports=${sshPorts.size}) hits=${hits} structure diffs=${structDiffs}`);
if (hits || structDiffs) process.exit(1);
