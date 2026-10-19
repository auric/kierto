// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Pure inbox view rules (plan G5, D1). The server and the UI use the same rules.
import type { Group, PrRow } from "./dto";

const open = (p: PrRow) => p.state === "OPEN";

export const VIEWS = {
  // prototype/v3 VIEWS.needs. A read your-turn thread keeps the PR here (user decision).
  needs: (p: PrRow) => p.followed && (p.unread > 0 || p.yourTurn > 0 || (open(p) && p.role === "REVIEWER" && p.status !== "APPROVED")),
  reviewing: (p: PrRow) => open(p) && p.role === "REVIEWER" && (p.onDashboard || p.followed),
  mine: (p: PrRow) => open(p) && p.role === "AUTHOR" && (p.onDashboard || p.followed),
  // D1: every followed PR in any state.
  following: (p: PrRow) => p.followed,
} as const;

export type View = keyof typeof VIEWS;

export const VIEW_LABEL: Record<View, string> = { needs: "Needs you", reviewing: "Reviewing", mine: "My PRs", following: "Following" };

// prototype/v3 GROUPS. Each list group names its reasons in display order.
export const GROUPS = [
  ["needs", "Needs you", ["your", "triage", "review", "commits", "comments"]],
  ["waiting", "Waiting on others", ["waiting"]],
  ["done", "Done", ["quiet", "closed"]],
] as const satisfies readonly (readonly [string, string, readonly Group[]])[];

const ORDER: readonly Group[] = GROUPS.flatMap((g) => g[2]);

// prototype/v3 byReason: reason order, then unread first, then the newest activity.
export const byInbox = (a: PrRow, b: PrRow) =>
  ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || Number(b.unread > 0) - Number(a.unread > 0) || b.lastActivity - a.lastActivity;

// The Archive view: the PRs that no other view shows (plan m1: archived, or unfollowed and off the dashboard).
// GET /api/archive gives these rows, GET /api/prs gives the others. Sync does not check their comments.
export const archived = (p: Pick<PrRow, "archivedAt" | "followed" | "onDashboard">) =>
  p.archivedAt !== null || (!p.followed && !p.onDashboard);

// Newest first. An unfollowed PR has no unfollow time, so its last activity stands in.
export const byArchive = (a: PrRow, b: PrRow) => (b.archivedAt ?? b.lastActivity) - (a.archivedAt ?? a.lastActivity) || b.id - a.id;
