// Pure thread rules for the detail pane (prototype/v3 derive, foldPlan, tree). No DOM access, so bun test runs them directly.
import type { CommentDto, ExcerptLine, PrRow } from "../../shared/dto";
import { isMe } from "../../shared/me";
import { newestLive, type Turn, threadTurn } from "../../shared/turn";
import { commentLine } from "../../shared/types";
import { clock } from "../shell/model";

// line: the line that the excerpt marks (commentLine).
export type Anchor = { path: string; line?: number; orphaned?: boolean };

export function anchorOf(c: Pick<CommentDto, "anchor" | "excerpt">): Anchor | null {
  const a = c.anchor as Partial<Anchor> | null;
  return a && typeof a.path === "string" ? { ...(a as Anchor), line: commentLine(c) } : null;
}

// Highlights keep the set captured at open and add every message that is unread now. A deleted message is never unread.
export function mergeHighlights(prev: ReadonlySet<number>, comments: CommentDto[]): ReadonlySet<number> {
  const add = comments.filter((c) => c.unread && !prev.has(c.id));
  return add.length ? new Set([...prev, ...add.map((c) => c.id)]) : prev;
}

// slug: the avatar hue key.
export type Person = { slug: string; name: string; me: boolean };

// isNew: highlighted. hasNew: the message or a reply below it is new. size: the message and all replies below it.
export type Node = CommentDto & { who: Person; parent: Node | null; kids: Node[]; size: number; isNew: boolean; hasNew: boolean };

// spine: the middle of the main line, keyed by its first message. cont: the first kept message after the fold.
export type Fold = { kind: "spine"; n: number; cont: number } | { kind: "branch" };

export type ThreadModel = {
  // The root comment ID.
  id: number;
  root: Node;
  // Time order.
  msgs: Node[];
  anchor: Anchor | null;
  turn: Turn;
  // The newest live message. null when every message is deleted.
  last: Node | null;
  // ms: the newest message.
  newest: number;
  // The count of new messages.
  fresh: number;
  // Threads open when they need you.
  open: boolean;
  people: Person[];
  waitOn: Person | null;
  task: "open" | "done" | null;
  // Keys are message IDs.
  fold: Map<number, Fold>;
};

export const TURN_ORDER: readonly Turn[] = ["your", "wait", "other", "resolved"];

const byTime = (a: CommentDto, b: CommentDto) => a.createdAt - b.createdAt || a.id - b.id;

type PrInfo = Pick<PrRow, "role" | "authorSlug" | "authorName">;

// Threads in time order of their roots. hl: the highlighted message IDs.
export function buildThreads(comments: CommentDto[], hl: ReadonlySet<number>, me: string | null, pr: PrInfo): ThreadModel[] {
  const person = (slug: string, name: string | null, login: string | null): Person => ({
    slug,
    name: name ?? slug,
    me: isMe({ slug, login }, me),
  });
  const byId = new Map<number, Node>();
  for (const c of [...comments].sort(byTime)) {
    byId.set(c.id, {
      ...c,
      who: person(c.authorSlug, c.authorName, c.authorLogin),
      parent: null,
      kids: [],
      size: 1,
      isNew: hl.has(c.id),
      hasNew: false,
    });
  }
  const roots: Node[] = [];
  for (const m of byId.values()) {
    // A reply whose parent is not stored hangs under its root, or becomes a root itself.
    const parent = byId.get(m.parentId ?? -1) ?? (m.rootId !== m.id ? byId.get(m.rootId) : undefined);
    m.parent = parent ?? null;
    if (parent) parent.kids.push(m);
    else roots.push(m);
  }
  const author = pr.authorSlug ? person(pr.authorSlug, pr.authorName, null) : null;
  return roots.map((root) => {
    const msgs = dfs(root).sort(byTime);
    for (const x of [...msgs].reverse()) {
      x.size = 1 + x.kids.reduce((n, k) => n + k.size, 0);
      x.hasNew = x.isNew || x.kids.some((k) => k.hasNew);
    }
    const live = msgs.filter((m) => !m.deleted);
    const last = newestLive(msgs);
    const turn = threadTurn(msgs, me, pr.role === "AUTHOR");
    const fresh = msgs.filter((m) => m.isNew).length;
    const people = [...new Map(live.map((m) => [m.who.slug, m.who])).values()];
    const other = live.findLast((m) => !m.who.me)?.who ?? (author && !author.me ? author : null);
    return {
      id: root.id,
      root,
      msgs,
      anchor: anchorOf(root),
      turn,
      last,
      newest: Math.max(...msgs.map((m) => m.createdAt)),
      fresh,
      open: fresh > 0 || turn === "your",
      people,
      waitOn: turn === "wait" ? other : null,
      task: live.find((m) => m.task)?.task ?? null,
      fold: foldPlan(root, last ?? root),
    };
  });
}

