// context/history.md of ask, reply, fix, and plain review runs. An in-memory database, no runner.
import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { HISTORY_ASK_BYTES, HISTORY_FINDING_BYTES, historyFile } from "../../src/server/review/jobs";
import { openDb } from "../../src/server/storage/db";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

function setup() {
  const db = openDb(":memory:");
  const { id: pr } = db.query("INSERT INTO pull_request (project, repo, pr_id) VALUES ('PROJ', 'repo', 2) RETURNING id").get() as {
    id: number;
  };
  return { db, pr };
}

function run(
  db: Database,
  pr: number,
  o: {
    kind?: string;
    status?: string;
    profile?: string;
    head?: string;
    question?: string;
    answer?: string;
    summary?: string;
    explain?: number;
  },
) {
  return (
    db
      .query(
        `INSERT INTO review_run (pr, kind, profile, profile_name, explain, note, idem_key, source_head, target_head, merge_base, status, started_at, summary_json, question, answer)
        VALUES ($pr, $kind, $profile, $name, $explain, '', 'k', $head, 't', 'm', $status, 1, $summary, $question, $answer) RETURNING id`,
      )
      .get({
        pr,
        kind: o.kind ?? "review",
        profile: o.profile ?? "general",
        name: o.profile === "explain" ? "Explain" : "General",
        explain: o.explain ?? 0,
        head: o.head ?? HEAD,
        status: o.status ?? "completed",
        summary: o.summary === undefined ? null : JSON.stringify({ summary: o.summary, risks: [], coverage: {}, dropped: [] }),
        question: o.question ?? null,
        answer: o.answer ?? null,
      }) as { id: number }
  ).id;
}

function finding(db: Database, runId: number, o: { severity: string; body: string; line?: number; status?: string }) {
  const line = o.line ?? 3;
  const payload = {
    path: "src/app.ts",
    side: "new",
    line,
    lineEnd: null,
    anchorText: "x",
    severity: o.severity,
    category: "Correctness",
    body: o.body,
    evidence: "",
    evidenceStatus: "code",
    confidence: "high",
    agent: null,
    anchor: { state: "exact", path: "src/app.ts", oldPath: null, line, lineEnd: line, excerpt: [] },
  };
  return (
    db
      .query(
        `INSERT INTO review_item (run, kind, payload_json, body, path, side, line, line_end, anchor_state, status)
        VALUES ($run, 'finding', $payload, $body, 'src/app.ts', 'new', $line, $line, 'exact', $status) RETURNING id`,
      )
      .get({ run: runId, payload: JSON.stringify(payload), body: o.body, line, status: o.status ?? "new" }) as { id: number }
  ).id;
}

