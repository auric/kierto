// One EventSource per tab. EventSource reconnects by itself.
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

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
    // A reconnect can follow a server restart or a sleep. Missed messages are lost, so refetch everything.
    es.addEventListener("open", () => {
      if (opened) qc.invalidateQueries();
      opened = true;
    });
    return () => es.close();
  }, [qc]);
}
