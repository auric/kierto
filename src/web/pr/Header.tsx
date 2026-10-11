// Detail header (prototype/v3 renderDetail .dh): key, branches, task IDs, actions, title, and the summary lines.
import { Archive, ExternalLink, Reply, Star } from "lucide-react";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PrRow } from "../../shared/dto";
import { useForge } from "../meta";
import { useArchive, useFollow } from "../shell/data";
import { Hint } from "../shell/Hint";
import { prKey, taskHint } from "../shell/model";
import { NewMark } from "./Thread";
import { visitText } from "./threads";

// Only http(s) links from the server reach an href.
export function webLink(url: string | null): string | null {
  if (!url) return null;
  try {
    return /^https?:$/.test(new URL(url).protocol) ? url.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

const iconBtn = "text-ink-2 hover:bg-hover hover:text-foreground";

// since: the last visit before this one. fresh: the new messages. sum: the counts of the summary line.
// action, brief, run: the Review button, the review brief under the title, and the run line (plan v3 WP11).
export function Header(props: {
  pr: PrRow;
  since: number | null;
  now: number;
  fresh: number;
  sum: { your: number; unresolved: number; tasks: number };
  onNextNew: () => void;
  onNextYour: () => void;
  onLeave: () => void;
  action: ReactNode;
  brief: ReactNode;
  run: ReactNode;
}) {
  const { pr, sum } = props;
  const follow = useFollow();
  const archive = useArchive();
  const forge = useForge();
  const key = prKey(pr);
  const web = webLink(pr.webUrl);
  const onArchive = () => {
    props.onLeave();
    archive.mutate({ id: pr.id, label: key });
  };
  const following = pr.followed ? "Following. Select to stop." : "Follow";
  return (
    <header className="grid gap-1.5 border-b px-6 pt-3 pb-3.5 max-[759px]:px-4 max-[759px]:pt-2">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
        <span translate="no" className="font-mono [overflow-wrap:anywhere]">
          {key}
        </span>
        {pr.sourceBranch && (
          <span translate="no" className="[overflow-wrap:anywhere] max-[759px]:order-3 max-[759px]:basis-full">
            <code className="font-mono text-ink-2">{pr.sourceBranch}</code> into{" "}
            <code className="font-mono text-ink-2">{pr.targetBranch ?? "?"}</code>
          </span>
        )}
        {pr.tasks.map((t) => {
          const url = webLink(t.url);
          const chip =
            "inline-flex items-baseline rounded-[5px] border px-2 py-0.5 font-mono text-xs whitespace-nowrap max-[759px]:order-4";
          return (
            <Hint key={t.key} label={taskHint(t)}>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  translate="no"
                  className={cn(chip, "text-pen hover:border-rule-strong hover:underline")}
                >
                  {t.key}
                </a>
              ) : (
                <span translate="no" className={cn(chip, "text-ink-2")}>
                  {t.key}
                </span>
              )}
            </Hint>
          );
        })}
        <span className="ml-auto flex items-center gap-0.5">
          {web && (
            <Hint label={`Open in ${forge}`}>
              <a
                href={web}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open in ${forge}`}
                className={buttonVariants({ variant: "ghost", size: "icon-sm", className: iconBtn })}
              >
                <ExternalLink aria-hidden />
              </a>
            </Hint>
          )}
          <Hint label={following}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={iconBtn}
              aria-label="Follow"
              aria-pressed={pr.followed}
              disabled={follow.isPending}
              onClick={() => follow.mutate({ id: pr.id, followed: !pr.followed })}
            >
              <Star aria-hidden className={cn(pr.followed && "fill-current")} />
            </Button>
          </Hint>
          <Hint label="Archive">
            <Button
              variant="ghost"
              size="icon-sm"
              className={iconBtn}
              aria-label="Archive"
              disabled={archive.isPending}
              onClick={onArchive}
            >
              <Archive aria-hidden />
            </Button>
          </Hint>
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <h1 className="m-0 min-w-0 flex-[1_1_24ch] text-(length:--fs-title) leading-tight font-bold tracking-[-0.015em] text-balance [overflow-wrap:anywhere]">
          {pr.title ?? key}
        </h1>
        {props.action}
      </div>
      {props.brief}
      {(sum.your > 0 || sum.unresolved > 0 || sum.tasks > 0) && (
        <p className="rl-sum m-0 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
          {sum.your > 0 && (
            <Hint label="Key: y">
              <button
                type="button"
                aria-keyshortcuts="y"
                onClick={props.onNextYour}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded font-semibold text-turn hover:underline"
              >
                <Reply aria-hidden className="size-[15px]" />
                Your turn in {sum.your} {sum.your === 1 ? "thread" : "threads"}
              </button>
            </Hint>
          )}
          {sum.unresolved > 0 && <span>{sum.unresolved} unresolved</span>}
          {sum.tasks > 0 && (
            <span>
              {sum.tasks} open {sum.tasks === 1 ? "task" : "tasks"}
            </span>
          )}
        </p>
      )}
      {props.fresh > 0 && (
        <p className="m-0 flex text-sm">
          <Hint label="Key: n">
            <button type="button" aria-keyshortcuts="n" onClick={props.onNextNew} className="cursor-pointer rounded hover:underline">
              <NewMark text={`${props.fresh} new`} />
              {props.since !== null && <span className="text-ink-2"> since {visitText(props.since, props.now)}</span>}
            </button>
          </Hint>
        </p>
      )}
      {props.run}
    </header>
  );
}
