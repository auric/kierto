// Overview, Files, and Commits of the detail pane (prototype/v3 overview, filesSec, commitsSec).
import { ChevronRight, Copy, ExternalLink, File, FileDiff, FileMinus, FilePlus, FileSymlink, MessageSquare } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import type { ChangedFile, CommitDto, PrDetail } from "../../shared/dto";
import { isMe } from "../../shared/me";
import type { Hints } from "../shell/Hint";
import { HintTrigger } from "../shell/Hint";
import { ago } from "../shell/model";
import { CheckBanner } from "../states";
import { webLink } from "./Header";
import { fullTime, Text } from "./Thread";
import type { ThreadModel } from "./threads";

export const STATUS_TEXT: Record<string, string> = { APPROVED: "Approved", NEEDS_WORK: "Needs work", UNAPPROVED: "Not reviewed" };

const h2 = "m-0 flex items-baseline gap-2 text-[15px] font-bold tracking-[-0.005em]";
const linkish = "inline-flex w-fit items-center gap-1 rounded text-sm font-medium text-pen hover:underline";

// summary: the runner's summary of the newest review (plan v3 WP11).
export function Overview({
  detail,
  me,
  forge,
  diffLink,
  summary,
}: {
  detail: PrDetail;
  me: string | null;
  forge: string;
  diffLink: boolean;
  summary?: ReactNode;
}) {
  const { pr, description } = detail;
  const [more, setMore] = useState(false);
  const text = description?.trim() ?? "";
  const blocks = text.split(/\n\s*\n/);
  const long = blocks.length > 1;
  const web = webLink(pr.webUrl);
  const opener = pr.role === "AUTHOR" ? "you" : (pr.authorName ?? pr.authorSlug);
  return (
    <section id="s-overview" aria-labelledby="h-overview" className="grid max-w-[86ch] scroll-mt-3 justify-items-start gap-2.5 pt-6">
      <h2 id="h-overview" className={`${h2} w-full`}>
        Overview
        {opener && <span className="ml-auto text-xs font-normal text-muted-foreground">Opened by {opener}</span>}
      </h2>
      {summary}
      {!pr.followed && (
        <p className="m-0 text-muted-foreground">Not followed. Review Loop does not check this pull request for new comments.</p>
      )}
      <div id="desc" className="max-w-[72ch] [overflow-wrap:anywhere]">
        {text ? <Text text={long && !more ? (blocks[0] ?? text) : text} /> : <p className="m-0 text-muted-foreground">No description.</p>}
      </div>
      {long && (
        <button
          type="button"
          className={`${linkish} cursor-pointer`}
          aria-expanded={more}
          aria-controls="desc"
          onClick={() => setMore(!more)}
        >
          {more ? "Show less" : "Show more"}
        </button>
      )}
      <CheckBanner checkpoint={pr.checkpoint} />
      {pr.reviewers.length > 0 && (
        <dl className="m-0 mt-1.5 grid max-w-[72ch] grid-cols-[max-content_minmax(0,1fr)] gap-x-[18px] gap-y-2">
          <dt className="pt-px text-sm text-muted-foreground">Reviewers</dt>
          <dd className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {pr.reviewers.map((r) => (
              <span key={r.slug} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                {isMe(r, me) ? "You" : r.name}
                <span className="text-sm text-muted-foreground">{STATUS_TEXT[r.status] ?? r.status}</span>
              </span>
            ))}
          </dd>
        </dl>
      )}
      {diffLink && web && <DiffLink web={web} forge={forge} />}
    </section>
  );
}

function DiffLink({ web, forge }: { web: string; forge: string }) {
  return (
    <a className={linkish} href={`${web}/diff`} target="_blank" rel="noopener noreferrer">
      <ExternalLink aria-hidden className="size-[15px]" />
      Open the diff in {forge}
    </a>
  );
}

