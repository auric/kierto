// Pure inbox view rules (plan G5, D1). The server and the UI use the same rules.
import type { PrRow, Reason } from "./dto";

const open = (p: PrRow) => p.state === "OPEN";

export const VIEWS = {
  // prototype/index.html:433.
  needs: (p: PrRow) => p.followed && (p.unread > 0 || (open(p) && p.role === "REVIEWER" && p.status !== "APPROVED")),
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

// prototype/index.html:542: unread first, then the newest activity.
export const byInbox = (a: PrRow, b: PrRow) => Number(b.unread > 0) - Number(a.unread > 0) || b.lastActivity - a.lastActivity;
