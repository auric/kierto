// One EventSource per tab. EventSource reconnects by itself.
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

// Dispatches "events" when the server stored new notification events.
export const liveEvents = new EventTarget();

export function useLive(qc: QueryClient) {
  useEffect(() => {
    const es = new EventSource("/api/live");
    let opened = false;
    es.addEventListener("changed", (e) => {
      let data: { prs?: number[]; runs?: number[] } = {};
      try {
        data = JSON.parse((e as MessageEvent<string>).data);
      } catch {}
      const prs = data.prs ?? [];
      const runs = data.runs ?? [];
      // A run event without PRs is a log update. The PR list does not change with it.
      if (prs.length || !runs.length) {
        qc.invalidateQueries({ queryKey: ["prs"] });
        qc.invalidateQueries({ queryKey: ["status"] });
      }
      for (const id of prs) {
        qc.invalidateQueries({ queryKey: ["pr", id] });
        qc.invalidateQueries({ queryKey: ["brief", id] });
      }
      if (runs.length) {
        qc.invalidateQueries({ queryKey: ["runs"] });
        for (const id of runs) qc.invalidateQueries({ queryKey: ["run", id] });
        // A run start and a run end name the PR too. Each of them refreshes the runner check.
        if (prs.length) qc.invalidateQueries({ queryKey: ["meta"] });
      }
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
