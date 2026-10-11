import { afterEach, describe, expect, test } from "bun:test";
import { ForgeError } from "../../src/server/bitbucket/client";
import { createBitbucketProvider } from "../../src/server/bitbucket/provider";
import { FAKE_TOKEN, type FakeBitbucket, fixture, key, type Route, startFakeBitbucket } from "../support/fake-bitbucket";
import {
  ACTIVITIES_PATH,
  activities,
  byUser,
  clone,
  DASHBOARD_PATH,
  findComment,
  PR_PATH,
  PR_REF,
  pageRoutes,
  pages,
  secondUser,
  versionZero,
} from "../support/scenarios";

process.env.REVIEW_LOOP_SECRETS = "memory";

let fake: FakeBitbucket;
afterEach(() => fake?.stop());

function setup(routes: Record<string, Route> = {}, timeoutMs?: number) {
  fake = startFakeBitbucket({ routes });
  return createBitbucketProvider({ baseUrl: fake.url, token: FAKE_TOKEN, timeoutMs });
}

async function caught(p: Promise<unknown>): Promise<ForgeError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ForgeError) return e;
    throw e;
  }
  throw new Error("expected a ForgeError");
}

const inline = () => activities("activities-inline-anchored.json");

describe("paging", () => {
  test("last page with absent nextPageStart completes", async () => {
    const p = setup(pageRoutes(ACTIVITIES_PATH, pages(inline(), [2, 1], "absent")));
    const r = await p.listComments(PR_REF);
    expect(r.complete).toBe(true);
    expect(r.items.map((c) => c.id).sort()).toEqual([1000001, 1000002, 1000003]);
  });

  test("last page with null nextPageStart completes", async () => {
    const p = setup(pageRoutes(ACTIVITIES_PATH, pages(inline(), [1, 1, 1], "null")));
    const r = await p.listComments(PR_REF);
    expect(r.complete).toBe(true);
    expect(r.items).toHaveLength(3);
  });

  test("isLastPage false without a cursor is incomplete", async () => {
    const list = pages(inline(), [2, 1], "absent");
    delete list[0]?.nextPageStart;
    const p = setup(pageRoutes(ACTIVITIES_PATH, list));
    const r = await p.listComments(PR_REF);
    expect(r).toMatchObject({ complete: false, reason: "cursor" });
  });

  test("a cursor that does not advance is incomplete", async () => {
    const list = pages(inline(), [2, 1], "absent");
    if (list[0]) list[0].nextPageStart = 0;
    const p = setup(pageRoutes(ACTIVITIES_PATH, list));
    expect(await p.listComments(PR_REF)).toMatchObject({ complete: false, reason: "cursor" });
  });

  test("pages assemble in order and request each start once", async () => {
    const dash = fixture<{ values: unknown[] }>("dashboard-reviewer-page.json").body.values[0];
    const own = fixture<{ values: unknown[] }>("dashboard-pull-requests-page.json").body.values[0];
    const p = setup(pageRoutes(DASHBOARD_PATH, pages([dash, own], [1, 1], "absent")));
    const r = await p.listDashboard("REVIEWER");
    expect(r.complete).toBe(true);
    expect(r.items.map((x) => x.ref.id)).toEqual([1001, 2]);
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[0]).toContain("role=REVIEWER");
    expect(fake.requests[1]).toContain("start=1");
  });

  test("an error on page 2 gives incomplete with the error kind", async () => {
    const list = pages(inline(), [2, 1], "absent");
    const routes = pageRoutes(ACTIVITIES_PATH, list);
    routes[key("GET", ACTIVITIES_PATH, 2)] = { status: 500, body: {} };
    const r = await setup(routes).listComments(PR_REF);
    expect(r).toMatchObject({ complete: false, reason: "server", error: { kind: "server", status: 500 } });
  });

  test("a parse failure is incomplete and names the endpoint", async () => {
    const list = pages(inline(), [3], "absent");
    const bad = clone(list[0]) as unknown as { values: { comment?: { version: unknown } }[] };
    if (bad.values[0]?.comment) bad.values[0].comment.version = "x";
    const r = await setup({ [key("GET", ACTIVITIES_PATH)]: { status: 200, body: bad } }).listComments(PR_REF);
    expect(r).toMatchObject({ complete: false, reason: "shape" });
    if (!r.complete) expect(r.error?.endpoint).toBe(ACTIVITIES_PATH);
  });

  test("more than 200 pages is incomplete", async () => {
    const p = setup({
      [key("GET", ACTIVITIES_PATH)]: (req) => {
        const start = Number(new URL(req.url).searchParams.get("start"));
        return { status: 200, body: { size: 0, limit: 1, start, isLastPage: false, nextPageStart: start + 1, values: [] } };
      },
    });
    expect(await p.listComments(PR_REF)).toMatchObject({ complete: false, reason: "page_limit" });
    expect(fake.requests).toHaveLength(200);
  });
});

