// Publish plan (plan v3 WP12). Pure: the exact comments that a confirm posts for the accepted items.
import type { PlannedPost, ReviewItemDto } from "../../shared/dto";
import { isMe } from "../../shared/me";
import type { AnchoredFinding, Question } from "../../shared/review";

export type PlanRun = { id: number; sourceHead: string; targetHead: string; mergeBase: string | null };
// A live root comment. anchor: the stored forge anchor, absent for a general comment.
export type PlanComment = { id: number; authorSlug: string; authorLogin: string | null; authorName: string | null; anchor: unknown };
export type PlanInput = { me: string | null; runs: PlanRun[]; items: ReviewItemDto[]; comments: PlanComment[] };

// ponytail: plain "path:line" until Gate A confirms the browse-link suffix (U5). WP4 makes it `[path:line](fileUrl)`.
export const fileRef = (path: string, _at: string | null, line: number) => `${path}:${line}`;

type Inline = { path: string; line: number };
const anchorOf = (a: unknown): (Inline & { fileType?: unknown }) | null => {
  const x = a as { path?: unknown; line?: unknown; fileType?: unknown } | null;
  return x && typeof x.path === "string" && typeof x.line === "number" ? { path: x.path, line: x.line, fileType: x.fileType } : null;
};

function duplicate(comments: PlanComment[], me: string | null, at: Inline): PlannedPost["duplicate"] {
  for (const c of comments) {
    const a = anchorOf(c.anchor);
    // fileType FROM numbers the line on the old side. New-side findings never match it.
    if (!a || a.path !== at.path || a.line !== at.line || a.fileType === "FROM") continue;
    if (isMe({ slug: c.authorSlug, login: c.authorLogin }, me)) continue;
    return { commentId: c.id, author: c.authorName ?? c.authorSlug };
  }
  return null;
}

// One general comment: each outside or old-side finding with its file line, then the questions (prototype 1698-1701).
export function generalText(findings: { ref: string; body: string }[], questions: { body: string; why: string }[]): string {
  const qs = questions.map((q) => `${q.body} ${q.why}`);
  return [
    ...findings.map((f) => `${f.ref}: ${f.body}`),
    ...(qs.length === 1 ? qs : qs.length ? [`Questions:\n\n${qs.map((q) => `- ${q}`).join("\n")}`] : []),
  ].join("\n\n");
}

export function buildPlan(input: PlanInput): PlannedPost[] {
  const out: PlannedPost[] = [];
  for (const run of input.runs) {
    const heads = { run: run.id, sourceHead: run.sourceHead, targetHead: run.targetHead, mergeBase: run.mergeBase };
    const items = input.items.filter((i) => i.run === run.id && i.status === "accepted").sort((a, b) => a.id - b.id);
    const general: { ref: string; body: string }[] = [];
    const questions: { body: string; why: string }[] = [];
    const generalItems: PlannedPost["items"] = [];
    for (const it of items) {
      const ref = { id: it.id, revision: it.revision };
      const a = it.anchor;
      if (it.kind === "question" || !a) {
        questions.push({ body: it.body, why: (it.payload as Question).why });
        generalItems.push(ref);
        continue;
      }
      // exact and moved anchors lie in the diff. A new-side diff line is an added or a context line.
      if (a.side === "new" && a.state !== "outside") {
        const srcPath = (it.payload as AnchoredFinding).anchor.oldPath;
        const add = a.excerpt.some((l) => l.n === a.line && l.kind === "add");
        out.push({
          ...heads,
          destination: { kind: "inline", path: a.path, srcPath, line: a.line, lineEnd: a.lineEnd, lineType: add ? "add" : "ctx" },
          body: it.body,
          items: [ref],
          duplicate: duplicate(input.comments, input.me, a),
        });
        continue;
      }
      // D3: a removed line has its number at the merge base, in the old path of a rename.
      const old = a.side === "old";
      general.push({ ref: fileRef(old ? (a.oldPath ?? a.path) : a.path, old ? run.mergeBase : run.sourceHead, a.line), body: it.body });
      generalItems.push(ref);
    }
    if (generalItems.length)
      out.push({ ...heads, destination: { kind: "general" }, body: generalText(general, questions), items: generalItems, duplicate: null });
  }
  return out;
}
