// context/task.md of a run (plan r2 WP0): the imported task text of the PR. The workspace puts the UNTRUSTED banner before it.
import type { Database } from "bun:sqlite";
import type { IssueContext } from "../../shared/dto";
import type { ContextFile } from "../review/workspace";

export const TASK_FILE = "task.md";

const SOURCES: Record<string, string> = { jira: "Jira" };

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");

// No row: no file.
export function taskFiles(db: Database, pr: number): ContextFile[] {
  type Row = { key: string; source: string; json: string; fetched_at: number };
  const rows = db.query("SELECT key, source, json, fetched_at FROM task_context WHERE pr = $pr ORDER BY key").all({ pr }) as Row[];
  if (!rows.length) return [];
  const out: string[] = [];
  for (const r of rows) {
    const i = JSON.parse(r.json) as IssueContext;
    out.push(
      `## Task ${r.key}: ${oneLine(i.summary)}`,
      "",
      `- Source: ${SOURCES[r.source] ?? r.source}`,
      `- Status: ${oneLine(i.status ?? "(none)")}`,
      `- Fetched: ${new Date(r.fetched_at).toISOString()}`,
      ...(i.truncated ? ["- The app cut this text at its size limits."] : []),
      "",
      "### Description",
      "",
      i.description?.trim() || "(none)",
      "",
      `### Comments (${i.comments.length} of ${i.commentsTotal})`,
      "",
    );
    for (const c of i.comments) out.push(`#### ${oneLine(c.author)}, ${oneLine(c.created)}`, "", c.body, "");
    if (!i.comments.length) out.push("(none)", "");
  }
  return [{ name: TASK_FILE, text: out.join("\n") }];
}
