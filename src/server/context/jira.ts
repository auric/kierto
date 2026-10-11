// Jira Server REST 2 client (BRIEF section 7, Jira 9.12 docs). The only module that sends requests to Jira. GET only.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { type IssueContext, JIRA_KEY } from "../../shared/dto";
import { ContextError, type ContextErrorKind, type ContextSource } from "./source";

export const JIRA = { id: "jira", name: "Jira" } as const;

const TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
export const CAPS = { description: 20_000, comment: 5_000, comments: 500, totalBytes: 200_000 };
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Lenient: unknown keys pass. The real shapes are not recorded (integration-check.md, Release 2).
const myself = z.object({ name: z.string() });
const issue = z.object({
  fields: z.object({
    summary: z.string(),
    description: z.string().nullish(),
    status: z.object({ name: z.string() }).nullish(),
  }),
});
const user = z.object({ displayName: z.string().nullish(), name: z.string().nullish() }).nullish();
const commentPage = z.object({
  total: z.number().int().nonnegative(),
  comments: z.array(z.object({ author: user, body: z.string().nullish(), created: z.string().nullish() })),
});

export type JiraOptions = { baseUrl: string; token: string; caFile?: string; timeoutMs?: number };

function kindOf(status: number): ContextErrorKind {
  if (status >= 300 && status < 400) return "redirect";
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429 || status === 503) return "rate";
  return "server";
}

// Throws a plain Error for a bad URL scheme, and an fs error with a `code` for an unreadable CA file.
export function createJiraSource(opts: JiraOptions): ContextSource {
  const url = new URL(opts.baseUrl);
  // The token must not travel in clear text. Plain http is for the loopback test server only.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new Error("The Jira URL must use https.");
  }
  const base = opts.baseUrl.replace(/\/+$/, "");
  const ca = opts.caFile ? readFileSync(opts.caFile, "utf8") : undefined;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  async function get<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
    const endpoint = path.split("?")[0] ?? path;
    const target = new URL(base + path);
    if (target.origin !== url.origin) throw new ContextError("shape", endpoint);
    let res: Response;
    let text: string;
    try {
      res = await fetch(target, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
        tls: ca ? { ca } : undefined,
      });
      text = await res.text();
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const safe = typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : undefined;
      throw new ContextError((e as Error).name === "TimeoutError" ? "timeout" : "network", endpoint, undefined, safe);
    }
    if (res.status < 200 || res.status > 299) throw new ContextError(kindOf(res.status), endpoint, res.status);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ContextError("shape", endpoint, res.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ContextError("shape", endpoint, res.status);
    return parsed.data;
  }

  return {
    ...JIRA,
    check: async () => (await get("/rest/api/2/myself", myself)).name,
    async fetchIssue(key) {
      if (!JIRA_KEY.test(key)) throw new ContextError("not_found", "/rest/api/2/issue");
      const path = `/rest/api/2/issue/${encodeURIComponent(key)}`;
      const { fields } = await get(`${path}?fields=summary,description,status`, issue);

      const raw: z.infer<typeof commentPage>["comments"] = [];
      let total = 0;
      let truncated = true;
      for (let i = 0, startAt = 0; i < MAX_PAGES; i++) {
        const page = await get(`${path}/comment?startAt=${startAt}&maxResults=${PAGE_SIZE}`, commentPage);
        raw.push(...page.comments);
        total = page.total;
        startAt += page.comments.length;
        if (!page.comments.length || startAt >= page.total) {
          truncated = false;
          break;
        }
      }

      const cut = (s: string, max: number) => {
        if (s.length <= max) return s;
        truncated = true;
        return s.slice(0, max);
      };
      const description = fields.description == null ? null : cut(fields.description, CAPS.description);
      let bytes = Buffer.byteLength(fields.summary) + Buffer.byteLength(description ?? "");
      const comments: IssueContext["comments"] = [];
      if (raw.length > CAPS.comments) truncated = true;
      for (const c of raw.slice(0, CAPS.comments)) {
        const out = {
          author: c.author?.displayName || c.author?.name || "(unknown)",
          created: c.created ?? "",
          body: cut(c.body ?? "", CAPS.comment),
        };
        bytes += Buffer.byteLength(out.author) + Buffer.byteLength(out.created) + Buffer.byteLength(out.body);
        if (bytes > CAPS.totalBytes) {
          truncated = true;
          break;
        }
        comments.push(out);
      }
      return { key, summary: fields.summary, status: fields.status?.name ?? null, description, comments, commentsTotal: total, truncated };
    },
  };
}
