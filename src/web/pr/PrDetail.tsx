// Stub. WP7 owns this file and builds the detail.
import type { PrRow } from "../../shared/dto";
import { prKey } from "../shell/model";

export function PrDetail({ pr }: { pr: PrRow }) {
  return (
    <div className="grid gap-2 border-b px-6 pt-4 pb-3">
      <h1 className="m-0 text-[19px] leading-snug font-bold tracking-tight text-balance">{pr.title ?? prKey(pr)}</h1>
      <p className="m-0 font-mono text-[11.5px] text-muted-foreground">{prKey(pr)}</p>
      <p className="m-0 text-muted-foreground">Details arrive in the next step.</p>
    </div>
  );
}
