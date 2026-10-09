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
      let ids: number[] = [];
      try {
        ids = (JSON.parse((e as MessageEvent<string>).data) as { prs?: number[] }).prs ?? [];
      } catch {}
      qc.invalidateQueries({ queryKey: ["prs"] });
      qc.invalidateQueries({ queryKey: ["status"] });
      for (const id of ids) qc.invalidateQueries({ queryKey: ["pr", id] });
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
