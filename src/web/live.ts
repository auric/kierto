// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// One EventSource per tab. EventSource reconnects by itself.
import type { InvalidateQueryFilters, QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

// Dispatches "events" when the server stored new notification events.
export const liveEvents = new EventTarget();

// The queries that one "changed" event makes stale.
// The diff keys stay out: diffRefresh refetches them when the source head changes. A review run fills the missing code, so an index that asks for it refetches.
export function changedFilters(data: { prs?: number[]; runs?: number[] }): InvalidateQueryFilters[] {
  const prs = data.prs ?? [];
  const runs = data.runs ?? [];
  const out: InvalidateQueryFilters[] = [];
  // A run event without PRs is a log update. The PR list does not change with it.
  if (prs.length || !runs.length) out.push({ queryKey: ["prs"] }, { queryKey: ["status"] });
  for (const id of prs)
    out.push(
      {
        queryKey: ["pr", id],
        predicate: (q) =>
          q.queryKey[2] !== "diff" || (q.queryKey.length === 3 && (q.state.data as { fetch?: unknown } | undefined)?.fetch === true),
      },
      { queryKey: ["brief", id] },
      // RunDto.stale compares the run heads with the PR heads, so a synced push changes the runs of the PR.
      { queryKey: ["runs", "pr", id] },
    );
  if (runs.length) {
    out.push({ queryKey: ["runs"] }, ...runs.map((id) => ({ queryKey: ["run", id] })));
    // A run start and a run end name the PR too. Each of them refreshes the runner check.
    if (prs.length) out.push({ queryKey: ["meta"] });
  }
  return out;
}

// The diff queries of PR pr after its source head changed from before to head. null: no change, or the first value.
export const diffRefresh = (
  pr: number,
  before: string | null | undefined,
  head: string | null | undefined,
): InvalidateQueryFilters | null =>
  before !== undefined && head !== undefined && before !== head ? { queryKey: ["pr", pr, "diff"] } : null;

export function useLive(qc: QueryClient) {
  useEffect(() => {
    const es = new EventSource("/api/live");
    let opened = false;
    es.addEventListener("changed", (e) => {
      let data: { prs?: number[]; runs?: number[] } = {};
      try {
        data = JSON.parse((e as MessageEvent<string>).data);
      } catch {}
      for (const f of changedFilters(data)) qc.invalidateQueries(f);
    });
    es.addEventListener("events", () => liveEvents.dispatchEvent(new Event("events")));
    // A reconnect can follow a server restart or a sleep. Missed messages are lost, so refetch everything.
    es.addEventListener("open", () => {
      if (opened) {
        qc.invalidateQueries();
        liveEvents.dispatchEvent(new Event("events"));
      }
      opened = true;
    });
    return () => es.close();
  }, [qc]);
}
