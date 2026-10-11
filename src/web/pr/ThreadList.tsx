// Threads section (prototype/v3 threadsSec): the filter, then your turn, waiting, others, and resolved threads.
import { CircleCheck, Hourglass, Reply, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Turn } from "../../shared/turn";
import { Thread, type ThreadCtx } from "./Thread";
import { ordered, type ThreadModel, TURN_ORDER } from "./threads";

const HEAD: Record<Turn, [string, typeof Reply]> = {
  your: ["Your turn", Reply],
  wait: ["Waiting on others", Hourglass],
  other: ["Other discussions", Users],
  resolved: ["Resolved", CircleCheck],
};

export function Threads(props: {
  threads: ThreadModel[];
  needMe: boolean;
  showResolved: boolean;
  isOpen: (t: ThreadModel) => boolean;
  cur: number | null;
  spines: ReadonlySet<number>;
  branches: ReadonlySet<number>;
  ctx: ThreadCtx;
  onNeedMe: (on: boolean) => void;
  onShowResolved: () => void;
}) {
  const { threads, needMe } = props;
  const vis = ordered(threads, needMe);
  const groups = TURN_ORDER.flatMap((k) => {
    const ts = vis.filter((t) => t.turn === k);
    return ts.length ? [{ k, ts }] : [];
  });
  return (
    <section id="s-threads" aria-labelledby="h-threads" className="max-w-[86ch] scroll-mt-3 pt-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="h-threads" className="m-0 flex items-baseline gap-2 text-[15px] font-bold tracking-[-0.005em]">
          Threads
          <span className="text-sm font-medium text-muted-foreground">
            {needMe ? `${vis.length} of ${threads.length}` : threads.length}
          </span>
        </h2>
        {threads.length > 0 && (
          <label className="ml-auto inline-flex cursor-pointer items-center gap-[7px] text-sm text-ink-2">
            <input type="checkbox" className="m-0 accent-foreground" checked={needMe} onChange={(e) => props.onNeedMe(e.target.checked)} />
            Only threads that need me
          </label>
        )}
      </div>
      {groups.length ? (
        groups.map(({ k, ts }) => {
          if (k === "resolved" && !props.showResolved && !needMe) {
            return (
              <div key={k} className="mt-5">
                <button
                  type="button"
                  className="mx-1.5 cursor-pointer rounded text-sm font-medium text-pen hover:underline"
                  onClick={props.onShowResolved}
                >
                  Show {ts.length} resolved
                </button>
              </div>
            );
          }
          const [label, Icon] = HEAD[k];
          return (
            <div key={k} className="mt-5">
              <h3 className="m-0 flex items-center gap-2 border-b px-1.5 pb-1.5 text-sm font-bold">
                <span className={cn("inline-flex items-center gap-1.5 font-semibold", k === "your" ? "text-turn" : "text-ink-2")}>
                  <Icon aria-hidden className="size-[15px]" />
                  {label}
                </span>
                <span className="font-medium text-muted-foreground">{ts.length}</span>
              </h3>
              {ts.map((t) => (
                <Thread
                  key={t.id}
                  t={t}
                  open={props.isOpen(t)}
                  cur={props.cur === t.id}
                  spine={props.spines.has(t.id)}
                  branches={props.branches}
                  ctx={props.ctx}
                />
              ))}
            </div>
          );
        })
      ) : (
        <p className="mt-3 mb-0 text-sm text-muted-foreground">{threads.length ? "No thread needs you." : "No comments yet."}</p>
      )}
    </section>
  );
}
