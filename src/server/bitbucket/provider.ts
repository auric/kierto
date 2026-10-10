// ForgeProvider for Bitbucket Server. It returns forge-neutral types from src/shared/types.ts.
import { z } from "zod";
import type { Comment, CommentStatus, ListResult, PrRef, PullRequest, Role } from "../../shared/types";
import { type ClientOptions, createClient, ForgeError } from "./client";
import { activity, pullRequest, type RawComment, type user } from "./schemas";

const API = "/rest/api/1.0";
const DASHBOARD = `${API}/dashboard/pull-requests`;

const prPath = (ref: PrRef) =>
  `${API}/projects/${encodeURIComponent(ref.project)}/repos/${encodeURIComponent(ref.repo)}/pull-requests/${ref.id}`;
const toUser = (u: z.infer<typeof user>) => ({ slug: u.slug, name: u.displayName, login: u.name });

export function createBitbucketProvider(opts: ClientOptions) {
  const client = createClient(opts);
  const origin = new URL(opts.baseUrl).origin;

  function toPr(p: z.infer<typeof pullRequest>): PullRequest {
    const href = p.links?.self?.[0]?.href;
    let webUrl: string | undefined;
    try {
      if (href && new URL(href).origin === origin) webUrl = href;
    } catch {}
    return {
      ref: { project: p.toRef.repository.project.key, repo: p.toRef.repository.slug, id: p.id },
      version: p.version,
      title: p.title,
      description: p.description,
      state: p.state,
      author: toUser(p.author.user),
      reviewers: p.reviewers.map((r) => ({ ...toUser(r.user), status: r.status, lastReviewedCommit: r.lastReviewedCommit })),
      sourceHead: p.fromRef.latestCommit,
      targetHead: p.toRef.latestCommit,
      sourceBranch: p.fromRef.displayId,
      targetBranch: p.toRef.displayId,
      webUrl,
      updatedDate: p.updatedDate,
    };
  }

  return {
    // The username of the token owner, from the X-AUSERNAME header. It can differ from the slug.
    async currentUser(): Promise<string> {
      const { headers } = await client.get(`${DASHBOARD}?limit=1`, z.unknown());
      const slug = headers.get("x-ausername");
      if (!slug) throw new ForgeError("auth", DASHBOARD);
      return slug;
    },

    async listDashboard(role: Role): Promise<ListResult<PullRequest>> {
      const r = await client.list(`${DASHBOARD}?state=OPEN&role=${role}`, pullRequest);
      return { ...r, items: r.items.map(toPr) };
    },

    async getPullRequest(ref: PrRef): Promise<PullRequest> {
      return toPr((await client.get(prPath(ref), pullRequest)).data);
    },

    // Replies have no activity of their own. They are nested in comment.comments[] of the root comment.
    async listComments(ref: PrRef): Promise<ListResult<Comment>> {
      const r = await client.list(`${prPath(ref)}/activities`, activity);
      const byId = new Map<number, Comment>();
      const visit = (c: RawComment, parentId: number | null, rootId: number) => {
        const prev = byId.get(c.id);
        if (!prev || c.version > prev.version) {
          byId.set(c.id, {
            id: c.id,
            version: c.version,
            parentId,
            rootId,
            author: toUser(c.author),
            text: c.text,
            anchor: c.anchor,
            threadResolved: c.threadResolved ?? false,
            createdAt: c.createdDate,
            updatedAt: c.updatedDate,
          });
        }
        for (const child of c.comments ?? []) visit(child, c.id, rootId);
      };
      for (const a of r.items) if (a.comment) visit(a.comment, null, a.comment.id);
      return { ...r, items: [...byId.values()] };
    },

    // A deleted comment has no tombstone. Only a 404 proves the delete.
    async commentStatus(ref: PrRef, id: number): Promise<CommentStatus> {
      try {
        await client.get(`${prPath(ref)}/comments/${id}`, z.unknown());
        return "present";
      } catch (e) {
        if (e instanceof ForgeError && e.kind === "not_found") return "deleted";
        throw e;
      }
    },
  };
}

export type ForgeProvider = ReturnType<typeof createBitbucketProvider>;
