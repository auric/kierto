// Session consult (docs/plans/session-consult.md parts A and B): the header and the item blocks of the copied text, and the import
// and undo of a session answer. The text holds only what the app shows: no token, no setting, no host.
import type { Database } from "bun:sqlite";
import {
  type ConsultData,
  type ConsultGroup,
  type ConsultImportDto,
  type ConsultItem,
  type ConsultUndoDto,
  findingKey,
  indentBlock,
  oneLine,
  type PlanRow,
  planAnswer,
  threadKey,
} from "../../shared/consult";
import type { ChangedFile, CommentDto, FixDto, ReviewItemDto } from "../../shared/dto";
import { isMe } from "../../shared/me";
import type { AnchoredFinding, ReplyPayload, SessionMark } from "../../shared/review";
import { byThread, newestLive, threadTurn } from "../../shared/turn";
import { type ExcerptLine as CommentLine, threadSpot } from "../../shared/types";
import { prDetail } from "../inbox/queries";
import { cachedHeads } from "./diff";
import { git } from "./git";
import { type ItemRow, type ReviewJobs, toItemDto } from "./jobs";

export const OWN_ONLY = "Copy for your session works only on your own pull requests.";
// The git diff context of the diff viewer (workspace.ts diffArgs -U3).
const AROUND = 3;
// The diff viewer cuts each line at 2000 characters (diff.ts MAX_LINE).
const MAX_LINE = 2000;
// A larger file gets no code quote.
const MAX_QUOTE_FILE = 2 * 1024 * 1024;
const MAX_FILES = 200;

const SEVERITY: Record<AnchoredFinding["severity"], string> = { blocker: "Blocker", major: "Major", minor: "Minor", nit: "Nit" };
const EVIDENCE: Record<AnchoredFinding["evidenceStatus"], string> = {
  code: "Shown in code",
  reproduced: "Reproduced",
  unverified: "Unverified",
};
const JUDGEMENT = { valid: "Valid", partly: "Partly valid", invalid: "Not valid", question: "Question" } as const;
const VERDICT = { accept: "Valid", reject: "Not valid", question: "Question" } as const;

const SQL = {
  heads: "SELECT project, repo, pr_id, source_head, target_head FROM pull_request WHERE id = $id",
  // web/review/model.ts latestReview: the newest review run that did not fail or stop, else the newest review run.
  findings: `SELECT i.*, r.source_head AS run_head FROM review_item i JOIN review_run r ON r.id = i.run
    WHERE i.run = (SELECT id FROM review_run WHERE pr = $pr AND kind = 'review' ORDER BY status IN ('cancelled', 'failed'), id DESC LIMIT 1)
      AND i.kind = 'finding' AND i.status IN ('new', 'accepted') ORDER BY i.id`,
  run: `INSERT INTO review_run (pr, kind, profile, note, idem_key, source_head, target_head, status, raw_output, started_at, finished_at)
    VALUES ($pr, 'consult', '', '', $key, $source, $target, 'completed', $raw, $now, $now) RETURNING id`,
  // jobs.ts supersede: a new reply draft replaces the open drafts of its thread. Posted drafts stay.
  open: `SELECT id, status FROM review_item
    WHERE kind = 'reply' AND thread = $thread AND status IN ('new', 'accepted') AND run IN (SELECT id FROM review_run WHERE pr = $pr)`,
  supersede: "UPDATE review_item SET status = 'discarded', revision = revision + 1 WHERE id = $id",
  reply: `INSERT INTO review_item (run, kind, payload_json, body, status, thread, edited) VALUES ($run, 'reply', $payload, $body, 'new', $thread, 0)`,
  // In SQLite, SET reads the old status.
  reject: `UPDATE review_item SET status = 'discarded', revision = revision + 1,
      payload_json = json_set(payload_json, '$.session', json_object('run', $run, 'verdict', 'reject', 'reason', $reason, 'was', status))
    WHERE id = $id AND kind = 'finding' AND status IN ('new', 'accepted') AND run IN (SELECT id FROM review_run WHERE pr = $pr)`,
  mark: `UPDATE review_item SET revision = revision + 1,
      payload_json = json_set(payload_json, '$.session', json_object('run', $run, 'verdict', $verdict, 'reason', $reason))
    WHERE id = $id AND kind = 'finding' AND status IN ('new', 'accepted') AND run IN (SELECT id FROM review_run WHERE pr = $pr)`,
  consultRun: "SELECT id FROM review_run WHERE id = $run AND pr = $pr AND kind = 'consult'",
  drafts: "SELECT * FROM review_item WHERE run = $run AND kind = 'reply' ORDER BY id",
  newest: `SELECT MAX(i.id) AS id FROM review_item i JOIN review_run r ON r.id = i.run WHERE r.pr = $pr AND i.kind = 'reply' AND i.thread = $thread`,
  discard: "UPDATE review_item SET status = 'discarded', revision = revision + 1 WHERE id = $id AND status IN ('new', 'accepted')",
  bringBack: "UPDATE review_item SET status = $was, revision = revision + 1 WHERE id = $id AND status = 'discarded'",
  // A reject that still discards the finding gives its status back. A posted finding stays.
  unmark: `UPDATE review_item SET
      status = CASE WHEN status = 'discarded' AND json_extract(payload_json, '$.session.verdict') = 'reject'
        THEN json_extract(payload_json, '$.session.was') ELSE status END,
      payload_json = json_remove(payload_json, '$.session'), revision = revision + 1
    WHERE kind = 'finding' AND status <> 'posted' AND json_extract(payload_json, '$.session.run') = $run
      AND run IN (SELECT id FROM review_run WHERE pr = $pr)`,
  markedRuns: `SELECT DISTINCT run FROM review_item WHERE kind = 'finding' AND json_extract(payload_json, '$.session.run') = $run`,
};

