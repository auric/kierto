// Detail states from plan section 6: no access, incomplete sync, gone.
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { CheckpointDto } from "../shared/dto";
import { clock, REASON_LABEL } from "./shell/model";

const NO_ACCESS = new Set(["forbidden", "not_found"]);

// 403 or 404 for one PR, or another incomplete last check. Other PRs keep working.
export function CheckBanner({ checkpoint }: { checkpoint: CheckpointDto | null }) {
  const reason = checkpoint?.reason;
  if (!checkpoint || !reason) return null;
  const denied = NO_ACCESS.has(reason);
  const last = checkpoint.lastCompleteAt === null ? "never" : clock(checkpoint.lastCompleteAt);
  return (
    <Alert variant={denied ? "destructive" : "default"} className="max-w-[760px]">
      <AlertTitle>{denied ? "No access to this pull request" : "Last check incomplete"}</AlertTitle>
      <AlertDescription>
        Reason: {REASON_LABEL[reason]}. The page shows the data of the last complete check ({last}).
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
