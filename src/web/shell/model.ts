// Pure list and sidebar rules. No DOM access, so bun test runs them directly.

import type { CheckpointDto, PrRow, SyncStatus } from "../../shared/dto";
import { parsePrUrl } from "../../shared/pr-url";
import type { PrRef } from "../../shared/types";
import { REASON_TEXT, VIEWS, type View } from "../../shared/views";

export const repoOf = (p: Pick<PrRow, "project" | "repo">) => `${p.project}/${p.repo}`;
export const prKey = (p: Pick<PrRow, "project" | "repo" | "prId">) => `${repoOf(p)} #${p.prId}`;

export type Tone = "new" | "reason" | "muted" | "warn";
export type BadgeInfo = { text: string; tone: Tone };

const CLOSED_TEXT: Record<string, string> = { MERGED: "Merged", DECLINED: "Declined" };

// Status is always text. Color only repeats it.
export function badges(p: PrRow): BadgeInfo[] {
  const out: BadgeInfo[] = [];
  if (p.unread > 0) out.push({ text: `${p.unread} new`, tone: "new" });
  for (const r of p.reasons) {
    if (r === "closed") out.push({ text: CLOSED_TEXT[p.state ?? ""] ?? REASON_TEXT.closed, tone: "muted" });
    else out.push({ text: REASON_TEXT[r], tone: r === "new_commits" ? "muted" : "reason" });
  }
  if (p.onDashboard && !p.followed) out.push({ text: "Not followed", tone: "muted" });
  return out;
}

export const REASON_LABEL: Record<NonNullable<CheckpointDto["reason"]>, string> = {
  network: "no answer from Bitbucket",
  timeout: "Bitbucket timed out",
  auth: "Bitbucket rejected the token",
  forbidden: "no access",
  not_found: "not found on Bitbucket",
  rate: "rate limited",
  server: "Bitbucket server error",
  shape: "unexpected response",
  cursor: "paging stopped early",
  page_limit: "too many pages",
  gap: "a comment is missing from the activities",
};

// null when the last check of this PR was complete.
export function incompleteText(c: CheckpointDto | null): string | null {
  return c?.reason ? `Last check incomplete: ${REASON_LABEL[c.reason]}` : null;
}

export function viewCounts(prs: PrRow[]): Record<View, number> {
  const out = { needs: 0, reviewing: 0, mine: 0, following: 0 };
  for (const p of prs) for (const v of Object.keys(VIEWS) as View[]) if (VIEWS[v](p)) out[v]++;
  return out;
}

export type RepoCount = { repo: string; unread: number };

export function repoCounts(prs: PrRow[]): RepoCount[] {
  const m = new Map<string, number>();
  for (const p of prs) m.set(repoOf(p), (m.get(repoOf(p)) ?? 0) + p.unread);
  return [...m].map(([repo, unread]) => ({ repo, unread })).sort((a, b) => a.repo.localeCompare(b.repo));
}

export const unreadTotal = (prs: PrRow[]) => prs.reduce((n, p) => n + p.unread, 0);

export function filterRows(prs: PrRow[], view: View, repo: string | null, q: string): PrRow[] {
  const needle = q.trim().toLowerCase();
  return prs.filter(
    (p) =>
      VIEWS[view](p) &&
      (!repo || repoOf(p) === repo) &&
      (!needle || [p.title, prKey(p), p.authorName, p.authorSlug].some((s) => s?.toLowerCase().includes(needle))),
  );
}

// A filter text that is a PR URL on the configured origin. The server checks the origin again.
export function followCandidate(q: string, baseUrl: string | null): PrRef | null {
  if (!baseUrl || !/^https?:\/\//i.test(q.trim())) return null;
  try {
    return parsePrUrl(q.trim(), baseUrl);
  } catch {
    return null;
  }
}

export function initials(name: string | null): string {
  const words = (name ?? "").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]?.[0]}${words.at(-1)?.[0]}` : (words[0]?.slice(0, 2) ?? "?")).toUpperCase();
}

export function ago(ms: number, now: number): string {
  const m = Math.floor((now - ms) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export type StatusInfo = { text: string; tone: "ok" | "busy" | "warn" | "error" | "idle" };

export function statusInfo(s: SyncStatus, now: number): StatusInfo {
  if (s.running) return { text: "Checking…", tone: "busy" };
  const last = s.lastCompleteAt === null ? "never" : clock(s.lastCompleteAt);
  switch (s.state) {
    case "ok":
      return { text: `Checked ${last}`, tone: "ok" };
    case "offline": {
      const next = s.nextAt === null ? "" : ` Next try in ${Math.max(0, Math.ceil((s.nextAt - now) / 1000))} s.`;
      return { text: `Offline. Last checked ${last}.${next}`, tone: "warn" };
    }
    case "auth":
      return { text: "Bitbucket rejected the token", tone: "error" };
    case "unconfigured":
      return { text: "Not configured", tone: "idle" };
    case "error":
      return { text: s.error ?? "Check failed", tone: "error" };
    default:
      return { text: "Waiting for the first check", tone: "idle" };
  }
}