describe("comments", () => {
  test("nested reply flattens with parent and root", async () => {
    const r = await setup({ [key("GET", ACTIVITIES_PATH)]: fixture("activities-nested-reply.json") }).listComments(PR_REF);
    expect(r.complete).toBe(true);
    expect(r.items).toHaveLength(2);
    const root = r.items.find((c) => c.id === 1000003);
    const reply = r.items.find((c) => c.id === 1000001);
    expect(root).toMatchObject({ parentId: null, rootId: 1000003 });
    expect(reply).toMatchObject({ parentId: 1000003, rootId: 1000003, author: { slug: "jdoe", name: "Jane Doe" } });
  });

  test("a reply to a reply keeps its direct parent and the top root", async () => {
    const list = activities("activities-nested-reply.json");
    const reply = findComment(list, 1000001);
    reply.comments = [{ ...clone(reply), id: 1000009, comments: [] }];
    const body = { size: 2, limit: 50, start: 0, isLastPage: true, values: list };
    const r = await setup({ [key("GET", ACTIVITIES_PATH)]: { status: 200, body } }).listComments(PR_REF);
    expect(r.items.find((c) => c.id === 1000009)).toMatchObject({ parentId: 1000001, rootId: 1000003 });
  });

  test("the recorded edit gives version 1", async () => {
    const r = await setup({ [key("GET", ACTIVITIES_PATH)]: fixture("activities-after-edit.json") }).listComments(PR_REF);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ id: 1000003, version: 1 });
  });

  test("a duplicate ID keeps the higher version in any order", async () => {
    const after = activities("activities-after-edit.json");
    const before = versionZero(after, 1000003);
    for (const values of [[...before, ...after], [...after, ...before].reverse()]) {
      const body = { size: values.length, limit: 50, start: 0, isLastPage: true, values };
      const r = await setup({ [key("GET", ACTIVITIES_PATH)]: { status: 200, body } }).listComments(PR_REF);
      fake.stop();
      expect(r.items).toHaveLength(1);
      expect(r.items[0]?.version).toBe(1);
    }
  });

  test("a comment by a second user maps that user", async () => {
    const values = byUser(activities("activities-after-edit.json"), 1000003, secondUser());
    const body = { size: 2, limit: 50, start: 0, isLastPage: true, values };
    const r = await setup({ [key("GET", ACTIVITIES_PATH)]: { status: 200, body } }).listComments(PR_REF);
    expect(r.items[0]?.author).toEqual({ slug: "asmith", name: "Alex Smith", login: "asmith" });
  });

  test("the inline anchor maps path and line", async () => {
    const r = await setup({ [key("GET", ACTIVITIES_PATH)]: fixture("activities-inline-anchored.json") }).listComments(PR_REF);
    expect(r.items.find((c) => c.id === 1000002)?.anchor).toMatchObject({ path: "sample1.md", line: 3, orphaned: false });
  });

  test("unknown action and state values parse", async () => {
    const values = activities("activities-inline-anchored.json");
    values.push({ ...clone(values[2] ?? { id: 0, action: "" }), id: 10000099, action: "RESCOPED" });
    values.push({ ...clone(values[2] ?? { id: 0, action: "" }), id: 10000098, action: "SOMETHING_NEW" });
    const first = values[0];
    if (first) first.commentAction = "UNKNOWN_ACTION";
    const body = { size: values.length, limit: 50, start: 0, isLastPage: true, values };
    const r = await setup({ [key("GET", ACTIVITIES_PATH)]: { status: 200, body } }).listComments(PR_REF);
    expect(r.complete).toBe(true);
    expect(r.items).toHaveLength(3);

    const pr = clone(fixture<Record<string, unknown>>("pull-request.json"));
    pr.body.state = "SOME_NEW_STATE";
    const got = await setup({ [key("GET", PR_PATH)]: pr }).getPullRequest(PR_REF);
    expect(got.state).toBe("SOME_NEW_STATE");
  });

  test("commentStatus: 200 is present, 404 is deleted, other errors throw", async () => {
    const path = `${PR_PATH}/comments/1000003`;
    const p = setup({
      [key("GET", path)]: fixture("comment-with-nested-reply.json"),
      [key("GET", `${PR_PATH}/comments/1000004`)]: fixture("comment-get-after-delete-404.json"),
      [key("GET", `${PR_PATH}/comments/1000005`)]: { status: 500, body: {} },
    });
    expect(await p.commentStatus(PR_REF, 1000003)).toBe("present");
    expect(await p.commentStatus(PR_REF, 1000004)).toBe("deleted");
    expect((await caught(p.commentStatus(PR_REF, 1000005))).kind).toBe("server");
  });
});

