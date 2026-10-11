// Fake Jira Server for tests and the demo. It listens on 127.0.0.1 only and serves fixtures/jira/ payloads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { key, startFakeBitbucket } from "./fake-bitbucket";

export const JIRA_TOKEN = "fake-jira-token-fedcba9876543210";
export const ISSUE_KEY = "ABC-42";

// Reads a raw response body from fixtures/jira/.
export function jiraFixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dir, "../../fixtures/jira", name), "utf8"));
}

type Page = { startAt: number; maxResults: number; total: number; comments: unknown[] };

export function startFakeJira(opts: { port?: number; https?: boolean } = {}) {
  const fake = startFakeBitbucket(opts);
  fake.token = JIRA_TOKEN;
  fake.user = null;
  fake.routes[key("GET", "/rest/api/2/myself")] = { status: 200, body: jiraFixture("myself.json") };

  // Serves issue.json and the two comment pages under this key.
  function addIssue(issueKey: string, summary?: string) {
    const issue = jiraFixture<{ key: string; fields: { summary: string } }>("issue.json");
    issue.key = issueKey;
    if (summary) issue.fields.summary = summary;
    const pages = [jiraFixture<Page>("comments-p0.json"), jiraFixture<Page>("comments-p1.json")];
    const path = `/rest/api/2/issue/${issueKey}`;
    fake.routes[key("GET", path)] = { status: 200, body: issue };
    fake.routes[key("GET", `${path}/comment`)] = (req) => {
      const at = Number(new URL(req.url).searchParams.get("startAt") ?? 0);
      return { status: 200, body: pages.find((p) => p.startAt === at) ?? { startAt: at, maxResults: 2, total: 3, comments: [] } };
    };
  }
  addIssue(ISSUE_KEY);

  return Object.assign(fake, { addIssue });
}

export type FakeJira = ReturnType<typeof startFakeJira>;
