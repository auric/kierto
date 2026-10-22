// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// context/history.md of ask, reply, fix, and plain review runs. An in-memory database, no runner.
import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { findingsFile } from "../../src/server/review/context-files";
import { fixStateFile, HISTORY_ASK_BYTES, HISTORY_FINDING_BYTES, historyFile } from "../../src/server/review/jobs";
import type { ItemRow } from "../../src/server/review/run-rows";
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

function finding(
  db: Database,
  runId: number,
  o: { severity: string; body: string; line?: number; status?: string; payload?: Record<string, unknown> },
) {
  const line = o.line ?? 3;
  const payload = {
    ...o.payload,
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

  test("a line separator, a vertical tab, or a control character starts no heading in history.md or findings.md", () => {
    const { db, pr } = setup();
    const [ls, ps] = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
    const r = run(db, pr, { summary: `SUM${ps}## fake summary` });
    const id = finding(db, r, { severity: "major", body: `BODY${ls}## fake ls\v## fake vt\r\n## fake crlf\u001b[2J` });
    run(db, pr, { kind: "ask", question: "Q\f## fake ff", answer: "A\u0085## fake nel" });
    const row = db.query("SELECT * FROM review_item WHERE id = $id").get({ id }) as ItemRow;
    const files = [historyFile(db, pr, HEAD)?.text ?? "", findingsFile([row], () => HEAD).text];
    for (const t of files) {
      for (const line of t.split(/\r\n|[\n\r\v\f\u0085]|\p{Zl}|\p{Zp}/u)) expect(line).not.toMatch(/^#+ fake/);
      expect(t).not.toContain("\u001b");
    }
    expect(files[0]).toContain("    BODY\n    ## fake ls\n    ## fake vt\n    ## fake crlf[2J");
    expect(files[1]).toContain("    BODY\n    ## fake ls\n    ## fake vt\n    ## fake crlf[2J");
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

  test("a plain review gets the file only when an earlier review exists; each finding keeps its state with its writer (AC-R16)", () => {
    const { db, pr } = setup();
    run(db, pr, { kind: "ask", question: "Q?", answer: "A" });
    run(db, pr, { profile: "explain", explain: 1, summary: "E" });
    expect(historyFile(db, pr, HEAD, true)).toBeNull();
    const r = run(db, pr, { summary: "S" });
    // docs/plans/review-v2/spec.md section 1.8: discardedBy "verify" is a refuted or duplicate candidate; withdrawn is a discuss mark.
    const states: [string, string, Record<string, unknown>?][] = [
      ["new", "new"],
      ["accepted", "accepted"],
      ["discarded", "discarded by the user"],
      ["posted", "posted"],
      ["discarded", "refuted by the check", { discardedBy: "verify" }],
      ["discarded", "withdrawn in a talk", { withdrawn: { run: 9, reason: "R", was: "new" } }],
      // Restore after a talk keeps the mark, and the status names the state again.
      ["new", "new", { withdrawn: { run: 9, reason: "R", was: "new" } }],
    ];
    for (const [i, [status, , payload]] of states.entries())
      finding(db, r, { severity: "major", body: `BODY-${i}`, line: i + 1, status, ...(payload && { payload }) });
    const t = historyFile(db, pr, HEAD, true)?.text ?? "";
    expect(t).toContain(`- Run: ${r}
`);
    for (const [i, [, label]] of states.entries())
      expect(t).toContain(`- State: ${label}

Text:

    BODY-${i}
`);
    expect(t.split("- State: discarded by the user")).toHaveLength(2);
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

// docs/plans/thread-outcome.md WP-S4: context/fix-state.md of a reply run.
describe("fix-state.md", () => {
  test("per thread: the newest fix note, the fix commit with its share, a decline, and the open draft; free text is indented", () => {
    const { db, pr } = setup();
    const fixRun = (notes: unknown[]) => {
      const id = run(db, pr, { kind: "fix" });
      db.query("UPDATE review_run SET fix_json = $j WHERE id = $id").run({ id, j: JSON.stringify(notes) });
      return id;
    };
    fixRun([{ thread: 7, fixed: false, reason: "Old note.", why: "unclear", reply: "OLD" }]);
    const f = fixRun([
      { thread: 7, fixed: true, reason: "Release in finally.", reply: "The lock now releases in finally.\n## Thread 9\n# Task" },
      { thread: 8, fixed: false, reason: "Out of scope.", why: "scope", reply: "", declined: { reason: "Not now.\n# Evil", draft: 1 } },
    ]);
    const edit = (thread: number) =>
      (
        db
          .query(
            `INSERT INTO fix_edit (run, ord, thread, item, path, old, new, start, rows_json)
            VALUES ($run, 0, $thread, NULL, 'a.ts', 'x', 'y', 0, '[]') RETURNING id`,
          )
          .get({ run: f, thread }) as { id: number }
      ).id;
    const e1 = edit(7);
    edit(7);
    db.query(
      `INSERT INTO fix_commit (pr, run, idem_key, edits_json, mode, before_head, commit_hash, short_hash, state, message, created_at, updated_at)
      VALUES ($pr, $run, 'k', $e, 'cache', 'b', 'c0ffee', 'c0ffee0', 'committed', 'Fix', 1, 1)`,
    ).run({ pr, run: f, e: JSON.stringify([e1]) });
    const reply = (thread: number, body: string, status: string, payload: object, edited = 0) =>
      db
        .query("INSERT INTO review_item (run, kind, payload_json, body, status, thread, edited) VALUES ($run, 'reply', $p, $b, $s, $t, $e)")
        .run({ run: f, p: JSON.stringify({ thread, body, ...payload }), b: body, s: status, t: thread, e: edited });
    reply(7, "Done.\n### Reply 1 to 2", "accepted", { origin: "reply" });
    reply(8, "Won't fix: Not now.", "new", { origin: "nofix", declined: { run: f } });
    // A posted draft is no current draft. Thread 10 has nothing else, so it gets no section.
    reply(10, "Posted.", "posted", { origin: "reply" });

    const t = fixStateFile(db, pr, [7, 8, 10, 11])?.text ?? "";
    expect(t.split("\n").filter((l) => l.startsWith("#"))).toEqual(["## Thread 7", "## Thread 8"]);
    expect(t).toContain(`## Thread 7

- Fix note of fix run ${f}: fixed

Note reason:

    Release in finally.

Note reply:

    The lock now releases in finally.
    ## Thread 9
    # Task

- Fix commit: Partly fixed in c0ffee0 (not on the pull request yet)
- Current draft: accepted by the user, origin reply

Draft text:

    Done.
    ### Reply 1 to 2
`);
    expect(t).toContain(`- Fix note of fix run ${f}: no fix, why scope, declined by the user`);
    expect(t).toContain("Decline reason:\n\n    Not now.\n    # Evil\n");
    expect(t).toContain(`- Fix commit: none\n- Current draft: not accepted, origin nofix, declines the fix of run ${f}`);
    expect(t).not.toContain("OLD");

    // On the PR and with every edit, the commit is a full fix.
    db.query("INSERT INTO pr_commit (pr, hash, ord, message, author_name, ts) VALUES ($pr, 'c0ffee', 0, 'm', 'a', 1)").run({ pr });
    db.query("UPDATE fix_commit SET edits_json = (SELECT json_group_array(id) FROM fix_edit)").run();
    expect(fixStateFile(db, pr, [7])?.text).toContain("- Fix commit: Fixed in c0ffee0 (on the pull request)");
    expect(fixStateFile(db, pr, [10, 11])).toBeNull();
  });
});