describe("pull requests", () => {
  test("getPullRequest maps the recorded PR", async () => {
    const pr = await setup({ [key("GET", PR_PATH)]: fixture("pull-request.json") }).getPullRequest(PR_REF);
    expect(pr).toMatchObject({
      ref: PR_REF,
      version: 0,
      state: "OPEN",
      author: { slug: "jdoe", name: "Jane Doe" },
      reviewers: [],
      sourceHead: "ba939ffe19df61d874683e85bb168c1769985d23",
      sourceBranch: "topic/sample-1",
      targetBranch: "topic/sample-2",
    });
    expect(pr.description).toBeUndefined();
    expect(pr.webUrl).toBeUndefined();
  });

  test("the web link stays only when its origin equals the base origin", async () => {
    const body = clone(fixture<{ links: { self: { href: string }[] } }>("pull-request.json"));
    const p = setup({ [key("GET", PR_PATH)]: body });
    const link = body.body.links.self[0];
    if (link) link.href = `${fake.url}/users/jdoe/repos/sample-repo-1/pull-requests/2`;
    expect((await p.getPullRequest(PR_REF)).webUrl).toBe(`${fake.url}/users/jdoe/repos/sample-repo-1/pull-requests/2`);
  });

  type CloneRepo = { links: { clone: { href: string; name: string }[] } };
  const httpLink = (r: CloneRepo) => r.links.clone.find((l) => l.name === "http") as { href: string };

  test("gitRemote takes the http clone links of the base origin, without user info", async () => {
    const body = clone(fixture<{ fromRef: { repository: CloneRepo }; toRef: { repository: CloneRepo } }>("pull-request.json"));
    const p = setup({ [key("GET", PR_PATH)]: body });
    httpLink(body.body.toRef.repository).href = `${fake.url.replace("//", "//jdoe:pw@")}/scm/~jdoe/sample-repo-1.git`;
    httpLink(body.body.fromRef.repository).href = `${fake.url}/scm/~jdoe/fork-1.git`;
    expect(await p.gitRemote(PR_REF)).toEqual({
      url: `${fake.url}/scm/~jdoe/sample-repo-1.git`,
      sourceUrl: `${fake.url}/scm/~jdoe/fork-1.git`,
      sourceRef: "refs/heads/topic/sample-1",
      targetRef: "refs/heads/topic/sample-2",
      fetchConfig: [["http.extraHeader", `Authorization: Bearer ${FAKE_TOKEN}`]],
    });
  });

  test("gitRemote refuses a clone link of another origin", async () => {
    const body = clone(fixture<{ fromRef: { repository: CloneRepo } }>("pull-request.json"));
    const p = setup({ [key("GET", PR_PATH)]: body });
    await expect(p.gitRemote(PR_REF)).rejects.toThrow(/clone link/);
    // Only the target link is foreign now.
    httpLink(body.body.fromRef.repository).href = `${fake.url}/scm/~jdoe/sample-repo-1.git`;
    await expect(p.gitRemote(PR_REF)).rejects.toThrow(/clone link/);
  });

  test("dashboard maps reviewers with lastReviewedCommit", async () => {
    const r = await setup({ [key("GET", DASHBOARD_PATH)]: fixture("dashboard-reviewer-page.json") }).listDashboard("REVIEWER");
    expect(r.complete).toBe(true);
    expect(r.items[0]).toMatchObject({
      ref: { project: "PROJ1", repo: "sample-repo-2", id: 1001 },
      author: { slug: "asmith" },
      reviewers: [{ slug: "jdoe", status: "UNAPPROVED", lastReviewedCommit: "c5bf8bfcb823b4949bc9bfe280c5ffc3ffd0a151" }],
    });
  });
});

