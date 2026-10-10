// Pure thread rules for the Activity tab. No DOM access, so bun test runs them directly.
import type { CommentDto } from "../../shared/dto";
import { isMe } from "../../shared/me";

export type Msg = CommentDto & { replies: Msg[] };

export type Thread = {
  root: Msg;
  // ms: the newest update in the thread.
  newest: number;
  // The thread holds a highlighted message. A thread without one renders collapsed.
  highlighted: boolean;
  // The divider "New since you last looked" sits above this thread.
  divider: boolean;
};

export type Anchor = { path: string; line?: number; orphaned?: boolean };

export function anchorOf(c: Pick<CommentDto, "anchor">): Anchor | null {
  const a = c.anchor as Partial<Anchor> | null;
  return a && typeof a.path === "string" ? (a as Anchor) : null;
}

// Highlights keep the set captured at open and add every message that is unread now. A deleted message is never unread.
export function mergeHighlights(prev: ReadonlySet<number>, comments: CommentDto[]): ReadonlySet<number> {
  const add = comments.filter((c) => c.unread && !prev.has(c.id));
  return add.length ? new Set([...prev, ...add.map((c) => c.id)]) : prev;
}

// Comments come in created_at order. Threads sort oldest first by their newest message, as in prototype/index.html.
// atOpen: the ids that were unread when the PR opened. Only they place the divider.
export function buildThreads(comments: CommentDto[], highlight: ReadonlySet<number>, atOpen: ReadonlySet<number>): Thread[] {
  const byId = new Map<number, Msg>(comments.map((c) => [c.id, { ...c, replies: [] }]));
  const roots: Msg[] = [];
  for (const m of byId.values()) {
    // A reply whose parent is not stored hangs under its root, or becomes a root itself.
    const parent = byId.get(m.parentId ?? -1) ?? (m.rootId !== m.id ? byId.get(m.rootId) : undefined);
    if (parent) parent.replies.push(m);
    else roots.push(m);
  }
  const walk = (m: Msg, fn: (m: Msg) => void) => {
    fn(m);
    for (const r of m.replies) walk(r, fn);
  };
  const threads = roots.map((root) => {
    let newest = 0;
    let highlighted = false;
    let fresh = false;
    walk(root, (m) => {
      newest = Math.max(newest, m.updatedAt, m.createdAt);
      highlighted ||= highlight.has(m.id);
      fresh ||= atOpen.has(m.id);
    });
    return { root, newest, highlighted, divider: fresh };
  });
  threads.sort((a, b) => a.newest - b.newest || a.root.id - b.root.id);
  let placed = false;
  for (const t of threads) {
    t.divider = t.divider && !placed;
    placed ||= t.divider;
  }
  return threads;
}

// My root comments on threads that are not resolved.
export const openThreads = (comments: CommentDto[], me: string | null) =>
  comments.filter(
    (c) =>
      c.id === c.rootId && c.parentId === null && !c.deleted && !c.threadResolved && isMe({ slug: c.authorSlug, login: c.authorLogin }, me),
  );
