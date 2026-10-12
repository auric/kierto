// Publish plan (plan v3 WP12). Pure: the exact comments that a confirm posts for the accepted items.
import type { PlannedPost, ReviewItemDto } from "../../shared/dto";
import { fileUrl } from "../../shared/links";
import { isMe } from "../../shared/me";
import type { AnchoredFinding, Question, ReplyPayload } from "../../shared/review";
import { anchorSpan } from "../../shared/types";

// repoUrl: the repository browse link of the PR (plan v3 WP4). Absent or null: file references stay plain text.
export type PlanRun = { id: number; sourceHead: string; targetHead: string; mergeBase: string | null; repoUrl?: string | null };
// A live root comment. anchor: the stored forge anchor, absent for a general comment.
export type PlanComment = { id: number; authorSlug: string; authorLogin: string | null; authorName: string | null; anchor: unknown };
// mark: the markAi setting at build time. The outbox keeps the built body, so a later change never alters a queued row.
export type PlanInput = { me: string | null; mark: boolean; runs: PlanRun[]; items: ReviewItemDto[]; comments: PlanComment[] };

export const AI_MARK = "🤖 ";
// A body that already starts with the robot emoji gets no second mark.
const marked = (body: string) => (body.startsWith(AI_MARK.trimEnd()) ? body : AI_MARK + body);

// plan v3 WP12: `[path:line](fileUrl)`. Without the browse link or the commit, the plain "path:line" stays. src/shared/links.ts holds the URL form.
export const fileRef = ({ repoUrl }: Pick<PlanRun, "repoUrl">, path: string, at: string | null, line: number) => {
  const text = `${path}:${line}`;
  return repoUrl && at ? `[${text.replace(/[\\[\]]/g, "\\$&")}](${fileUrl(repoUrl, path, at, line)})` : text;
};

type Raw = { path?: unknown; line?: unknown; lineType?: unknown; fileType?: unknown } | null;

// at.line: the new-side line of the finding. at.srcLine: its old-side line, for a ctx line only.
function duplicate(
  comments: PlanComment[],
  me: string | null,
  at: { path: string; line: number; srcLine?: number },
): PlannedPost["duplicate"] {
  for (const c of comments) {
    const a = c.anchor as Raw;
    if (!a || a.path !== at.path || typeof a.line !== "number") continue;
    // Gate A U2: a range anchor covers each new-side line of its span.
    // Gate v3 U4: a CONTEXT anchor holds the old-side line, whatever fileType says. Any other FROM anchor is a removed line.
    const span = anchorSpan(a);
    if (
      span
        ? at.line < span.line || at.line > span.lineEnd
        : a.line !== (a.lineType === "CONTEXT" ? at.srcLine : a.fileType === "FROM" ? undefined : at.line)
    )
      continue;
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
  const text = input.mark ? marked : (body: string) => body;
  for (const run of input.runs) {
    const heads = { run: run.id, sourceHead: run.sourceHead, targetHead: run.targetHead, mergeBase: run.mergeBase };
    const items = input.items.filter((i) => i.run === run.id && i.status === "accepted").sort((a, b) => a.id - b.id);
    const general: { ref: string; body: string }[] = [];
    const questions: { body: string; why: string }[] = [];
    const generalItems: PlannedPost["items"] = [];
    for (const it of items) {
      const ref = { id: it.id, revision: it.revision };
      const a = it.anchor;
      // R15: a reply item has no anchor, but it never joins the general comment.
      if (it.kind === "reply") {
        const parentId = (it.payload as ReplyPayload).replyTo;
        out.push({ ...heads, destination: { kind: "reply", parentId }, body: text(it.body), items: [ref], duplicate: null });
        continue;
      }
      if (it.kind === "question" || !a) {
        questions.push({ body: it.body, why: (it.payload as Question).why });
        generalItems.push(ref);
        continue;
      }
      // exact and moved anchors lie in the diff. A new-side diff line is an added or a context line.
      // Gate v3 U4: a context line posts with its old-side line. An excerpt stored without it sends the finding to the general comment.
      const hit = a.side === "new" && a.state !== "outside" ? a.excerpt.find((l) => l.n === a.line && l.kind !== "del") : undefined;
      if (hit?.kind === "add" || hit?.old !== undefined) {
        const srcPath = (it.payload as AnchoredFinding).anchor.oldPath;
        const srcLine = hit.kind === "ctx" ? { srcLine: hit.old } : {};
        out.push({
          ...heads,
          destination: {
            kind: "inline",
            path: a.path,
            srcPath,
            line: a.line,
            lineEnd: a.lineEnd,
            lineType: hit.kind === "ctx" ? "ctx" : "add",
            ...srcLine,
          },
          body: text(it.body),
          items: [ref],
          duplicate: duplicate(input.comments, input.me, { path: a.path, line: a.line, ...srcLine }),
        });
        continue;
      }
      // D3: a removed line has its number at the merge base, in the old path of a rename.
      const old = a.side === "old";
      general.push({
        ref: fileRef(run, old ? (a.oldPath ?? a.path) : a.path, old ? run.mergeBase : run.sourceHead, a.line),
        body: it.body,
      });
      generalItems.push(ref);
    }
    if (generalItems.length)
      out.push({
        ...heads,
        destination: { kind: "general" },
        body: text(generalText(general, questions)),
        items: generalItems,
        duplicate: null,
      });
  }
  return out;
}
