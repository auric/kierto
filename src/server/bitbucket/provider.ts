// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// ForgeProvider for Bitbucket Server. It returns forge-neutral types from src/shared/types.ts.
import { z } from "zod";
import {
  anchorSpan,
  type Change,
  type Comment,
  type CommentStatus,
  type Commit,
  type ExcerptLine,
  type ListResult,
  type PrRef,
  type PullRequest,
  type Role,
  type User,
} from "../../shared/types";
import { type ClientOptions, createClient, ForgeError } from "./client";
import { activity, change, comment, commit, postedComment, pullRequest, type RawComment, type RawDiff, type user } from "./schemas";

const API = "/rest/api/1.0";
const DASHBOARD = `${API}/dashboard/pull-requests`;

const prPath = (ref: PrRef) =>
  `${API}/projects/${encodeURIComponent(ref.project)}/repos/${encodeURIComponent(ref.repo)}/pull-requests/${ref.id}`;
const toUser = (u: z.infer<typeof user>): User => ({ slug: u.slug, name: u.displayName, login: u.name });

const cloneRepo = z.object({
  links: z.object({ clone: z.array(z.object({ href: z.string(), name: z.string() })).optional() }).optional(),
});
const remoteRef = z.object({ id: z.string(), repository: cloneRepo });
const remoteRefs = z.object({ fromRef: remoteRef, toRef: remoteRef });

// plan v3 WP4: the anchor line (a range: its lines) plus 3 lines on each side, each line cut at 500 chars.
const EXCERPT_SIDE = 3;
const EXCERPT_TEXT = 500;
const KIND: Record<string, ExcerptLine["kind"]> = { ADDED: "add", REMOVED: "del", CONTEXT: "ctx" };

// The excerpt of an inline comment from its activity diff. No match gives undefined.
// The row that lists the comment ID in commentIds wins. Else the anchor line names the row. fileType FROM numbers it on the old side.
// Gate v3 U4: a CONTEXT anchor numbers its row on the old side, whatever fileType says. The excerpt still numbers ctx lines on the fileType side.
// Gate A U2: that row is the end of a range. commentIds mark only the end row. The excerpt numbers a range on the new side and marks each row from the span start to the end row.
export function excerptOf(
  diff: RawDiff,
  anchor: { line?: number; lineType?: string; fileType?: string; multilineSpan?: unknown },
  id?: number,
): ExcerptLine[] | undefined {
  if (anchor.line === undefined) return undefined;
  const old = anchor.fileType === "FROM";
  const span = anchorSpan(anchor);
  const want = anchor.lineType === undefined ? undefined : KIND[anchor.lineType];
  const n = (kind: ExcerptLine["kind"], l: { source: number; destination: number }, oldSide: boolean) =>
    kind === "del" || (kind === "ctx" && oldSide) ? l.source : l.destination;
  const hunks = diff.hunks.map((h) =>
    h.segments.flatMap((s) => {
      const kind = KIND[s.type];
      return kind
        ? s.lines.map((l) => ({
            kind,
            n: n(kind, l, old),
            out: n(kind, l, old && !span),
            source: l.source,
            dest: l.destination,
            text: l.line,
            ids: l.commentIds,
          }))
        : [];
    }),
  );
  type Row = (typeof hunks)[number][number];
  const marked = (l: Row) => id !== undefined && !!l.ids?.includes(id);
  const named = (l: Row) =>
    (want === "ctx" ? l.source : l.n) === anchor.line && (want ? l.kind === want : l.kind !== (old ? "add" : "del"));
  for (const match of [marked, named])
    for (const lines of hunks) {
      const at = lines.findIndex(match);
      if (at < 0) continue;
      const start = span ? lines.findIndex((l, i) => i <= at && l.kind !== "del" && l.dest === span.line) : -1;
      const from = start < 0 ? at : start;
      const lo = Math.max(0, from - EXCERPT_SIDE);
      return lines
        .slice(lo, at + EXCERPT_SIDE + 1)
        .map((l, i) => ({ n: l.out, kind: l.kind, text: l.text.slice(0, EXCERPT_TEXT), hit: lo + i >= from && lo + i <= at }));
    }
  return undefined;
}