type Heads = { project: string; repo: string; pr_id: number; source_head: string | null; target_head: string | null };
type FindingRow = ItemRow & { run_head: string };
export type ConsultSource = { db: Database; me: string; review: ReviewJobs };
type Fail = { status: 404 | 409; error: string };

const short = (h: string) => h.slice(0, 7);
const cut = (s: string) => (s.length > MAX_LINE ? s.slice(0, MAX_LINE) : s);
const lineText = (a: { line: number; lineEnd: number }) => (a.lineEnd > a.line ? `${a.line}-${a.lineEnd}` : `${a.line}`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const at = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

// ---------- Code ----------

// The lines of a file at a commit of the cache, memoized for one build. null: no cache, no such file, a binary file, or a large one.
type Reader = (commit: string, path: string) => Promise<string[] | null>;

function cacheReader(cache: { cache: string; env: Record<string, string> } | null): Reader {
  const memo = new Map<string, Promise<string[] | null>>();
  return (commit, path) => {
    if (!cache) return Promise.resolve(null);
    const key = `${commit}:${path}`;
    let p = memo.get(key);
    if (!p) {
      const g = (args: string[]) => git([`--git-dir=${cache.cache}`, ...args], { env: cache.env });
      p = (async () => {
        try {
          if (Number((await g(["cat-file", "-s", key])).trim()) > MAX_QUOTE_FILE) return null;
          const text = await g(["cat-file", "blob", key]);
          if (text.includes("\u0000")) return null;
          const lines = text.split(/\r?\n/);
          if (lines.at(-1) === "") lines.pop();
          return lines;
        } catch {
          return null;
        }
      })();
      memo.set(key, p);
    }
    return p;
  };
}

// hit: the lines of the place. The marker ">" names them.
function quoteFile(lines: string[], from: number, to: number): string {
  const first = Math.max(1, from - AROUND);
  const last = Math.min(lines.length, to + AROUND);
  const w = String(last).length;
  const out: string[] = [];
  for (let n = first; n <= last; n++)
    out.push(`    ${n >= from && n <= to ? ">" : " "} ${String(n).padStart(w)} | ${oneLine(cut(lines[n - 1] ?? ""))}`);
  return out.join("\n");
}

const SIGN = { add: "+", del: "-", ctx: " " } as const;
function quoteExcerpt(lines: { n: number; kind: "add" | "del" | "ctx"; text: string; hit: boolean }[]): string {
  const w = Math.max(...lines.map((l) => String(l.n).length));
  return lines.map((l) => `    ${l.hit ? ">" : " "} ${String(l.n).padStart(w)} ${SIGN[l.kind]} | ${oneLine(cut(l.text))}`).join("\n");
}

// ---------- The view of Review Loop ----------

function replyView(it: ReviewItemDto | undefined): string[] {
  if (!it || (it.status !== "new" && it.status !== "accepted")) return [];
  const p = it.payload as ReplyPayload & { session?: SessionMark };
  const j = p.judgement ? `judgement ${JUDGEMENT[p.judgement]}, ` : "";
  const who = p.session ? "your session" : "Review Loop";
  const state = it.status === "accepted" ? "accepted, not posted" : "not accepted yet";
  return [
    `- Reply draft from ${who} (${j}${state}):`,
    it.body.trim() ? indentBlock(it.body) : "    (no reply text)",
    `  Reason: ${oneLine(p.reason)}`,
  ];
}

function fixView(fixes: FixDto[], target: { thread?: number; finding?: number }): string[] {
  const names = (x: { thread?: number; finding?: number }) =>
    target.thread !== undefined ? x.thread === target.thread : x.finding === target.finding;
  const f = fixes.find((x) => x.threads.some(names) || x.edits.some(names));
  if (!f) return [];
  if (f.run.status === "running") return ["- Fix: a fix run runs now."];
  const out: string[] = [];
  const edits = f.edits.filter(names);
  const ids = new Set(edits.map((e) => e.id));
  const commit = f.commits.find((c) => c.state !== "undone" && c.edits.some((id) => ids.has(id)));
  if (commit)
    out.push(
      commit.state === "committed"
        ? `- Fix: committed as ${commit.short ?? short(commit.commit ?? "")}. Not pushed by the app.`
        : "- Fix: the edits are staged in the clone. The commit did not finish.",
    );
  else if (edits.length)
    out.push(
      `- Fix: fix run ${f.run.id} proposed ${plural(edits.length, "edit")} (${edits.map((e) => `${oneLine(e.path)} +${e.added} -${e.removed}`).join(", ")}). Not applied.`,
    );
  const note = f.threads.find(names);
  if (note) out.push(`- Fix check of run ${f.run.id}: ${note.fixed ? "the edits fix it" : "no fix"}. ${oneLine(note.reason)}`);
  return out;
}

// ---------- Threads ----------

const GROUP_SOURCE: Record<Exclude<ConsultGroup, "resolved">, string> = {
  reviewers: "reviewer comment",
  findings: "Review Loop finding, posted by you",
  own: "your comment",
};

async function threadItem(o: {
  msgs: CommentDto[];
  me: string;
  head: string | null;
  mergeBase: string | null;
  read: Reader;
  reply: ReviewItemDto | undefined;
  fixes: FixDto[];
}): Promise<ConsultItem | null> {
  const { msgs, me } = o;
  const last = newestLive(msgs);
  if (!last) return null;
  const rootId = msgs[0]?.rootId as number;
  const root = msgs.find((m) => m.id === rootId) ?? (msgs[0] as CommentDto);
  const mine = (m: CommentDto) => isMe({ slug: m.authorSlug, login: m.authorLogin }, me);
  const name = (m: CommentDto) => (mine(m) ? "You" : oneLine(m.authorName ?? m.authorSlug));
  const resolved = msgs.some((m) => m.threadResolved);
  const open: Exclude<ConsultGroup, "resolved"> = root.posted === "run" ? "findings" : mine(root) ? "own" : "reviewers";
  const group: ConsultGroup = resolved ? "resolved" : open;
  const spot = threadSpot(root);
  const place = !spot
    ? "general comment on the pull request"
    : spot.line === null
      ? `${spot.path}, whole file`
      : `${spot.path}:${lineText({ line: spot.line, lineEnd: spot.lineEnd })}`;
  const turn = threadTurn(msgs, me, true);
  const status = resolved
    ? "resolved. Context only, no verdict."
    : turn === "your"
      ? "open, your turn"
      : "open, waiting for the other person";
  const lines = [`### T${rootId}`, `Source: ${GROUP_SOURCE[open]} by ${name(root)}`, `Status: ${status}`];
  if (root.task) lines.push(`Task: ${root.task}`);
  lines.push(`Place: ${oneLine(place)}${spot && spot.line !== null ? `, ${spot.side} side` : ""}`);
  if (spot && spot.line !== null) {
    const excerpt = root.excerpt as CommentLine[] | undefined;
    if (spot.orphaned) {
      lines.push("Outdated: yes. The code changed after this comment.");
      if (excerpt?.length) lines.push("Code when the comment was written:", quoteExcerpt(excerpt));
    } else {
      lines.push("Outdated: no");
      const commit = spot.side === "new" ? o.head : o.mergeBase;
      const file = commit ? await o.read(commit, spot.path) : null;
      if (file && commit && spot.line <= file.length)
        lines.push(
          `Code at ${spot.side === "new" ? "the head commit" : "the merge base"} ${short(commit)}:`,
          quoteFile(file, spot.line, spot.lineEnd),
        );
      else if (excerpt?.length)
        lines.push("Code from the diff when the comment was written. The app has no copy of the code at the head:", quoteExcerpt(excerpt));
    }
  }
  lines.push(`Conversation (${plural(msgs.length, "message")}):`);
  for (const m of msgs) {
    const parent = m.parentId !== null && m.parentId !== rootId ? `, reply to ${m.parentId}` : "";
    lines.push(
      `- ${name(m)}, comment ${m.id}${parent}, ${at(m.createdAt)}:`,
      m.deleted || m.text === null ? "    (deleted)" : indentBlock(m.text),
    );
  }
  const view = resolved ? [] : [...replyView(o.reply), ...fixView(o.fixes, { thread: rootId })];
  if (view.length) lines.push("The view of Review Loop:", ...view);
  return {
    id: `T${rootId}`,
    group,
    kind: "thread",
    key: threadKey(resolved, last.id),
    label: `${name(root)}, ${oneLine(place)}`,
    text: lines.join("\n"),
  };
}

// ---------- Findings ----------

// The lines of the place on the side of the finding, with the diff rows around them.
const placeLines = (a: AnchoredFinding["anchor"], side: "new" | "old") =>
  a.excerpt.map((l) => ({ ...l, hit: l.kind !== (side === "new" ? "del" : "add") && l.n >= a.line && l.n <= a.lineEnd }));

async function findingItem(r: FindingRow, o: { head: string | null; mergeBase: string | null; read: Reader; fixes: FixDto[] }) {
  const it = toItemDto(r);
  const f = it.payload as AnchoredFinding & ReviewItemDto["payload"];
  const a = it.anchor;
  const where = a ? `${a.path}:${lineText(a)}` : `${f.path}:${f.line}`;
  const lines = [
    `### F${it.id}`,
    `Source: Review Loop finding${f.agent ? ` from agent ${oneLine(f.agent)}` : ""}`,
    `Status: ${it.status === "accepted" ? "accepted, ready to post" : "new, not triaged"}`,
    `Severity: ${SEVERITY[f.severity]}. Category: ${oneLine(f.category)}. Evidence: ${EVIDENCE[f.evidenceStatus]}, ${f.confidence} confidence.`,
    `Place: ${oneLine(where)}${a ? `, ${a.side} side` : ""}${a?.state === "outside" ? ", outside the diff" : ""}`,
  ];
  if (a) {
    const own = placeLines(a, a.side);
    const hits = own.filter((l) => l.hit);
    if (r.run_head === o.head)
      lines.push("Outdated: no", `Code at the head commit ${short(r.run_head)}, from the review diff:`, quoteExcerpt(own));
    else {
      const commit = a.side === "new" ? o.head : o.mergeBase;
      const file = commit ? await o.read(commit, a.side === "new" ? a.path : (a.oldPath ?? a.path)) : null;
      const same = !!file && hits.length > 0 && hits.every((l) => file[l.n - 1] === l.text);
      if (file && commit && same)
        lines.push(
          `Outdated: no. The review read ${short(r.run_head)}. The lines are the same at ${short(commit)}.`,
          `Code at ${a.side === "new" ? "the head commit" : "the merge base"} ${short(commit)}:`,
          quoteFile(file, a.line, a.lineEnd),
        );
      else {
        lines.push(
          file
            ? `Outdated: yes. The review read ${short(r.run_head)}. The code at the place changed after it.`
            : `Outdated: unknown. The review read ${short(r.run_head)}. The head is now ${o.head ? short(o.head) : "unknown"}. The app has no copy of the code at the head.`,
          `Code at ${short(r.run_head)}, from the review diff:`,
          quoteExcerpt(own),
        );
      }
    }
  }
  lines.push("Finding:", indentBlock(it.body));
  if (f.evidence.trim()) lines.push("Evidence:", indentBlock(f.evidence));
  const view: string[] = [];
  if (it.edited) view.push("- The author edited the finding text.");
  if (f.fixed) view.push(`- Fixed in ${f.fixed.short}. The author restored it.`);
  if (f.carried?.verdict === "open") view.push(`- A re-review of ${short(f.carried.since)} found it still open.`);
  if (f.session) view.push(`- Your session: ${VERDICT[f.session.verdict]}. ${oneLine(f.session.reason)}`);
  view.push(...fixView(o.fixes, { finding: it.id }));
  if (view.length) lines.push("The view of Review Loop:", ...view);
  return {
    id: `F${it.id}`,
    group: "findings",
    kind: "finding",
    key: findingKey(it.status, it.body),
    label: `${SEVERITY[f.severity]} finding, ${oneLine(where)}`,
    text: lines.join("\n"),
  } satisfies ConsultItem;
}

// ---------- Header ----------

function header(o: {
  key: string;
  title: string;
  source: string | null;
  target: string | null;
  head: string | null;
  tasks: string[];
  files?: ChangedFile[];
}) {
  const lines = [
    `# Review points on my pull request ${oneLine(o.key)}`,
    "",
    "You wrote the code of this pull request. Review Loop collected the review points below. Judge each point that needs a verdict.",
    "",
    `- Pull request: ${oneLine(o.key)}, "${oneLine(o.title)}"`,
    `- Branch: ${oneLine(o.source ?? "?")} into ${oneLine(o.target ?? "?")}`,
    `- Head commit: ${o.head ?? "not synced yet"}`,
    `- Tasks: ${o.tasks.length ? o.tasks.map(oneLine).join(", ") : "none"}`,
  ];
  const files = o.files;
  if (!files) lines.push("- Changed files: not synced yet");
  else if (!files.length) lines.push("- Changed files: none listed");
  else {
    lines.push(`- Changed files (${files.length}):`);
    for (const f of files.slice(0, MAX_FILES))
      lines.push(`  - ${oneLine(f.type)} ${f.srcPath && f.srcPath !== f.path ? `${oneLine(f.srcPath)} -> ` : ""}${oneLine(f.path)}`);
    if (files.length > MAX_FILES) lines.push(`  - and ${files.length - MAX_FILES} more`);
  }
  return lines.join("\n");
}

// ---------- Load ----------

// code false: the import needs only the IDs and the keys, so it reads no git object.
// Every database read comes before the first await: a settings change can close the database during a git read.
export async function consultData(s: ConsultSource, prId: number, code = true): Promise<ConsultData | Fail> {
  const { db, me, review } = s;
  const detail = prDetail(db, me, prId);
  if (!detail) return { status: 404, error: "Pull request not found." };
  if (detail.pr.role !== "AUTHOR") return { status: 409, error: OWN_ONLY };
  const h = db.query(SQL.heads).get({ id: prId }) as Heads;
  const fixes = review.fixes(db, prId) ?? [];
  const replies = new Map((review.replyDrafts(db, prId) ?? []).map((it) => [(it.payload as ReplyPayload).thread, it]));
  const findings = db.query(SQL.findings).all({ pr: prId }) as FindingRow[];
  const cache =
    code && h.source_head && h.target_head
      ? await cachedHeads(review.dataDir, {
          ref: { project: h.project, repo: h.repo, id: h.pr_id },
          sourceHead: h.source_head,
          targetHead: h.target_head,
        }).catch(() => null)
      : null;
  const read = cacheReader(cache);
  const ctx = { head: h.source_head, mergeBase: cache?.mergeBase ?? null, read, fixes };
  const items: ConsultItem[] = [];
  // Root order: the creation order of each thread.
  const threads = [...byThread([...detail.comments].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)).values()];
  for (const msgs of threads) {
    const t = await threadItem({ msgs, me, ...ctx, reply: replies.get(msgs[0]?.rootId ?? 0) });
    if (t) items.push(t);
  }
  for (const r of findings) items.push(await findingItem(r, ctx));
  const p = detail.pr;
  const head = header({
    key: `${p.project}/${p.repo} #${p.prId}`,
    title: p.title ?? "",
    source: p.sourceBranch,
    target: p.targetBranch,
    head: h.source_head,
    tasks: p.tasks.map((t) => t.key),
    files: detail.files,
  });
  return { head, items };
}

