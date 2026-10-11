// Plan r2 S-JIRA: the Jira REST client against the fake Jira. No test calls a real server.
import { afterEach, describe, expect, test } from "bun:test";
import { CAPS, createJiraSource } from "../../src/server/context/jira";
import { ContextError } from "../../src/server/context/source";
import { key, startFakeBitbucket } from "../support/fake-bitbucket";
import { type FakeJira, ISSUE_KEY, JIRA_TOKEN, startFakeJira } from "../support/fake-jira";

const stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
});

function setup(token = JIRA_TOKEN): { fake: FakeJira; source: ReturnType<typeof createJiraSource> } {
  const fake = startFakeJira();
  stops.push(fake.stop);
  return { fake, source: createJiraSource({ baseUrl: fake.url, token }) };
}

async function failure(p: Promise<unknown>): Promise<ContextError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ContextError) return e;
    throw e;
  }
  throw new Error("no error");
}

const ISSUE = `/rest/api/2/issue/${ISSUE_KEY}`;

describe("Jira client", () => {
  test("check sends the PAT as Bearer and returns the user name", async () => {
    const { fake, source } = setup();
    expect(await source.check()).toBe("jdoe");
    expect(fake.requests).toEqual(["GET /rest/api/2/myself"]);
  });

  test("a wrong token gives kind auth; the error holds no token and no body", async () => {
    const { fake, source } = setup("wrong-token-AAAA");
    const e = await failure(source.check());
    expect(e.kind).toBe("auth");
    expect(e.status).toBe(401);
    expect(e.message).toBe("auth 401: /rest/api/2/myself");
    expect(fake.requests.length).toBe(1);
  });

  test("fetchIssue reads the issue and two comment pages", async () => {
    const { fake, source } = setup();
    const issue = await source.fetchIssue(ISSUE_KEY);
    expect(issue).toEqual({
      key: ISSUE_KEY,
      summary: "Flush the cache before the write lock",
      status: "In Progress",
      description: expect.stringContaining("Acceptance criteria"),
      comments: [
        { author: "Alex Smith", created: "2026-01-05T09:12:31.000+0000", body: expect.stringContaining("before the lock") },
        { author: "Maria Lopez", created: "2026-01-06T14:03:10.000+0000", body: "Keep the batch size below 500 entries." },
        { author: "Kenji Ito", created: "2026-01-07T08:45:00.000+0000", body: "QA: test with an empty cache too." },
      ],
      commentsTotal: 3,
      truncated: false,
    });
    expect(fake.requests).toEqual([
      `GET ${ISSUE}?fields=summary,description,status`,
      `GET ${ISSUE}/comment?startAt=0&maxResults=100`,
      `GET ${ISSUE}/comment?startAt=2&maxResults=100`,
    ]);
  });

  test("a 302 is an error of kind redirect, and the client does not follow it", async () => {
    const other = startFakeBitbucket();
    stops.push(other.stop);
    const { fake, source } = setup();
    fake.routes[key("GET", "/rest/api/2/myself")] = { status: 302, headers: { Location: `${other.url}/login.jsp` } };
    const e = await failure(source.check());
    expect(e.kind).toBe("redirect");
    expect(e.status).toBe(302);
    expect(other.requests).toEqual([]);
  });

  test("404, a 500, and wrong shapes map to their kinds; no message holds the body", async () => {
    const { fake, source } = setup();
    expect((await failure(source.fetchIssue("ABC-404"))).kind).toBe("not_found");
    fake.routes[key("GET", ISSUE)] = { status: 200, body: "<html>SECRET-BODY</html>" };
    const e = await failure(source.fetchIssue(ISSUE_KEY));
    expect(e.kind).toBe("shape");
    expect(e.message).not.toContain("SECRET-BODY");
    fake.routes[key("GET", ISSUE)] = { status: 200, body: { fields: { summary: 5 } } };
    expect((await failure(source.fetchIssue(ISSUE_KEY))).kind).toBe("shape");
    fake.routes[key("GET", ISSUE)] = { status: 500, body: { errorMessages: ["SECRET-BODY"] } };
    const s = await failure(source.fetchIssue(ISSUE_KEY));
    expect(s.kind).toBe("server");
    expect(s.message).not.toContain("SECRET-BODY");
  });

  test("lenient shape: null description, no status, no author, extra keys", async () => {
    const { fake, source } = setup();
    fake.routes[key("GET", ISSUE)] = { status: 200, body: { key: ISSUE_KEY, extra: 1, fields: { summary: "S", description: null } } };
    fake.routes[key("GET", `${ISSUE}/comment`)] = {
      status: 200,
      body: { startAt: 0, maxResults: 100, total: 1, comments: [{ body: "B", created: "C" }] },
    };
    const issue = await source.fetchIssue(ISSUE_KEY);
    expect(issue).toMatchObject({ description: null, status: null, comments: [{ author: "(unknown)", body: "B" }], truncated: false });
  });

  test("caps cut the description and long comments, and set truncated", async () => {
    const { fake, source } = setup();
    fake.routes[key("GET", ISSUE)] = { status: 200, body: { fields: { summary: "S", description: "d".repeat(CAPS.description + 5) } } };
    fake.routes[key("GET", `${ISSUE}/comment`)] = {
      status: 200,
      body: { startAt: 0, maxResults: 100, total: 1, comments: [{ body: "c".repeat(CAPS.comment + 5), created: "C" }] },
    };
    const issue = await source.fetchIssue(ISSUE_KEY);
    expect(issue.description?.length).toBe(CAPS.description);
    expect(issue.comments[0]?.body.length).toBe(CAPS.comment);
    expect(issue.truncated).toBe(true);
  });

  test("the 200 KB total cap drops later comments; the 5-page cap stops paging", async () => {
    const { fake, source } = setup();
    const total = 1000;
    fake.routes[key("GET", `${ISSUE}/comment`)] = (req) => {
      const at = Number(new URL(req.url).searchParams.get("startAt"));
      const comments = Array.from({ length: 100 }, (_, i) => ({
        author: { name: "u" },
        created: "C",
        body: `${at + i} ${"x".repeat(3000)}`,
      }));
      return { status: 200, body: { startAt: at, maxResults: 100, total, comments } };
    };
    const issue = await source.fetchIssue(ISSUE_KEY);
    expect(fake.requests.filter((r) => r.includes("/comment")).length).toBe(5);
    expect(issue.commentsTotal).toBe(total);
    expect(issue.truncated).toBe(true);
    const bytes = issue.comments.reduce((n, c) => n + Buffer.byteLength(c.body) + 2, 0);
    expect(bytes).toBeLessThanOrEqual(CAPS.totalBytes);
    expect(issue.comments.length).toBeGreaterThan(50);
    expect(issue.comments.length).toBeLessThan(100);
  });

  test("plain http to a non-loopback host is refused; https and loopback http are accepted", () => {
    expect(() => createJiraSource({ baseUrl: "http://jira.example.test", token: "t" })).toThrow("must use https");
    expect(() => createJiraSource({ baseUrl: "https://jira.example.test/jira", token: "t" })).not.toThrow();
    expect(() => createJiraSource({ baseUrl: "http://127.0.0.1:1", token: "t" })).not.toThrow();
  });

  test("a key outside the Jira key pattern sends no request", async () => {
    const { fake, source } = setup();
    for (const bad of ["../myself", "abc-1", "ABC-1?x=1", "ABC-0"]) expect((await failure(source.fetchIssue(bad))).kind).toBe("not_found");
    expect(fake.requests).toEqual([]);
  });

  test("a context path stays in every request", async () => {
    const { fake } = setup();
    fake.routes[key("GET", "/jira/rest/api/2/myself")] = { status: 200, body: { name: "ctx" } };
    expect(await createJiraSource({ baseUrl: `${fake.url}/jira/`, token: JIRA_TOKEN }).check()).toBe("ctx");
  });
});