describe("historyFile", () => {
  test("no file without an earlier finished review or ask", () => {
    const { db, pr } = setup();
    expect(historyFile(db, pr, HEAD)).toBeNull();
    run(db, pr, { status: "failed", summary: "S" });
    run(db, pr, { status: "cancelled" });
    run(db, pr, { profile: "explain", explain: 1, summary: "E" });
    run(db, pr, { kind: "ask", status: "failed", question: "Q?" });
    run(db, pr, { kind: "ask", status: "running", question: "Q?" });
    run(db, pr, { kind: "reply", summary: "R" });
    expect(historyFile(db, pr, HEAD)).toBeNull();
  });

  test("the newest finished review: profile, head note, summary, findings by severity with state; asks newest first", () => {
    const { db, pr } = setup();
    const older = run(db, pr, { summary: "OLDER-REVIEW" });
    finding(db, older, { severity: "major", body: "OLDER-FINDING" });
    const r = run(db, pr, { status: "incomplete", head: OLD, summary: "REVIEW-SUMMARY" });
    const nit = finding(db, r, { severity: "nit", body: "NIT-BODY", line: 4 });
    const blocker = finding(db, r, { severity: "blocker", body: "BLOCKER-BODY\n## not a heading", status: "accepted" });
    db.query("INSERT INTO review_item (run, kind, payload_json, body, status) VALUES ($run, 'question', '{}', 'QUESTION-BODY', 'new')").run(
      { run: r },
    );
    run(db, pr, { status: "failed", summary: "FAILED-REVIEW" });
    const a1 = run(db, pr, { kind: "ask", question: "FIRST?", answer: "FIRST-ANSWER" });
    const a2 = run(db, pr, { kind: "ask", status: "incomplete", question: "SECOND?", answer: "SECOND-ANSWER" });

    const f = historyFile(db, pr, HEAD);
    expect(f?.name).toBe("history.md");
    const t = f?.text ?? "";
    expect(t).toContain(`- Run: ${r}\n- Profile: General\n- Status: incomplete\n- Reviewed head: ${OLD} (the current head is ${HEAD})\n`);
    expect(t).toContain("    REVIEW-SUMMARY");
    for (const gone of ["OLDER", "FAILED-REVIEW", "QUESTION-BODY"]) expect(t).not.toContain(gone);
    expect(t.indexOf(`### Finding ${blocker}`)).toBeLessThan(t.indexOf(`### Finding ${nit}`));
    expect(t).toContain(`- Lines: 3 at ${OLD}\n- Severity: blocker\n- Category: Correctness\n- State: accepted\n`);
    expect(t).toContain("    BLOCKER-BODY\n    ## not a heading");
    expect(t.indexOf(`## Ask run ${a2}`)).toBeLessThan(t.indexOf(`## Ask run ${a1}`));
    expect(t).toContain("Question:\n\n    SECOND?\n\nAnswer:\n\n    SECOND-ANSWER");
    expect(t).not.toContain("left out");

    expect(historyFile(db, pr, OLD)?.text).toContain(`- Reviewed head: ${OLD}\n`);
  });

  test("asks alone, and a review with no findings", () => {
    const { db, pr } = setup();
    run(db, pr, { kind: "ask", question: "Q?", answer: "A" });
    const t = historyFile(db, pr, HEAD)?.text ?? "";
    expect(t).not.toContain("## Latest review");
    expect(t).toContain("## Ask run");
    run(db, pr, { summary: "S" });
    expect(historyFile(db, pr, HEAD)?.text).toContain("No findings.");
  });

  test("a plain review gets the file only when an earlier review exists; each finding keeps its state", () => {
    const { db, pr } = setup();
    run(db, pr, { kind: "ask", question: "Q?", answer: "A" });
    run(db, pr, { profile: "explain", explain: 1, summary: "E" });
    expect(historyFile(db, pr, HEAD, true)).toBeNull();
    const r = run(db, pr, { summary: "S" });
    const states = ["new", "accepted", "discarded", "posted"];
    for (const [i, status] of states.entries()) finding(db, r, { severity: "major", body: `BODY-${status}`, line: i + 1, status });
    const t = historyFile(db, pr, HEAD, true)?.text ?? "";
    expect(t).toContain(`- Run: ${r}
`);
    for (const status of states)
      expect(t).toContain(`- State: ${status}

Text:

    BODY-${status}
`);
    expect(t).toContain("## Ask run");
  });

  test("the byte caps keep the first findings and the newest asks", () => {
    const { db, pr } = setup();
    const r = run(db, pr, { summary: "S" });
    const big = "x".repeat(10 * 1024);
    for (let i = 0; i < 10; i++) finding(db, r, { severity: "minor", body: `F${i} ${big}`, line: i + 1 });
    const asks = Array.from({ length: 6 }, (_, i) => run(db, pr, { kind: "ask", question: `Q${i}?`, answer: `A${i} ${big}` }));
    const t = historyFile(db, pr, HEAD)?.text ?? "";
    const review = t.slice(0, t.indexOf("## Ask run"));
    const ask = t.slice(t.indexOf("## Ask run"));
    expect(Buffer.byteLength(review)).toBeLessThan(HISTORY_FINDING_BYTES + 1024);
    expect(Buffer.byteLength(ask)).toBeLessThan(HISTORY_ASK_BYTES + 1024);
    expect(review).toContain("    F0 ");
    expect(review).toContain("5 more findings left out.");
    expect(review).not.toContain("    F5 ");
    expect(ask).toContain(`## Ask run ${asks[5]}`);
    expect(ask).not.toContain(`## Ask run ${asks[2]}`);
    expect(ask).toContain("3 earlier ask runs left out.");
  });
});
