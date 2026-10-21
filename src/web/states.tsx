// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Detail states from plan section 6: no access, incomplete sync, gone. The archive notice.
import { Archive, ArchiveRestore, BellOff } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CheckpointDto, PrRow } from "../shared/dto";
import { useForge } from "./meta";
import { ago, clock, reasonLabel, restoreWords } from "./shell/model";

// An archived PR, or an unfollowed PR off the dashboard. Sync does not check its comments, so the page can be out of date.
export function ArchiveNotice({ pr, now, onRestore }: { pr: PrRow; now: number; onRestore: () => void }) {
  const { verb } = restoreWords(pr);
  const when = pr.archivedAt === null ? null : ago(pr.archivedAt, now);
  const Icon = pr.archivedAt === null ? BellOff : Archive;
  return (
    <Alert role="status" data-archive-notice className="mt-4 max-w-[760px]">
      <Icon aria-hidden />
      <AlertTitle>{when === null ? "Not followed" : when === "now" ? "Archived just now" : `Archived ${when} ago`}</AlertTitle>
      <AlertDescription>
        {when === null
          ? "It is not on your dashboard, so PR Review Inbox does not check it. This page can be out of date."
          : "PR Review Inbox does not check it while it is archived. This page can be out of date."}{" "}
        {pr.followed ? `${verb} it to check it again.` : `${verb} it to follow it and check it again.`}
      </AlertDescription>
      <Button size="sm" className="col-start-2 mt-2 w-fit" onClick={onRestore}>
        <ArchiveRestore aria-hidden data-icon="inline-start" />
        {verb}
      </Button>
    </Alert>
  );
}

const NO_ACCESS = new Set(["forbidden", "not_found"]);

// 403 or 404 for one PR, or another incomplete last check. Other PRs keep working.
export function CheckBanner({ checkpoint }: { checkpoint: CheckpointDto | null }) {
  const reason = checkpoint?.reason;
  const forge = useForge();
  if (!checkpoint || !reason) return null;
  const denied = NO_ACCESS.has(reason);
  const last = checkpoint.lastCompleteAt === null ? "never" : clock(checkpoint.lastCompleteAt);
  return (
    <Alert variant={denied ? "destructive" : "default"} className="max-w-[760px]">
      <AlertTitle>{denied ? "No access to this pull request" : "Last check incomplete"}</AlertTitle>
      <AlertDescription>
        Reason: {reasonLabel(forge)[reason]}. The page shows the data of the last complete check ({last}).
      </AlertDescription>
    </Alert>
  );
}

export function Calm({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto my-10 grid max-w-[52ch] gap-3 px-6 text-muted-foreground">
      <h2 className="m-0 text-[16px] font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}