// Newest first: each commit comes before its parents. Ties go to the newer commit time, then to the hash.
// Gate v3 U15: the server order is not recorded, so it is not used.
export function newestFirst(list: Commit[]): Commit[] {
  const byHash = new Map(list.map((c) => [c.hash, c]));
  const kids = new Map<string, number>();
  for (const c of byHash.values()) for (const p of c.parents) if (byHash.has(p)) kids.set(p, (kids.get(p) ?? 0) + 1);
  const ready = [...byHash.values()].filter((c) => !kids.get(c.hash));
  const out: Commit[] = [];
  while (ready.length) {
    ready.sort((a, b) => b.committedAt - a.committedAt || (a.hash < b.hash ? -1 : 1));
    const c = ready.shift() as Commit;
    out.push(c);
    for (const p of c.parents) {
      const left = (kids.get(p) ?? 0) - 1;
      kids.set(p, left);
      const parent = byHash.get(p);
      if (left === 0 && parent) ready.push(parent);
    }
  }
  return out;
}

// The branch page: the repository browse link with the full ref name, as the file links use `?at=` (Gate v3 U5).
// ponytail: "?at=<ref>" is not verified on a real server, as the file link suffix. Verify it in the browser.
export const branchUrl = (repoUrl: string | undefined, ref: string | undefined): string | undefined =>
  repoUrl && ref ? `${repoUrl.replace(/\/+$/, "")}?at=${encodeURIComponent(ref)}` : undefined;

// A new-side line of the diff between two fixed commits. fromHash: the target head. toHash: the reviewed source head (I8).
// line: the new-side line of an added line, the old-side line of a context line (Gate v3 U4).
export type NewAnchor = { path: string; srcPath: string | null; line: number; lineType: "add" | "ctx"; fromHash: string; toHash: string };
export type NewComment = { text: string; parentId?: number; anchor?: NewAnchor };

// The thread state after a resolve or a reopen, read back from the root comment.
export type ThreadState = { version: number; threadResolved: boolean; threadResolver?: User; threadResolvedAt?: number };
// done: the root comment has the wanted state. changed: the version moved between the read and the PUT (HTTP 409).
// forbidden: HTTP 401 or 403. gone: no such comment (HTTP 404). ignored: Bitbucket took the PUT, but the state stayed.
export type ResolveResult = { status: "done"; state: ThreadState } | { status: "changed" | "forbidden" | "gone" | "ignored" };

