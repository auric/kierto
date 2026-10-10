// Pure inbox view rules (plan G5, D1). The server and the UI use the same rules.
import type { Group, PrRow, Reason } from "./dto";

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

// D3: no commit count in M1.
export const REASON_TEXT: Record<Reason, string> = {
  reply_to_you: "Reply to you",
  review_requested: "Review requested",
  new_commits: "New commits since your review",
  closed: "Closed",
};

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
