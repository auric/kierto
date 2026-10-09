// Synthetic states derived from the recorded fixtures (fixtures/bitbucket/README.md, "Synthetic scenarios").
import { fixture, key, type Reply } from "./fake-bitbucket";

export type RawComment = { id: number; version: number; text: string; author: unknown; comments?: RawComment[]; [k: string]: unknown };
export type Activity = { id: number; action: string; comment?: RawComment; [k: string]: unknown };
export type Page<T = unknown> = {
  size: number;
  limit: number;
  start: number;
  isLastPage: boolean;
  nextPageStart?: number | null;
  values: T[];
};

// The recorded single PR: personal repository ~JDOE, PR 2.
export const PR_REF = { project: "~JDOE", repo: "sample-repo-1", id: 2 };
export const PR_PATH = "/rest/api/1.0/projects/~JDOE/repos/sample-repo-1/pull-requests/2";
export const ACTIVITIES_PATH = `${PR_PATH}/activities`;
export const DASHBOARD_PATH = "/rest/api/1.0/dashboard/pull-requests";

export const clone = <T>(v: T): T => structuredClone(v);

export function activities(name: string): Activity[] {
  return clone(fixture<Page<Activity>>(name).body.values);
}

// Splits values into pages. The last page omits nextPageStart ("absent") or sets it to null ("null").
export function pages<T>(values: T[], sizes: number[], last: "absent" | "null"): Page<T>[] {
  const out: Page<T>[] = [];
  let start = 0;
  sizes.forEach((size, i) => {
    const isLast = i === sizes.length - 1;
    const page: Page<T> = { size, limit: size, start, isLastPage: isLast, values: values.slice(start, start + size) };
    if (!isLast) page.nextPageStart = start + size;
    else if (last === "null") page.nextPageStart = null;
    out.push(page);
    start += size;
  });
  return out;
}

// One route per page, keyed by its start value.
export function pageRoutes(path: string, list: Page[]): Record<string, Reply> {
  return Object.fromEntries(list.map((p) => [key("GET", path, p.start), { status: 200, body: p }]));
}

export function findComment(list: Activity[], id: number): RawComment {
  const walk = (c: RawComment | undefined): RawComment | undefined => (c?.id === id ? c : c?.comments?.map(walk).find(Boolean));
  const hit = list.map((a) => walk(a.comment)).find(Boolean);
  if (!hit) throw new Error(`comment ${id} not in scenario`);
  return hit;
}

// The state before the recorded edit: the comment at version 0.
export function versionZero(list: Activity[], id: number): Activity[] {
  const out = clone(list);
  const c = findComment(out, id);
  c.version = 0;
  c.text = `${c.text} (before edit)`;
  return out;
}

// A second user. Every recorded comment is by the token owner; the reviewer dashboard holds the only other person.
export function secondUser(): { slug: string; displayName: string } & Record<string, unknown> {
  type Pr = { author: { user: { slug: string; displayName: string } & Record<string, unknown> } };
  const pr = fixture<Page<Pr>>("dashboard-reviewer-page.json").body.values[0];
  if (!pr) throw new Error("dashboard-reviewer-page.json has no PR");
  return clone(pr.author.user);
}

export function byUser(list: Activity[], id: number, user: unknown): Activity[] {
  const out = clone(list);
  findComment(out, id).author = clone(user);
  return out;
}