// Depth first, replies in time order. This is the render order.
const dfs = (x: Node): Node[] => [x, ...x.kids.flatMap(dfs)];

// prototype/v3 foldPlan(). A fold never hides a new message.
function foldPlan(root: Node, last: Node): Map<number, Fold> {
  const plan = new Map<number, Fold>();
  // The main line runs from the root to the newest message.
  const s: Node[] = [];
  for (let x: Node | null = last; x; x = x.parent) s.unshift(x);
  const len = s.length;
  // Long main line: the root and the newest replies stay. Read replies between them fold if that hides 2 or more.
  const regionNew = (i: number) => !!s[i]?.isNew || !!s[i]?.kids.some((k) => k !== s[i + 1] && k.hasNew);
  let firstNew = -1;
  for (let i = 1; i < len && firstNew < 0; i++) if (regionNew(i)) firstNew = i;
  const keep = Math.min(firstNew < 0 ? 2 : Math.max(2, len - firstNew), len - 1);
  const first = s[1];
  const cont = s[len - keep];
  if (len - keep > 1 && first && cont && first.size - cont.size > 1)
    plan.set(first.id, { kind: "spine", n: first.size - cont.size, cont: cont.id });
  // Side branch: a read branch of more than 2 messages folds to one line.
  const on = new Set(s);
  const walk = (x: Node) => {
    for (const k of x.kids) {
      if (!on.has(k) && !k.hasNew && k.size > 2) plan.set(k.id, { kind: "branch" });
      else walk(k);
    }
  };
  walk(root);
  return plan;
}

// "Need me": your turn, or a new message.
export const passes = (t: ThreadModel, needMe: boolean) => !needMe || t.turn === "your" || t.fresh > 0;

// Fixed thread order: your turn, waiting, others, resolved. Newest first in each group.
export const ordered = (threads: ThreadModel[], needMe: boolean) =>
  TURN_ORDER.flatMap((k) => threads.filter((t) => t.turn === k && passes(t, needMe)).sort((a, b) => b.newest - a.newest || b.id - a.id));

// The thread rows on screen. Resolved threads stay behind "Show N resolved" until the user opens them or the filter is on.
export const shownThreads = (threads: ThreadModel[], needMe: boolean, showResolved: boolean) =>
  ordered(threads, needMe).filter((t) => t.turn !== "resolved" || showResolved || needMe);

// [thread, message] of each new message, in thread order and then in tree order.
export const newMessages = (threads: ThreadModel[]): [number, number][] =>
  threads.flatMap((t) => dfs(t.root).flatMap((x): [number, number][] => (x.isNew ? [[t.id, x.id]] : [])));

export function summary(threads: ThreadModel[]) {
  return {
    your: threads.filter((t) => t.turn === "your").length,
    unresolved: threads.filter((t) => t.turn !== "resolved").length,
    tasks: threads.reduce((n, t) => n + t.msgs.filter((m) => m.task === "open" && !m.deleted).length, 0),
  };
}

export const firstName = (p: Person) => (p.me ? "you" : (p.name.split(/\s+/)[0] ?? p.name));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Others first, then "you": "Lena and you", "Dan, Lena, and you".
export function names(people: Person[]): string {
  const ns = [...people.filter((p) => !p.me).map(firstName), ...(people.some((p) => p.me) ? ["you"] : [])];
  return cap(ns.length < 3 ? ns.join(" and ") : `${ns.slice(0, -1).join(", ")}, and ${ns.at(-1)}`);
}

export function turnText(t: ThreadModel): string {
  switch (t.turn) {
    case "your":
      return "Your turn";
    case "wait":
      return t.waitOn ? `Waiting on ${cap(firstName(t.waitOn))}` : "Waiting on reviewers";
    case "other":
      return t.people.length ? `Between ${names(t.people)}` : "All messages deleted";
    default:
      return "Resolved";
  }
}

// One fold row: closed, or open above the message it starts with.
export type FoldRow =
  | { kind: "spine"; at: number; open: boolean; n: number }
  | { kind: "branch"; at: number; open: boolean; people: Person[]; count: number; newest: number };

