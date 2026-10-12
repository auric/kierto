// Pure publish UI rules (plan v3 WP14a, docs/plans/replies.md step 4). No DOM access, so bun test runs them directly.
import type { CommentDto, PlannedPost, PostDestination, PostDto } from "../../shared/dto";
import { commentLines } from "../../shared/types";
import { lineText, plural } from "../review/model";

const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// prototype/v3 destText: "2 inline comments and 1 general comment".
export function destText(posts: { destination: PostDestination }[]): string {
  const n = (k: PostDestination["kind"]) => posts.filter((p) => p.destination.kind === k).length;
  return [
    n("inline") ? plural(n("inline"), "inline comment") : "",
    n("general") ? plural(n("general"), "general comment") : "",
    n("reply") ? plural(n("reply"), "reply", "replies") : "",
  ]
    .filter(Boolean)
    .join(" and ")
    .replace(/ and (?=.* and )/, ", ");
}

// Every item of the plan with the revision on screen. Confirm sends exactly these (WP13a).
export const planItems = (posts: PlannedPost[]) => posts.flatMap((p) => p.items);

export type Who = { name: string; place: string };

// The author and the place of the comment that a reply answers. null: the comment is not in the stored detail.
export function parentOf(parentId: number, comments: CommentDto[]): Who | null {
  const c = comments.find((x) => x.id === parentId);
  if (!c) return null;
  const root = comments.find((x) => x.id === c.rootId) ?? c;
  return { name: c.authorName ?? c.authorSlug, place: placeOf(root) };
}

// The place of a thread, from its root comment.
export function placeOf(root: Pick<CommentDto, "anchor" | "excerpt">): string {
  const a = root.anchor as { path?: unknown } | null;
  if (!a || typeof a.path !== "string") return "the general comment";
  const lines = commentLines(root);
  return lines === undefined ? a.path : `${a.path}:${lineText(lines)}`;
}

// replies.md step 4: "Reply to <name> in <place>".
export const replyText = (who: Who) => `Reply to ${who.name} in ${who.place}`;

// The destination words of a planned post or an outbox row.
export function destLabel(d: PostDestination, comments: CommentDto[]): { code: string | null; text: string } {
  switch (d.kind) {
    case "inline":
      return { code: `${base(d.path)}:${d.lineEnd > d.line ? `${d.line}–${d.lineEnd}` : d.line}`, text: "Inline comment" };
    case "general":
      return { code: null, text: "General comment" };
    default: {
      const who = parentOf(d.parentId, comments);
      return { code: null, text: who ? replyText(who) : "Reply" };
    }
  }
}

export type PostView = {
  // posting: pending or sent. checking: unknown while the app reads the remote comments.
  kind: "posting" | "checking" | "unknown" | "failed" | "posted";
  text: string;
  reason: string | null;
  // again: retry. general: drop a failed inline post into the next general comment.
  actions: ("again" | "drop" | "general")[];
};

// Plan v3 section 7 and replies.md step 4: Posting, "Outcome unknown. Checking.", Failed with the reason, and Posted.
export function postView(p: PostDto): PostView {
  switch (p.state) {
    case "pending":
    case "sent":
      return { kind: "posting", text: "Posting…", reason: null, actions: [] };
    case "unknown":
      return p.checking
        ? { kind: "checking", text: "Outcome unknown. Checking.", reason: null, actions: ["again", "drop"] }
        : { kind: "unknown", text: "Outcome unknown.", reason: p.lastError, actions: ["again", "drop"] };
    case "failed":
      return {
        kind: "failed",
        text: "Failed.",
        reason: p.lastError ?? "No reason was recorded.",
        actions: p.destination.kind === "inline" ? ["again", "general", "drop"] : ["again", "drop"],
      };
    default:
      return { kind: "posted", text: "Posted.", reason: null, actions: [] };
  }
}

// A confirmed row shows until the synced comment with its remote ID arrives. Then the thread shows the comment.
export function shownPosts(posts: PostDto[], comments: CommentDto[]): PostDto[] {
  const ids = new Set(comments.map((c) => c.id));
  return posts.filter((p) => p.state !== "confirmed" || p.remoteId === null || !ids.has(p.remoteId));
}

// Reply rows go to the thread of their parent. Other rows, and replies to a comment that is not stored, go to the outbox group.
export function splitPosts(posts: PostDto[], comments: CommentDto[]): { threads: Map<number, PostDto[]>; rest: PostDto[] } {
  const root = new Map(comments.map((c) => [c.id, c.rootId]));
  const threads = new Map<number, PostDto[]>();
  const rest: PostDto[] = [];
  for (const p of posts) {
    const tid = p.destination.kind === "reply" ? root.get(p.destination.parentId) : undefined;
    if (tid === undefined) rest.push(p);
    else threads.set(tid, [...(threads.get(tid) ?? []), p]);
  }
  return { threads, rest };
}

// The rows of one confirm or reply in the cache. A new row of the same ID replaces the old one.
export const mergePosts = (old: PostDto[] | undefined, rows: PostDto[]): PostDto[] =>
  [...(old ?? []).filter((p) => !rows.some((r) => r.id === p.id)), ...rows].sort((a, b) => a.id - b.id);

// ---------- Reply composer ----------

// key: the idempotency key of the next send. used: a request went out with this key, so a text change needs a new key.
export type ReplyDraft = { text: string; key: string; used: boolean };

// replies.md step 4: unsent text stays in localStorage under rl:reply:<pr>:<thread>.
export const draftKey = (pr: number, thread: number) => `rl:reply:${pr}:${thread}`;

export function parseDraft(raw: string | null): ReplyDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<ReplyDraft>;
    return typeof d.text === "string" && typeof d.key === "string" && typeof d.used === "boolean"
      ? { text: d.text, key: d.key, used: d.used }
      : null;
  } catch {
    return null;
  }
}

// A text change after a send gets a new key. The old key keeps its text on the server (WP13a: 409 for another text).
export const editDraft = (d: ReplyDraft, text: string, newKey: () => string): ReplyDraft =>
  d.used && text !== d.text ? { text, key: newKey(), used: false } : { ...d, text };