describe("errors", () => {
  test("currentUser returns X-AUSERNAME", async () => {
    const p = setup({ [key("GET", DASHBOARD_PATH)]: fixture("dashboard-pull-requests-page.json") });
    expect(await p.currentUser()).toBe("jdoe");
    expect(fake.requests[0]).toContain("limit=1");
  });

  test("currentUser without X-AUSERNAME is auth", async () => {
    const p = setup({ [key("GET", DASHBOARD_PATH)]: fixture("dashboard-pull-requests-page.json") });
    fake.user = null;
    expect((await caught(p.currentUser())).kind).toBe("auth");
  });

  test("401 gives auth", async () => {
    const p = setup({ [key("GET", DASHBOARD_PATH)]: fixture("dashboard-pull-requests-page.json") });
    fake.token = "another-token";
    expect((await caught(p.currentUser())).kind).toBe("auth");
    expect((await caught(p.getPullRequest(PR_REF))).kind).toBe("auth");
  });

  test("status codes map to kinds and keep Retry-After", async () => {
    const at = (s: number, headers?: Record<string, string>) => ({ [key("GET", PR_PATH)]: { status: s, body: {}, headers } });
    expect((await caught(setup(at(403)).getPullRequest(PR_REF))).kind).toBe("forbidden");
    fake.stop();
    expect((await caught(setup(at(404)).getPullRequest(PR_REF))).kind).toBe("not_found");
    fake.stop();
    const rate = await caught(setup(at(429, { "Retry-After": "17" })).getPullRequest(PR_REF));
    expect(rate).toMatchObject({ kind: "rate", status: 429, retryAfter: "17" });
    fake.stop();
    expect((await caught(setup(at(503)).getPullRequest(PR_REF))).kind).toBe("rate");
  });

  test("a 3xx is an error and the client sends no second request", async () => {
    const p = setup({
      [key("GET", PR_PATH)]: { status: 302, headers: { Location: "/elsewhere" } },
      [key("GET", "/elsewhere")]: fixture("pull-request.json"),
    });
    const e = await caught(p.getPullRequest(PR_REF));
    expect(e).toMatchObject({ kind: "server", status: 302 });
    expect(fake.requests).toHaveLength(1);
  });

  test("a hung request times out", async () => {
    const p = setup({ [key("GET", PR_PATH)]: { hang: true } }, 100);
    expect((await caught(p.getPullRequest(PR_REF))).kind).toBe("timeout");
  });

  test("a dropped connection is a network error", async () => {
    const p = setup({ [key("GET", PR_PATH)]: { drop: true } });
    expect((await caught(p.getPullRequest(PR_REF))).kind).toBe("network");
  });

  test("a closed port is a network error", async () => {
    const p = setup();
    fake.stop();
    expect((await caught(p.getPullRequest(PR_REF))).kind).toBe("network");
  });

  test("no error holds the token", async () => {
    const errors: ForgeError[] = [];
    const routes = {
      [key("GET", PR_PATH)]: { status: 302, headers: { Location: `/x?t=${FAKE_TOKEN}` } },
      [key("GET", `${PR_PATH}/comments/1`)]: { status: 500, body: { errors: [{ message: FAKE_TOKEN }] } },
      [key("GET", `${PR_PATH}/comments/2`)]: { drop: true as const },
      [key("GET", `${PR_PATH}/comments/4`)]: { hang: true as const },
    };
    const p = setup(routes, 100);
    errors.push(await caught(p.getPullRequest(PR_REF)));
    for (const id of [1, 2, 4]) errors.push(await caught(p.commentStatus(PR_REF, id)));
    fake.token = "x";
    errors.push(await caught(p.currentUser()));
    const r = await setup({ [key("GET", ACTIVITIES_PATH)]: { status: 200, body: { values: FAKE_TOKEN } } }).listComments(PR_REF);
    if (!r.complete && r.error instanceof ForgeError) errors.push(r.error);
    expect(errors.map((e) => e.kind)).toEqual(["server", "server", "network", "timeout", "auth", "shape"]);
    for (const e of errors) {
      for (const s of [e.message, String(e), JSON.stringify(e), e.stack ?? ""]) expect(s).not.toContain(FAKE_TOKEN);
    }
  });

  test("requests in flight never exceed 2", async () => {
    const routes: Record<string, { status: number; body: unknown; delayMs: number }> = {};
    for (let id = 1; id <= 8; id++) routes[key("GET", `${PR_PATH}/comments/${id}`)] = { status: 200, body: {}, delayMs: 30 };
    routes[key("GET", PR_PATH)] = { ...fixture("pull-request.json"), delayMs: 30 };
    const p = setup(routes);
    await Promise.all([
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((id) => p.commentStatus(PR_REF, id)),
      p.getPullRequest(PR_REF),
      p.getPullRequest(PR_REF),
    ]);
    expect(fake.requests).toHaveLength(10);
    expect(fake.maxInFlight).toBe(2);
  });

  test("plain http to a non-loopback host is refused", () => {
    expect(() => createBitbucketProvider({ baseUrl: "http://bitbucket.example.test", token: FAKE_TOKEN })).toThrow();
    expect(() => createBitbucketProvider({ baseUrl: "ftp://127.0.0.1", token: FAKE_TOKEN })).toThrow();
  });
});