export function createBitbucketProvider(opts: ClientOptions) {
  const client = createClient(opts);
  const origin = new URL(opts.baseUrl).origin;

  // A server link stays only when it has the configured origin.
  const own = (href: string | undefined): string | undefined => {
    try {
      return href && new URL(href).origin === origin ? href : undefined;
    } catch {
      return undefined;
    }
  };

  function toPr(p: z.infer<typeof pullRequest>): PullRequest {
    const repoUrl = own(p.toRef.repository.links?.self?.[0]?.href);
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
      webUrl: own(p.links?.self?.[0]?.href),
      repoUrl,
      sourceBranchUrl: branchUrl(own(p.fromRef.repository.links?.self?.[0]?.href), p.fromRef.id),
      targetBranchUrl: branchUrl(repoUrl, p.toRef.id),
      authorUrl: own(p.author.user.links?.self?.[0]?.href),
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
    // Gate v3 U16: a reply carries a copy of the root anchor. The thread comes only from the nesting, so a reply keeps no anchor.
    async listComments(ref: PrRef): Promise<ListResult<Comment>> {
      const r = await client.list(`${prPath(ref)}/activities`, activity);
      const byId = new Map<number, Comment>();
      const visit = (c: RawComment, parentId: number | null, rootId: number, diff: RawDiff | undefined) => {
        const prev = byId.get(c.id);
        if (!prev || c.version > prev.version) {
          const root = parentId === null;
          const excerpt = root && c.anchor && diff ? excerptOf(diff, c.anchor, c.id) : undefined;
          byId.set(c.id, {
            id: c.id,
            version: c.version,
            parentId,
            rootId,
            author: toUser(c.author),
            text: c.text,
            anchor: root ? c.anchor : undefined,
            threadResolved: c.threadResolved ?? false,
            // A reopened thread has threadResolved false, so it drops both.
            ...(root && c.threadResolved && c.threadResolver && { threadResolver: toUser(c.threadResolver) }),
            ...(root && c.threadResolved && typeof c.threadResolvedDate === "number" && { threadResolvedAt: c.threadResolvedDate }),
            createdAt: c.createdDate,
            updatedAt: c.updatedDate,
            severity: c.severity,
            state: c.state,
            ...(excerpt && { excerpt }),
          });
        }
        for (const child of c.comments ?? []) visit(child, c.id, rootId, undefined);
      };
      for (const a of r.items) if (a.comment) visit(a.comment, null, a.comment.id, a.diff);
      return { ...r, items: [...byId.values()] };
    },

    // Read only when the PR heads change (plan v3 WP4).
    async listCommits(ref: PrRef): Promise<ListResult<Commit>> {
      const r = await client.list(`${prPath(ref)}/commits`, commit);
      const items = r.items.map(
        (c): Commit => ({
          hash: c.id,
          parents: c.parents.map((p) => p.id),
          message: c.message,
          authorSlug: c.author.slug ?? null,
          authorName: c.author.displayName ?? c.author.name,
          at: c.authorTimestamp,
          committedAt: c.committerTimestamp,
        }),
      );
      return { ...r, items: newestFirst(items) };
    },

    async listChanges(ref: PrRef): Promise<ListResult<Change>> {
      const r = await client.list(`${prPath(ref)}/changes`, change);
      return { ...r, items: r.items.map((c) => ({ path: c.path.toString, srcPath: c.srcPath?.toString ?? null, type: c.type })) };
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

    // Resolves or reopens the thread of a root comment: GET for a fresh version, PUT {version, threadResolved}, then GET again.
    // Docs (7.21, 9.0): the PUT needs the current version. Only the comment author, the PR author, or a repo admin may change it.
    // UNVERIFIED (integration-check.md U62 to U66): the PUT body field, the 409 on a stale version, and the version bump.
    // The second GET decides, so a PUT that Bitbucket takes without a state change gives "ignored", never "done".
    // Other errors throw a ForgeError. Nothing repeats the PUT.
    async setThreadResolved(ref: PrRef, rootId: number, resolved: boolean): Promise<ResolveResult> {
      const path = `${prPath(ref)}/comments/${rootId}`;
      const read = async (): Promise<ThreadState> => {
        const c = (await client.get(path, comment)).data;
        return {
          version: c.version,
          threadResolved: c.threadResolved ?? false,
          ...(c.threadResolved && c.threadResolver && { threadResolver: toUser(c.threadResolver) }),
          ...(c.threadResolved && typeof c.threadResolvedDate === "number" && { threadResolvedAt: c.threadResolvedDate }),
        };
      };
      try {
        const before = await read();
        if (before.threadResolved === resolved) return { status: "done", state: before };
        await client.put(path, { version: before.version, threadResolved: resolved }, z.unknown());
        const after = await read();
        return after.threadResolved === resolved ? { status: "done", state: after } : { status: "ignored" };
      } catch (e) {
        if (!(e instanceof ForgeError)) throw e;
        if (e.status === 409) return { status: "changed" };
        if (e.kind === "auth" || e.kind === "forbidden") return { status: "forbidden" };
        if (e.kind === "not_found") return { status: "gone" };
        throw e;
      }
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