// Files and Commits start closed. The detail keeps them open across renders.
export function Fold({
  id,
  head,
  open,
  onOpen,
  children,
}: {
  id: string;
  head: ReactNode;
  open: boolean;
  onOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details id={`s-${id}`} open={open} onToggle={(e) => onOpen(e.currentTarget.open)} className="max-w-[86ch] scroll-mt-3 pt-6 open:pb-3">
      <summary id={`s-${id}-sum`} className="mr-8 -ml-1.5 rounded hover:bg-hover">
        <h2 className={`${h2} items-center px-1.5 py-1`}>
          {head}
          <ChevronRight aria-hidden className="rl-chev ml-auto size-[15px] text-muted-foreground" />
        </h2>
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

const CHANGE: Record<string, [typeof File, string]> = {
  ADD: [FilePlus, "Added"],
  MODIFY: [FileDiff, "Modified"],
  DELETE: [FileMinus, "Deleted"],
  MOVE: [FileSymlink, "Moved"],
  COPY: [Copy, "Copied"],
};

export function FilesFold(props: {
  files: ChangedFile[];
  threads: ThreadModel[];
  open: boolean;
  onOpen: (open: boolean) => void;
  onFile: (path: string) => void;
  web: string | null;
  forge: string;
  hints: Hints;
}) {
  const n = props.files.length;
  return (
    <Fold id="files" open={props.open} onOpen={props.onOpen} head={<FoldHead label="Files" n={`${n}`} />}>
      <ul className="m-0 mb-2.5 list-none p-0">
        {props.files.map((f) => {
          const [Icon, type] = CHANGE[f.type] ?? [File, "Changed"];
          const word = f.srcPath ? `${type} from ${f.srcPath}` : type;
          const count = props.threads.filter((t) => t.anchor?.path === f.path).length;
          const go = `Go to ${count === 1 ? "the thread" : `the first of ${count} threads`} on this file`;
          const cut = f.path.lastIndexOf("/") + 1;
          return (
            <li key={f.path} className="grid grid-cols-[15px_minmax(0,1fr)_auto] items-center gap-3 border-b py-1.5">
              <HintTrigger hints={props.hints} label={word}>
                <span role="img" aria-label={word} className="inline-flex text-muted-foreground">
                  <Icon aria-hidden className="size-[15px]" />
                </span>
              </HintTrigger>
              <span translate="no" className="min-w-0 font-mono text-sm [overflow-wrap:anywhere]">
                <span className="text-muted-foreground">{f.path.slice(0, cut)}</span>
                {f.path.slice(cut)}
              </span>
              {count > 0 ? (
                <HintTrigger hints={props.hints} label={go}>
                  <button
                    type="button"
                    aria-label={go}
                    onClick={() => props.onFile(f.path)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-sm font-medium text-ink-2 hover:underline"
                  >
                    <MessageSquare aria-hidden className="size-[15px]" />
                    {count}
                  </button>
                </HintTrigger>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
      {props.web && <DiffLink web={props.web} forge={props.forge} />}
    </Fold>
  );
}

export function FoldHead({ label, n }: { label: string; n: string }) {
  return (
    <>
      {label}
      <span className="text-sm font-medium text-muted-foreground">{n}</span>
    </>
  );
}

// The mark sits above the commit that my last review covered. Newer commits are new since that review.
export function CommitsFold(props: {
  commits: CommitDto[];
  detail: PrDetail;
  me: string | null;
  open: boolean;
  onOpen: (open: boolean) => void;
  now: number;
  hints: Hints;
}) {
  const mine = props.detail.pr.reviewers.find((r) => isMe(r, props.me));
  const at = mine?.lastReviewedCommit ? props.commits.findIndex((c) => c.hash === mine.lastReviewedCommit) : -1;
  const n = props.commits.length;
  return (
    <Fold
      id="commits"
      open={props.open}
      onOpen={props.onOpen}
      head={<FoldHead label="Commits" n={at > 0 ? `${n}, ${at} since your review` : `${n}`} />}
    >
      <ul className="m-0 list-none p-0">
        {props.commits.map((c, i) => (
          <Fragment key={c.hash}>
            {i === at && mine && (
              <li className="border-b pt-3.5 pb-1.5 text-xs text-muted-foreground">
                Your review ({(STATUS_TEXT[mine.status] ?? mine.status).toLowerCase()}) covered the commits below.
              </li>
            )}
            <li className="grid grid-cols-[9ch_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-b py-[7px]">
              <span translate="no" className="font-mono text-xs text-ink-2">
                {c.hash.slice(0, 7)}
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {c.message.split("\n")[0]}
                {i < at && <span className="sr-only"> (new since your review)</span>}
              </span>
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {c.author},{" "}
                <HintTrigger hints={props.hints} label={fullTime(c.at)}>
                  <time dateTime={new Date(c.at).toISOString()}>{ago(c.at, props.now)}</time>
                </HintTrigger>
              </span>
            </li>
          </Fragment>
        ))}
      </ul>
    </Fold>
  );
}