// One list item of the reply tree. msg is null for a closed fold row. kids render in a nested list.
export type Li = { fold: FoldRow | null; msg: Node | null; quote: boolean; kids: Li[]; foot: boolean };

// Reply levels stop here. Deeper replies stay at this level and quote the message they answer.
export const CAP = 4;

// prototype/v3 tree(). The open folds come from the user. foot: the turn line after the root.
export function layout(t: ThreadModel, open: { spine: boolean; branches: ReadonlySet<number> }): Li[] {
  // The message rendered just above. A reply to any other message shows a quote.
  let prev: number | null = null;
  const items = (x: Node, lv: number, flat: boolean, head: FoldRow | null = null, foot = false): Li[] => {
    const quote = !!x.parent && (flat || x.parent.id !== prev);
    prev = x.id;
    const deep = lv >= CAP;
    const kids = x.kids.flatMap((k) => child(k, deep ? CAP : lv + 1, deep));
    const li: Li = { fold: head, msg: x, quote, kids: deep ? [] : kids, foot };
    return deep ? [li, ...kids] : [li];
  };
  const child = (x: Node, lv: number, flat: boolean): Li[] => {
    const f = t.fold.get(x.id);
    if (!f) return items(x, lv, flat);
    const isOpen = f.kind === "spine" ? open.spine : open.branches.has(x.id);
    const row: FoldRow =
      f.kind === "spine"
        ? { kind: "spine", at: x.id, open: isOpen, n: f.n }
        : (() => {
            const ms = dfs(x);
            const people = [...new Map(ms.map((m) => [m.who.slug, m.who])).values()].sort((a, b) => Number(a.me) - Number(b.me));
            return { kind: "branch", at: x.id, open: isOpen, people, count: ms.length, newest: Math.max(...ms.map((m) => m.createdAt)) };
          })();
    if (isOpen) return items(x, lv, flat, row);
    prev = null;
    const fold: Li = { fold: row, msg: null, quote: false, kids: [], foot: false };
    if (f.kind === "branch") return [fold];
    // The kept replies of the main line continue below the fold row.
    const cont = t.msgs.find((m) => m.id === f.cont);
    if (!cont) return [fold];
    const deep = lv >= CAP;
    const rest = items(cont, deep ? CAP : lv + 1, deep);
    return deep ? [fold, ...rest] : [{ ...fold, kids: rest }];
  };
  return items(t.root, 1, false, null, t.turn === "your" || t.turn === "wait");
}

// The folds to open so that message id shows.
export function reveal(t: ThreadModel, id: number): { spine: boolean; branches: number[] } {
  const out = { spine: false, branches: [] as number[] };
  const x = t.msgs.find((m) => m.id === id);
  for (let a: Node | null | undefined = x; a; a = a.parent) {
    const f = t.fold.get(a.id);
    if (f?.kind === "branch") out.branches.push(a.id);
    if (f?.kind === "spine") {
      let kept = false;
      for (let y: Node | null | undefined = x; y; y = y.parent) if (y.id === f.cont) kept = true;
      if (!kept) out.spine = true;
    }
  }
  return out;
}

// An inline thread opens its excerpt after the last commented line. The discussion sits in the gap.
export function splitExcerpt(lines: ExcerptLine[]): { head: ExcerptLine[]; tail: ExcerptLine[] } {
  const cut = lines.findLastIndex((l) => l.hit) + 1;
  return cut ? { head: lines.slice(0, cut), tail: lines.slice(cut) } : { head: lines, tail: [] };
}

// Avatar hue: FNV-1a of the user slug into 8 fixed slots (prototype/v3 hueOf).
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193);
  return h >>> 0;
}
export const hueOf = (slug: string) => fnv1a(slug) % 8;

// The last visit: "today 14:02", "yesterday 14:02", or the date and the time.
export function visitText(ms: number, now: number): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((day(now) - day(ms)) / 86_400_000);
  const date =
    days === 0 ? "today" : days === 1 ? "yesterday" : new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${date} ${clock(ms)}`;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// For screen readers: "just now", "5 minutes ago", "2 hours ago", "3 days ago".
export function agoLong(ms: number, now: number): string {
  const m = Math.floor((now - ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${plural(m, "minute")} ago`;
  if (m < 1440) return `${plural(Math.floor(m / 60), "hour")} ago`;
  return `${plural(Math.floor(m / 1440), "day")} ago`;
}

// One line of plain text, cut at n characters.
export function snippet(text: string | null, n: number): string {
  const t = (text ?? "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
