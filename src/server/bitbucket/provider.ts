// ForgeProvider for Bitbucket Server. It returns forge-neutral types from src/shared/types.ts.
import { z } from "zod";
import type { Comment, CommentStatus, ListResult, PrRef, PullRequest, Role } from "../../shared/types";
import { type ClientOptions, createClient, ForgeError } from "./client";
import { activity, postedComment, pullRequest, type RawComment, type user } from "./schemas";

const API = "/rest/api/1.0";
const DASHBOARD = `${API}/dashboard/pull-requests`;

const prPath = (ref: PrRef) =>
  `${API}/projects/${encodeURIComponent(ref.project)}/repos/${encodeURIComponent(ref.repo)}/pull-requests/${ref.id}`;
const toUser = (u: z.infer<typeof user>) => ({ slug: u.slug, name: u.displayName, login: u.name });

const cloneRepo = z.object({
  links: z.object({ clone: z.array(z.object({ href: z.string(), name: z.string() })).optional() }).optional(),
});
const remoteRef = z.object({ id: z.string(), repository: cloneRepo });
const remoteRefs = z.object({ fromRef: remoteRef, toRef: remoteRef });

// A new-side line of the diff between two fixed commits. fromHash: the target head. toHash: the reviewed source head (I8).
export type NewAnchor = { path: string; srcPath: string | null; line: number; lineType: "add" | "ctx"; fromHash: string; toHash: string };
export type NewComment = { text: string; parentId?: number; anchor?: NewAnchor };

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

  // The http clone link without user info. Only a link with the configured origin gets the token.
  function httpClone(repo: z.infer<typeof cloneRepo>): string | undefined {
    try {
      const u = new URL(repo.links?.clone?.find((l) => l.name === "http")?.href ?? "");
      u.username = "";
      u.password = "";
      return u.origin === origin ? u.href : undefined;
    } catch {
      return undefined;
    }
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

    // The git remote for the review workspace (src/server/review/workspace.ts). The PR refs live in the target repository.
    // Only git fetch gets fetchConfig. It holds the token as an http.extraHeader value (Gate 0 ls-remote).
    async gitRemote(ref: PrRef) {
      const { data } = await client.get(prPath(ref), remoteRefs);
      const url = httpClone(data.toRef.repository);
      const sourceUrl = httpClone(data.fromRef.repository);
      if (!url || !sourceUrl) throw new Error("The pull request has no http clone link on the configured server.");
      const fetchConfig: [string, string][] = [["http.extraHeader", `Authorization: Bearer ${opts.token}`]];
      if (opts.caFile) fetchConfig.push(["http.sslCAInfo", opts.caFile]);
      return { url, sourceUrl, sourceRef: data.fromRef.id, targetRef: data.toRef.id, fetchConfig };
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

    // One POST, never repeated. parent makes a reply (Gate 0). The anchor uses diffType COMMIT (Gate 0, integration-check.md:50).
    async createComment(ref: PrRef, c: NewComment): Promise<{ id: number; version: number }> {
      const a = c.anchor;
      const body = {
        text: c.text,
        ...(c.parentId === undefined ? {} : { parent: { id: c.parentId } }),
        ...(a && {
          anchor: {
            path: a.path,
            ...(a.srcPath === null ? {} : { srcPath: a.srcPath }),
            line: a.line,
            lineType: a.lineType === "add" ? "ADDED" : "CONTEXT",
            fileType: "TO",
            diffType: "COMMIT",
            fromHash: a.fromHash,
            toHash: a.toHash,
          },
        }),
      };
      return client.post(`${prPath(ref)}/comments`, body, postedComment);
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