// ---------- Import ----------

type ImportOut = { status: 200; dto: ConsultImportDto; runs: number[] } | { status: 400 | 404 | 409; error: string };

// One transaction. Each row of the plan with an act changes the database. The other rows change nothing.
export async function importAnswer(
  s: ConsultSource,
  prId: number,
  input: { entries: unknown[]; snapshot: Record<string, string> | null },
  now = Date.now(),
): Promise<ImportOut> {
  const data = await consultData(s, prId, false);
  if ("error" in data) return data;
  const rows = planAnswer(data.items, input.entries, input.snapshot);
  const acts = rows.filter(
    (r): r is PlanRow & { item: ConsultItem; verdict: NonNullable<PlanRow["verdict"]> } => r.act !== null && r.item !== null,
  );
  if (!acts.length) return { status: 400, error: "The answer has no entry to apply." };
  const { db } = s;
  const h = db.query(SQL.heads).get({ id: prId }) as Heads;
  const threads = byThread(prDetail(db, s.me, prId)?.comments ?? []);
  const out = { drafts: 0, discarded: 0, marked: 0, ticks: { threads: [] as number[], findings: [] as number[] } };
  const run = db.transaction(() => {
    const id = (
      db.query(SQL.run).get({
        pr: prId,
        key: `consult:${prId}:${now}`,
        source: h.source_head ?? "",
        target: h.target_head ?? "",
        raw: JSON.stringify(input.entries),
        now,
      }) as { id: number }
    ).id;
    for (const r of acts) {
      const target = Number(r.item.id.slice(1));
      if (r.item.kind === "thread") {
        const last = newestLive(threads.get(target) ?? []);
        if (!last) continue;
        const replaced = (db.query(SQL.open).all({ thread: target, pr: prId }) as { id: number; status: "new" | "accepted" }[]).map(
          (x) => ({
            id: x.id,
            was: x.status,
          }),
        );
        for (const x of replaced) db.query(SQL.supersede).run({ id: x.id });
        const body = r.verdict === "accept" ? (r.reply ?? "") : (r.reply ?? r.reason);
        const payload: ReplyPayload & { session: SessionMark } = {
          thread: target,
          action: body ? "reply" : "none",
          body,
          reason: r.reason,
          evidenceStatus: "unverified",
          judgement: r.verdict === "accept" ? "valid" : r.verdict === "reject" ? "invalid" : "question",
          replyTo: last.id,
          session: { run: id, verdict: r.verdict, reason: r.reason, replaced },
        };
        db.query(SQL.reply).run({ run: id, payload: JSON.stringify(payload), body, thread: target });
        out.drafts++;
        if (r.verdict === "accept") out.ticks.threads.push(target);
      } else if (r.verdict === "reject") {
        out.discarded += db.query(SQL.reject).run({ id: target, pr: prId, run: id, reason: r.reason }).changes;
      } else {
        const n = db.query(SQL.mark).run({ id: target, pr: prId, run: id, verdict: r.verdict, reason: r.reason }).changes;
        out.marked += n;
        if (n && r.verdict === "accept") out.ticks.findings.push(target);
      }
    }
    return id;
  })();
  const runs = (db.query(SQL.markedRuns).all({ run }) as { run: number }[]).map((x) => x.run);
  return { status: 200, dto: { run, rows, ...out }, runs };
}

