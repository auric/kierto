// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Turn rule (plan v3 WP1, prototype/v3 derive()). The server groups rows with it. The UI orders threads with it.
import type { CommentDto } from "./dto";
import { isMe } from "./me";

export type Turn = "your" | "wait" | "other" | "resolved";

export type TurnMsg = Pick<CommentDto, "id" | "rootId" | "authorSlug" | "authorLogin" | "createdAt" | "deleted" | "threadResolved">;

const mineMsg = (m: TurnMsg, me: string | null) => isMe({ slug: m.authorSlug, login: m.authorLogin }, me);

// Newest by created_at, then by comment ID. Deleted messages do not count.
export function newestLive<T extends TurnMsg>(msgs: T[]): T | null {
  let out: T | null = null;
  for (const m of msgs)
    if (!m.deleted && (!out || m.createdAt > out.createdAt || (m.createdAt === out.createdAt && m.id > out.id))) out = m;
  return out;
}

// msgs: the messages of one thread. prAuthor: I authored the PR.
export function threadTurn(msgs: TurnMsg[], me: string | null, prAuthor: boolean): Turn {
  const last = newestLive(msgs);
  if (!last) return "other";
  if (msgs.some((m) => m.threadResolved)) return "resolved";
  if (!prAuthor && !msgs.some((m) => !m.deleted && mineMsg(m, me))) return "other";
  return mineMsg(last, me) ? "wait" : "your";
}

// Threads keyed by root ID, in input order.
export function byThread<T extends TurnMsg>(msgs: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const m of msgs) {
    const t = out.get(m.rootId);
    if (t) t.push(m);
    else out.set(m.rootId, [m]);
  }
  return out;
}
