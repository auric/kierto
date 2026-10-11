// Post bar (prototype/v3 postBar): shown while something is accepted. p or the button opens the confirm with the exact text
// and destination of each comment. The confirm keeps the plan it showed: a change on the server gives 409 and a new plan.
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { CommentDto, PostDto, PostPlanDto, PrRow } from "../../shared/dto";
import { itemsSettled, usePrRuns } from "../review/data";
import { shortHash } from "../review/model";
import { ApiError } from "../shell/data";
import { prKey } from "../shell/model";
import { Confirm, type ConfirmEntry } from "./Confirm";
import { confirmPosts, fetchPlan, planKey, postsKey, usePostPlan } from "./data";
import { destLabel, destText, mergePosts, planItems } from "./model";

type Open = { plan: PostPlanDto | null; posting: boolean; error: string | null };

const NOTHING = "Nothing is accepted yet. Accept drafts, questions, or replies first.";

export type PostBarApi = { open(): void; close(): void; isOpen: boolean };

const entries = (plan: PostPlanDto, comments: CommentDto[]): ConfirmEntry[] =>
  plan.posts.map((p, i) => {
    const d = destLabel(p.destination, comments);
    return {
      key: `${p.run}:${i}`,
      code: d.code,
      dest: d.text,
      body: p.body,
      warning: p.duplicate ? `${p.duplicate.author} raised a similar point on this line.` : null,
    };
  });

// onPosted: the rows of the confirm, for the focus. announce: the live region of the detail.
export function usePostBar(
  pr: PrRow,
  o: { comments: CommentDto[]; forge: string; onPosted: (rows: PostDto[]) => void; announce: (text: string) => void },
) {
  const qc = useQueryClient();
  const plan = usePostPlan(pr.id);
  const runs = usePrRuns(pr.id).data;
  const [c, setC] = useState<Open | null>(null);
  const posts = plan.data?.posts ?? [];
  const key = prKey(pr);

  const close = () => {
    if (c?.posting) return;
    setC(null);
    requestAnimationFrame(() => document.getElementById("post-btn")?.focus({ preventScroll: true }));
  };

  const load = async (error: string | null) => {
    try {
      const fresh = await fetchPlan(pr.id);
      qc.setQueryData(planKey(pr.id), fresh);
      if (!fresh.posts.length) {
        setC(null);
        toast.add({ title: error ?? NOTHING });
        return;
      }
      setC({ plan: fresh, posting: false, error });
    } catch (e) {
      setC(null);
      toast.add({ title: "Cannot load the comments to post", description: (e as Error).message });
    }
  };

  // The cached plan can miss a triage request that is still out. Only a plan read after those requests end decides.
  const open = () => {
    if (c) return;
    setC({ plan: null, posting: false, error: null });
    void itemsSettled().then(() => load(null));
  };

  const post = async () => {
    const shown = c?.plan;
    if (!shown || c.posting) return;
    setC({ ...c, posting: true, error: null });
    try {
      const r = await confirmPosts(pr.id, planItems(shown.posts));
      qc.setQueryData<PostDto[]>(postsKey(pr.id), (old) => mergePosts(old, r.posts));
      void qc.invalidateQueries({ queryKey: planKey(pr.id) });
      void qc.invalidateQueries({ queryKey: ["run"] });
      setC(null);
      o.announce(r.existing ? "These comments were posted from another page already." : `Posting ${destText(r.posts)}.`);
      if (r.existing) toast.add({ title: "These comments were posted from another page already. Nothing was posted again." });
      if (r.warning) toast.add({ title: r.warning });
      o.onPosted(r.posts);
    } catch (e) {
      const msg = (e as Error).message;
      // 409: the plan or the source branch changed. The dialog shows the new plan and the reason.
      if (e instanceof ApiError && e.status === 409) await load(msg);
      else setC({ plan: shown, posting: false, error: msg });
    }
  };

  // The preflight line: the reviewed commits, and what the newest run data says about them. Replies have no commits (D14).
  const shown = c?.plan?.posts ?? posts;
  const note = (() => {
    if (!shown.length) return "Reading the comments to post…";
    const review = shown.filter((p) => p.destination.kind !== "reply");
    const replies = review.length < shown.length;
    if (!review.length) return "Each reply goes under the message it answers. The app checks for newer messages when you post.";
    const at = [...new Set(review.map((p) => p.sourceHead))].map(shortHash).join(", ");
    const reviewed = runs?.filter((r) => review.some((p) => p.run === r.id)) ?? [];
    if (reviewed.some((r) => r.stale?.source))
      return `The source branch has new commits since ${at}. ${o.forge} gets nothing until you review again.`;
    const moved = reviewed.some((r) => r.stale?.target) ? " The target branch moved since the review." : "";
    const also = replies ? " Replies go under the messages they answer." : "";
    return `Review comments attach to the reviewed commit ${at}.${moved} The app checks the source branch again when you post.${also}`;
  })();

  const api: PostBarApi = { open, close, isOpen: c !== null && !c.posting };
  if (!c && !posts.length) return { node: null, api };
  return {
    api,
    node: (
      <div data-postbar className="sticky bottom-0 z-[2] border-t border-rule-strong bg-pane px-6 text-sm max-[759px]:px-4">
        {c ? (
          <Confirm
            id="post-confirm"
            title={shown.length ? `Post ${destText(shown)} to ${key}?` : `Post to ${key}?`}
            note={note}
            entries={c.plan && entries(c.plan, o.comments)}
            posting={c.posting}
            error={c.error}
            canPost={!!c.plan}
            onPost={() => void post()}
            onCancel={close}
            className="max-h-[62vh] pt-3.5 pb-2.5"
          />
        ) : (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 py-2.5">
            <span>Ready to post: {destText(posts)}</span>
            <span className="flex-1" />
            <Button id="post-btn" size="sm" title="Key: p" aria-keyshortcuts="p" onClick={open}>
              <Send aria-hidden data-icon="inline-start" />
              Post to {o.forge}
            </Button>
          </div>
        )}
      </div>
    ),
  };
}
