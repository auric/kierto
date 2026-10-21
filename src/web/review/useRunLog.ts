// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The run log sheet of one PR: which run it shows, and the focus that goes back when it closes.
import { useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import type { RunDto } from "../../shared/dto";
import { useRun } from "./data";
import type { LogTarget } from "./RunLog";

// of: "line" follows the run of the run line. "review" stays on the newest review run, for its drafts. A number is a run ID.
export type LogState = LogTarget & { of: "line" | "review" | number };

export function useRunLog(latest: RunDto | null, newest: RunDto | null) {
  const [log, setLog] = useState<LogState | null>(null);
  const pinned = useRun(typeof log?.of === "number" ? log.of : null);
  const opener = useRef<HTMLElement | null>(null);

  const openLog = (agent: string | null, raw = false, of: "line" | "review" | number = "line") => {
    if (typeof of !== "number" && !(of === "review" ? latest : newest)) {
      toast.add({ title: "No review has run on this pull request yet. Press r to start one." });
      return;
    }
    const at = document.activeElement;
    if (at instanceof HTMLElement && !at.closest("#run-log")) opener.current = at;
    setLog((l) => ({ agent, raw, n: (l?.n ?? 0) + 1, of }));
  };
  const closeLog = () => {
    setLog(null);
    const back = opener.current?.isConnected ? opener.current : document.getElementById("runline-log");
    back?.focus({ preventScroll: true });
  };
  const logRun = typeof log?.of === "number" ? log.of : (log?.of === "review" ? latest : newest)?.id;
  return { log, setLog, pinned, openLog, closeLog, logRun };
}