// ---------- Undo ----------

type UndoOut = { status: 200; dto: ConsultUndoDto; runs: number[] } | { status: 404; error: string };

// Discards the session drafts that are not posted, brings back the drafts that they replaced while no newer draft exists, and resets
// the findings that the run marked.
export function undoImport(db: Database, prId: number, run: number): UndoOut {
  if (!db.query(SQL.consultRun).get({ run, pr: prId })) return { status: 404, error: "Paste not found." };
  const runs = (db.query(SQL.markedRuns).all({ run }) as { run: number }[]).map((x) => x.run);
  const dto = db.transaction((): ConsultUndoDto => {
    const out = { drafts: 0, replaced: 0, findings: 0 };
    for (const r of db.query(SQL.drafts).all({ run }) as ItemRow[]) {
      if (!db.query(SQL.discard).run({ id: r.id }).changes) continue;
      out.drafts++;
      const newest = (db.query(SQL.newest).get({ pr: prId, thread: r.thread }) as { id: number | null }).id;
      if (newest !== r.id) continue;
      const mark = (JSON.parse(r.payload_json) as { session?: SessionMark }).session;
      for (const x of mark?.replaced ?? []) out.replaced += db.query(SQL.bringBack).run({ id: x.id, was: x.was }).changes;
    }
    out.findings = db.query(SQL.unmark).run({ run, pr: prId }).changes;
    return out;
  })();
  return { status: 200, dto, runs };
}
