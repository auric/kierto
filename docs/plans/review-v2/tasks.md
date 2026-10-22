# Review v2 plan: tasks

Status: decided, 2026-10-22. design.md gives the decisions; section 10 holds the user's answers of 2026-10-22. spec.md gives the behavior and the acceptance criteria (AC-…). The user approved Q1 to Q5 on 2026-10-22. Part 6 starts only after Gate WP-G0 passes, and write runs only after Gate B17 passes (Q1). Part 7 (Autopilot replies, section 5) was added on 2026-10-22 after the user's decisions Q25 to Q27. Post mode ships only after Gate G-EVAL-A and the user smoke UA1. Part 7 is on hold since 2026-10-22 (design.md section 10.3), and its waves are not in the active order. Part 2 gained "PR context and PR notes" on 2026-10-22: WP-PG (W2) and WP-PN (W3).

## 0. Rules for every work package

- Read CLAUDE.md of the repository first. In a worktree, also read the CLAUDE.md of the main checkout (first path of `git worktree list`). Read the three plan files.
- One implementer per package, with the tier named in its heading: implementer (Opus, medium), implementer-xhigh, or frontend-implementer. A failed implementer run goes to implementer-xhigh.
- Each package ends green on `bun run check` (typecheck, typecheck:5, lint, bun test).
- A package that touches e2e files runs `bun run test:e2e`. A parallel worktree sets its own ports, for example `E2E_JIRA_PORT=7537 E2E_FAKE_PORT=7538 E2E_APP_PORT=7539`, and its report quotes the `E2E code:` line of serve.ts.
- A package that changes the UI runs `bun run screenshots`, checks each image for real names, hosts, and paths, updates README.md, and runs the web-design-guidelines review on its screens.
- Each safety check of a package gets one control mutation that turns its test red. The report names the mutation and the "imported from <path>" proof.
- Tests use the fake CLI (`runnerCommand`), the fake Bitbucket, the fake Jira, and temp git repos. No test touches the real CLI, the real Bitbucket, or the user's data folder.
- New source files start with the SPDX and copyright header. CHANGELOG.md gets user-visible changes only.
- The orchestrator reviews and commits. Implementers never commit.

## 1. Order, dependencies, and waves

| Wave | Packages (∥ = parallel worktrees) | Needs |
|---|---|---|
| W1 | WP-D1 ∥ WP-M1 ∥ WP-G0 | the user's go for parts 1 to 4 (given 2026-10-22) |
| U1 | User gate G-EVAL-0: baseline eval of the current prompts | WP-M1 |
| W2 | WP-R1 ∥ WP-PG | U1 (WP-R1); none (WP-PG) |
| UG | User gate G9 and G12 on the test repository | WP-PG |
| W3 | WP-R2, then WP-R3 (same files) ∥ WP-M2 ∥ WP-PN (merges after WP-R3 and rebases on it) | WP-R1; WP-PN also UG recorded (else stored peer PRs only) |
| U2 | User gate G-EVAL-1: v2 against the baseline. Tune the constants before W4. | WP-R3 |
| W4 | WP-R4 ∥ WP-X1 | WP-R3 |
| W5 | WP-X2 ∥ WP-D2 | WP-X1 (X2), WP-R3 (D2) |
| W6 | WP-D3 | WP-D2, WP-R4 |
| U3 | User smoke docs/smoke-v2.md parts A to E | W6 |
| W7 | WP-D6, then WP-B0 | Gate WP-G0 passed (Q1 to Q5 approved 2026-10-22) |
| W8 | WP-B1 ∥ WP-B2 | WP-B0 |
| W9 | WP-B3, then WP-B4, then WP-B5 | WP-B1, WP-B2 |
| US | User smoke docs/smoke-task.md part S (small task end to end) | W9 |
| W10 | WP-B6 ∥ WP-B7 | US |
| UM | User smoke part M (medium task) | W10 |
| W11 | WP-B8, then WP-B9 ∥ WP-B10 | UM |
| UL | User smoke part L (large task with a stack) | W11 |
| W12 | WP-CLOSE | UL |

### On hold: part 7 waves

On hold (2026-10-22): the user paused autopilot; a human posts every reply. Keep for later. These waves are not in the active order. When part 7 resumes, WA0 also needs WP-PN merged, and WP-A1 takes the next free migration number.

Part 7 waves (parallel worktrees next to part 6; section 5):

| Wave | Packages | Needs |
|---|---|---|
| WA0 | WP-DA ∥ WP-GA | the user's decisions Q25 to Q27 (2026-10-22); WP-D2 merged (part 2 reply work) |
| WA1 | WP-A1 | WP-B0 merged (migration 031 and the review_run rebuild); WP-D2 |
| WA2 | WP-A2 ∥ WP-A4 | WP-A1; Gate G9 recorded by WP-PG (else context/open-prs.md stays absent) |
| WA3 | WP-A3 | WP-A2 |
| UA1 | User smoke docs/smoke-autopilot.md part 1 (draft mode on a test PR) | WA3 |
| WA4 | WP-A5, then WP-A7 | UA1; Gate G8 recorded (delete) |
| UA2 | User gate G-EVAL-A (reply eval, post mode) | WP-A5, WP-A4 |
| WA5 | WP-A6 | UA2 passed, WP-A7 |
| UA3 | User smoke part 2 (post mode, cancel, delete, the delete-with-reply refusal) | WA5 |
| WA6 | WP-A8 (level 3) | WP-B8 (W11), WP-A7 |

### Task sizes and file ownership

What each task size needs:

| Size | Packages |
|---|---|
| Small | WP-G0, WP-D6, WP-B0, WP-B1 (push, create PR, repository remote), WP-B2, WP-B3, WP-B4, WP-B5 |
| Medium | Small, plus WP-B6 (spec PR, gate, Fix on task branches) and WP-B7 (UI) |
| Large | Medium, plus WP-B8 (stack, retarget, rebase, replan, builds gate), WP-B9 (UI), WP-B10 (notifications and inbox rows) |

Shared-file ownership (merge order):

| File | Owners |
|---|---|
| src/shared/review.ts, src/shared/dto.ts, migrations 030 | WP-R1 → WP-R2 → WP-R3 → WP-PN → WP-X1 → WP-D2 → WP-M2 (additive only after WP-R1) |
| src/server/review/catalog.ts, prompt.ts, context-files.ts | WP-R1 → WP-R2 → WP-R3 → WP-PN → WP-X1 → WP-D2 |
| src/server/review/jobs.ts, judge.ts, validate.ts | WP-R2 → WP-R3 → WP-PN → WP-X1 → WP-D2 → WP-B0 |
| src/server/review/items.ts | WP-M2 → WP-D2 |
| src/shared/outcome.ts (new), src/web/review/outcome.ts, src/web/fix/model.ts, src/web/pr/threads.ts | WP-PN (the move), then any later owner |
| migration 032 (pr_note), src/server/review/{pr-context.ts, notes.ts, notes-routes.ts}, src/web/pr/Notes.tsx | WP-PN |
| src/web/review/ReplyDraft.tsx | WP-PN → WP-D3 |
| src/web/review/Drafts.tsx, Brief.tsx, RunLine.tsx | WP-R4 → WP-D3 |
| src/web/pr/Markdown.tsx | WP-X2 |
| src/server/bitbucket/* | WP-PN (listOpenPullRequests, buildStats; reads only) → WP-B1 |
| scripts/eval/* | WP-M1 → WP-PN (`--replies` mode, adds only) |
| migration 031, src/shared/task.ts | WP-B0 |
| src/server/tasks/* | WP-B2 → WP-B3 → WP-B4 → WP-B6 → WP-B8 |
| src/web/tasks/* | WP-B5 → WP-B7 → WP-B9 → WP-B10 |
| tests/e2e/serve.ts, control.ts, tests/support/fake-claude.ts, fake-bitbucket.ts | WP-R1 → WP-PN → WP-B1 → WP-A1 (on hold) (the later owner adds only) |
| migration 033 or the next free number, src/shared/autopilot.ts (on hold) | WP-A1 → WP-A5 (additive only after WP-A1) |
| src/server/autopilot/* (on hold) | WP-A2 → WP-A5 → WP-A7 → WP-A8 |
| src/web/autopilot/* (on hold) | WP-A3 → WP-A6 |
| src/server/review/jobs.ts, catalog.ts, prompt.ts, src/server/publish/outbox.ts, src/server/sync/engine.ts (part 7 additions, on hold) | WP-A2 → WP-A5 → WP-A7, additive only. The later merger of part 6 and part 7 rebases. |
| scripts/gate/bitbucket-write.ts | WP-G0 → WP-PG → WP-GA (on hold) (adds only) |

## 2. Work packages: parts 1 to 4

### WP-D1. Docs for parts 1 to 4 (implementer, W1)

- Files: BRIEF.md (sections of spec.md section 10 for parts 1 to 4 only), CLAUDE.md (status line, document map row for docs/plans/review-v2/), integration-check.md (rows "Review v2 (not run)": U-rows for the verify schema, the explain schema, the discuss schema, and the effort per agent).
- Tests: none.

### WP-M1. Eval harness and fixture cases (implementer-xhigh, W1)

- Files: scripts/eval/{run.ts, score.ts, compare.ts, cases.ts} (new); fixtures/eval/cases/<12 cases>/ (new); fixtures/eval/README.md; package.json scripts `eval`, `eval:compare`; tests/eval/{score.test.ts, harness.test.ts} (new).
- Behavior: spec.md section 4.3. It runs the current review pipeline (version 1 prompts), so the baseline is real. The scorer reads both version 1 items (no verdict: all shown) and version 2 items.
- Cases: synthetic code only, 4 TypeScript, 4 C++, 4 Python, the bug and trap kinds of spec.md section 4.3. Each case README line says what it seeds.
- Tests: score.test.ts with a fixed result file (AC-M1). harness.test.ts runs one case with the fake CLI through `--runner` and checks the result file shape (AC-M3). `eval` without `--real` exits 2 (AC-M2).
- Control mutation: make the overlap test exclusive at the ends. A boundary case must fail.
- Risk: the review job needs settings and a provider. Use the `gitRemote` and data-folder options that the e2e serve.ts already uses.

### WP-G0. Gate checks for the new CLI and Bitbucket facts (implementer, W1)

- Files: scripts/gate/claude-checks.ts (B17 to B20), scripts/gate/bitbucket-write.ts (new, G1 to G7), docs/gate-v2.md (how to run, what PASS means).
- B17 write confinement: a throwaway temp folder with repo/ and context/. Flags of an implement run (`--tools Read,Grep,Glob,Edit,Write`, `--allowedTools` the same, `--restricted`, `--strict-mcp-config`, no `--permission-mode`). Prompt: write repo/a.txt, ../outside.txt, and an absolute temp path. PASS: repo/a.txt exists, the other two do not, and init lists only the five tools and StructuredOutput.
- B18: a verify-shaped run with `--effort medium` and an agents file with rl-verifier effort high. PASS: the run accepts both (B13 covered model and effort; this records them with the verify schema).
- B19 INFO: the result event of a subscription run: usage keys and total_cost_usd present or absent.
- B20: one Haiku run each with explainJsonSchema(), discussJsonSchema(), interviewResult, specResult, and implementResult schemas. PASS: structured_output parses with zod.
- G1 to G7 run only on the designated test repository with separate authorization: G1 repository clone links and a push of a new branch with an empty lease (and the 403 text of a read-only token, if the user has one); G2 create PR with one reviewer; G3 build stats of a commit with and without builds; G4 PUT with a new toRef; G5 delete the target branch of a stacked PR and record the outcome (declined or moved); G6 a lease failure when the remote branch moved; G7 INFO, a PR with the Jira key in its title gets the task chip after a sync.
- Each check has `--dry-run`. Cost caps and output sanitizing as B1 to B16.
- Tests: argument parsing and dry-run output only.

### WP-R1. Contracts for review v2 (implementer-xhigh, W2)

- Files: src/shared/review.ts (finding v2 keys, verifyResult, explainResult, discussResult, REVIEW_PROMPT_VERSION, constants); src/shared/dto.ts (modules, volume, verifier; RunKind adds explain and discuss; ItemActionInput reason; DTOs for discuss, explain, stats); src/server/storage/migrations/030_review_v2.sql; src/server/storage/db.ts; src/server/review/catalog.ts (SHIPPED_PROFILES, FORMER[4], Former keys, deep compare); src/server/config.ts (PROFILES_VERSION 5); src/server/settings.ts (retire rule); src/web/review/model.ts (RUN_TEXT and KIND_LABEL for the new kinds); tests/support/fake-claude.ts (echo per new schema).
- Behavior: spec.md sections 1.2, 1.5 (schema only), 1.6 (schema only), 2.2, 3.3, 8 (030).
- Tests: db.test.ts for 030 (spec.md section 8). catalog and settings tests: AC-R11, AC-R12, AC-X8; a version 4 config with every profile edited keeps all four; a version 5 config changes nothing; profileRevision of an unchanged version 4 profile stays the same when the new fields hold their defaults. review.test.ts: AC-R14 (draft-07, required keys, old results parse).
- Control mutation: compare modules with === in upgradeProfile. AC-R11 must fail.

### WP-R2. Finder prompts, modules, delegation, and scoped rules (implementer-xhigh, W3)

- Files: src/server/review/catalog.ts (FINDER_RULES, DO_NOT_FLAG, rubric with the volume nit line, MODULES, contextBlock, mainAgent and reviewerAgent for review runs, DELEGATE without the check line); src/server/review/prompt.ts (Tools line text kept; no PR text in stdin); src/server/review/jobs.ts (agents by diff size, module and context flags into the agent builders, prompt_version on insert); src/server/review/instructions.ts (scoped CLAUDE.md of changed folders, scope headers, instructions_json scopes); src/server/review/improve.ts (Improve prompt shows the new shared rules and the module names); src/server/review/context-files.ts (history.md writer labels); tests/review/{prompt.test.ts, delegate.test.ts (new), instructions.test.ts, improve.test.ts, history.test.ts}.
- Behavior: spec.md sections 1.3, 1.5, 1.8 (history.md), AC-R2, AC-R3 (reviewer part), AC-R13, AC-R15, AC-R16.
- Tests: the prompt snapshot per profile, module set, and volume; no "Give no finding to fill the list" in review agents; ask, reply, and fix agents unchanged (snapshot); delegation at 200 and 1,300 changed lines and in modes off and always; scoped instructions for a change in src/server/ load src/server/CLAUDE.md of the target head and not web/CLAUDE.md.
- Control mutation: give the Agent tool for every diff size. The 200-line delegation test must fail.

### WP-R3. Verify phase, validation, dedupe, and caps (implementer-xhigh, W3 after WP-R2)

- Files: src/server/review/jobs.ts (verify step after the finder, before the workspace leaves; phase "checking"; VERIFY_MAX_TURNS; cancel between phases); src/server/review/judge.ts (merge of the finder result and the verdicts, caps, items, summary verify and phases); src/server/review/validate.ts (changed-line test, cause anchor, rule quote check, drop reasons unchanged and rule); src/server/review/context-files.ts (candidatesFile); src/server/review/catalog.ts (verifyAgent, verifierAgent); src/server/review/stream.ts (phase tag on events, if needed); src/shared/dto.ts (Dropped reasons, RunDto phase); tests/review/{verify.test.ts (new), validate.test.ts, judge.test.ts, jobs.test.ts}.
- Behavior: spec.md sections 1.6, 1.7, 1.8, 1.9. AC-R1, AC-R3 (verify part), AC-R4 to AC-R10.
- Tests (fake CLI with two scripted outputs): two processes per run; one run row; the second phase uses verifyJsonSchema; a missing verdict makes the run incomplete; a usage limit in phase 2 gives incomplete with unchecked items; caps table cases; dedupe groups across three overlapping anchors; re-review candidates; cancel during phase 2 ends cancelled and removes the workspace.
- Control mutations: skip the cap for unsure (AC-R5 fails); drop the changed-line test (AC-R7 fails).
- Risk: the workspace removal moves after phase 2. Check the restart recovery and the held.ws path.

### WP-M2. Outcome tracking and stats (implementer, W3)

- Files: src/server/review/items.ts (action reason); src/server/review/stats.ts (new); src/server/review/routes.ts (GET /api/stats/review); src/shared/dto.ts (ReviewStatsDto, reason action); src/web/review/Drafts.tsx (discard reason chips, small part only); src/web/settings/ReviewQuality.tsx (new); tests/review/stats.test.ts (new); tests/e2e/m4.e2e.ts or a new stats.e2e.ts. Ports 7527/7528/7529.
- Behavior: spec.md sections 4.1, 4.2. AC-M4, AC-M5.
- Gates: screenshots and README for the chips and the Settings table.
- Control mutation: count refuted items as discarded by the user. The stats test must fail.

### WP-PG. Gate checks G9 and G12 for the PR context (implementer, W2)

- Files: scripts/gate/bitbucket-write.ts (adds G9, moved from WP-GA, and G12), docs/gate-v2.md (rows), integration-check.md (rows G9 and G12, "not run").
- G9: GET the open PRs of the test repository with limit 50. Record the shape: id, title, author, state, fromRef, toRef, updatedDate, isLastPage.
- G12: GET `/changes` of one open PR of the test repository where the token user is neither author nor reviewer. Record the status, the shape (path, srcPath, type), and isLastPage. PASS: HTTP 200 with the same shape as listChanges of an own PR.
- Each check has `--dry-run`. Output sanitizing as B1 to B16. Separate authorization as G1 to G7.
- Tests: argument parsing and dry-run output only.

### WP-PN. PR context and PR notes (implementer-xhigh, W3, parallel worktree, ports 7517/7518/7519)

- Files: src/shared/outcome.ts (new: threadOutcome and its pure helpers moved from src/web/review/outcome.ts, src/web/fix/model.ts, src/web/pr/threads.ts, src/web/review/model.ts; the web modules re-export them); src/server/review/context-files.ts (prContextFile, notesFile, caps); src/server/review/pr-context.ts (new: loadPrContext, peer cache); src/server/review/fix-routes.ts (the fix rows of GET fixes as one exported function); src/server/review/jobs.ts (both files for reply, review, re-review, fix, and ask runs; focus threads; log counts; apply cites and proposals of reply runs); src/server/review/prompt.ts (two Tools lines); src/server/review/catalog.ts (PR_CONTEXT_RULES in the context block, NOTES_RULES in replyAgent); src/server/review/validate.ts (reply cites); src/server/review/notes.ts and notes-routes.ts (new); src/server/app.ts (mount the notes routes); src/server/bitbucket/provider.ts and schemas (listOpenPullRequests, buildStats; reads only); src/shared/review.ts (noteProposal, cites, notes, constants; discussResult gets notes and cites with defaults); src/shared/dto.ts (NoteDto, route inputs, ReviewItemDto notes and cites); src/server/storage/migrations/032_pr_notes.sql; src/server/storage/db.ts; src/web/pr/Notes.tsx (new), src/web/pr/PrDetail.tsx (the block), src/web/review/ReplyDraft.tsx (suggestion row, cites line); tests/support/fake-bitbucket.ts (open-PR list, changes of any PR, build stats); tests/support/fake-claude.ts (notes and cites echo); scripts/eval/{run.ts, score.ts} (`--replies`) and fixtures/eval/replies/{general-decision, general-decision-control}/ (new); tests/review/{pr-context.test.ts, notes.test.ts, outcome-parity.test.ts} (new), tests/web/outcome.test.ts (imports), tests/storage/db.test.ts, tests/eval/replies.test.ts (new), tests/e2e/notes.e2e.ts (new); BRIEF.md (the spec.md section 10 row "part 2, PR context and notes"); CHANGELOG.md.
- Behavior: spec.md sections 2.7 to 2.13. AC-P1 to AC-P12.
- Depends: WP-R1 merged (migration 030 and the discussResult schema). UG recorded for the Bitbucket peer reads (G9, G12); else the loader uses stored rows only and the file says so. Merge after WP-R3 and rebase on it: WP-R2 and WP-R3 own catalog.ts, prompt.ts, jobs.ts, and context-files.ts in the same wave. WP-PN adds to those files only.
- Hand-offs: WP-D2 adds pr-context.md and notes.md to discuss runs, the focus thread of a posted finding, and the apply of discuss cites and proposals (discuss_json). WP-D3 shows the suggestion row and the cites line on a discuss answer. WP-X1 gives Explain neither file. WP-B1 reuses provider.buildStats.
- Tests: the builder over fixed rows (layout, banner, focus full text, digest lines, sort, every cap and count line, same bytes twice, deleted threads gone, no proposed or dismissed note); the State line equals threadOutcome over the outcome.test.ts cases; peer overlap with stored rows, with fake-Bitbucket rows, with a rename, a failed list, and a timeout; stdin canaries in a comment and in a proposed note; proposals: the user-message rule, repeats, the cap, the PR link rule, one transaction with the drafts; cites drops; the routes (version, cap, 404 link, Undo); db.test.ts for 032 (spec.md section 8 rules); the eval scorer with a fixed result file and `--replies` without `--real` exits 2; e2e of AC-P12 with axe.
- Control mutations: let a proposed note into notes.md (AC-P7 fails); skip the user-message check of proposals (AC-P9 fails); sort other threads oldest first (AC-P4 fails).
- Gates: screenshots (Notes block with a kept note and a suggestion, a draft card with a suggestion and a cites line), README section "PR notes", web-design-guidelines, axe. docs/smoke-v2.md part E (WP-CLOSE writes the final text): a real PR with a decision in the general thread, Draft replies on an inline thread, the cites line, Keep a suggestion, and a second run that sees it.
- Eval: the user runs `bun run eval -- --replies --real --repeat 2` after WP-PN. Recommended pass: the general-decision case gives judgement invalid with cites 230 in both repeats, and the control case gives valid or partly.

### WP-R4. Review UI v2 (frontend-implementer, W4, ports 7537/7538/7539)

- Files: src/web/review/{Brief.tsx (checkboxes, More checks, volume control, one primary), Drafts.tsx (ledger, groups by check and volume, fold, check chip, trigger line, check reason line), RunLine.tsx (phase line, time per phase, refuted and duplicate list with Restore, "The check did not finish" line), model.ts (display group rules from spec.md section 1.4, plain-word labels)}; src/web/diff/FileDiff.tsx (check chip on diff cards); tests/web/review-v2.test.ts (new); tests/e2e/review-v2.e2e.ts (new).
- Behavior: spec.md sections 1.1, 1.4, 1.9. AC-UX1 to AC-UX3 and AC-UX10 for the brief and Drafts.
- Tests: pure display rules per volume; e2e: a scripted two-phase run, then the ledger, the fold, a refuted item in the run record, Restore, keys a, d, e on a fold item.
- Gates: screenshots (brief, Drafts with fold, run record), README section "Review", web-design-guidelines.

### WP-X1. Explain server (implementer, W4)

- Files: src/server/review/catalog.ts (explainAgent, Explain lens); src/server/review/prompt.ts (buildExplainPrompt); src/server/review/jobs.ts (kind explain spec branch, no history or questions files); src/server/review/judge.ts (judgeExplain, link and fence checks); src/server/review/routes.ts (POST and GET /api/prs/:id/explain); src/shared/dto.ts (ExplainDto); tests/review/explain.test.ts (new).
- Behavior: spec.md sections 3.2 to 3.4. AC-X2, AC-X3 (server part), AC-X4, AC-X7 (server part). Explain runs get no pr-context.md and no notes.md (AC-P3).
- Control mutation: accept a link to an unchanged file. AC-X3 must fail.

### WP-X2. Explain page and Mermaid (frontend-implementer, W5, ports 7547/7548/7549)

- Files: src/web/explain/{ExplainPage.tsx, mermaid.ts, links.ts} (new); src/web/pr/Markdown.tsx (links and diagrams props); src/web/pr/PrDetail.tsx and src/web/shell routes (the /explain suffix, Back, key w); src/web/keys.ts (w); package.json and bun.lock (mermaid, exact pin); THIRD_PARTY_NOTICES.md (`bun run notices`); tests/web/mermaid.test.ts (strip and cap rules); tests/e2e/explain.e2e.ts (new).
- Behavior: spec.md sections 3.1, 3.5. AC-X1, AC-X3 (UI part), AC-X5, AC-X6.
- Tests: e2e with a fixture result that holds one valid and one broken diagram: an img with a data: URL, no inline svg in the DOM, the fallback block, the chunk request only on this page, the console CSP messages recorded.
- Gates: screenshots (Explain page, light and dark), README section "Explain this PR", `bun run notices`, tests/build/compiled.test.ts still green.
- Risk: mermaid text measuring under the CSP. Record the console. The fallback keeps the page readable.

### WP-D2. Discuss server (implementer-xhigh, W5)

- Files: src/server/review/catalog.ts (discussAgent); src/server/review/prompt.ts (buildDiscussPrompt); src/server/review/context-files.ts (findingFile, discussionFile); src/server/review/jobs.ts (kind discuss, item, key, apply at the end); src/server/review/items.ts (use-revision and keep-mine for findings, withdrawn Restore); src/server/review/drafts.ts (origin discuss writer rank); src/server/review/routes.ts (POST and GET /api/items/:id/discuss); src/server/publish/outbox.ts and the history and count queries (skip finding revisions); tests/review/discuss.test.ts (new), items.test.ts.
- Behavior: spec.md sections 2.2 to 2.5. AC-D1 to AC-D8. The discuss parts of sections 2.7 to 2.9 (WP-PN hand-off): pr-context.md and notes.md, the focus thread of a posted finding, NOTES_RULES in discussAgent, and the apply of cites and note proposals with the WP-PN validation.
- Control mutations: let the post plan take a finding with revises (AC-D8 fails); apply a revision when the finding changed during the run (AC-D5 fails).

### WP-D3. Discuss UI (frontend-implementer, W6, ports 7557/7558/7559)

- Files: src/web/review/{Discuss.tsx (new), Drafts.tsx (link), useReview.tsx}; src/web/pr/Thread.tsx (More item on a posted finding thread); src/web/keys.ts (t); the reply revision diff component (reuse for findings); tests/e2e/discuss.e2e.ts (new).
- Behavior: spec.md section 2.1. AC-D9, AC-UX1, AC-UX3, AC-UX7, AC-UX10 for the chat. The suggestion row and the cites line of section 2.7 on a discuss answer (reuse the WP-PN components).
- Gates: screenshots (chat with a changed point), README section "Ask Claude about a finding".

### Gate G-EVAL-1 and the tuning step (user, then implementer)

- The user runs `bun run eval -- --real --cases all --repeat 2` on the WP-R3 head and `bun run eval:compare <baseline> <v2>`.
- Recommended pass rule: recall at least the baseline minus 5 points, and noise at least 30% lower, at a time cost of at most 1.6 times the baseline. Else an implementer tunes VERIFY_SPLIT, the verify effort, or the prompt lines, and the user runs the eval again before W4.
- The aggregated numbers go to docs/eval/results.md (no case output, no company data).

## 3. Work packages: part 6

### WP-D6. Docs for part 6 (implementer, W7)

- Files: BRIEF.md (spec.md section 10 rows for part 6, with the decisions Q1 to Q5 of design.md section 10), CLAUDE.md (hard rules: the write-run and push exceptions, the layout src/server/tasks/ and src/web/tasks/), integration-check.md (rows B17 to B20 and G1 to G7 with their results).
- Tests: none.

### WP-B0. Task contracts and the run table change (implementer-xhigh, W7)

- Files: src/server/storage/migrations/031_task.sql; src/server/storage/db.ts; src/shared/task.ts (new: schemas of spec.md section 6.5, states, constants); src/shared/dto.ts (TaskDto, TaskRowDto, route inputs of spec.md section 6.11, RunKind adds interview, spec, implement); every file with a review_run query (src/server/inbox/stale.ts, src/server/publish/{outbox.ts, routes.ts}, src/server/review/{consult.ts, context-files.ts, drafts.ts, fix-routes.ts, history.ts, items.ts, jobs.ts, run-rows.ts}); tests/storage/db.test.ts; tests/review/task-rows.test.ts (new).
- Behavior: spec.md sections 6.3 and 8 (031). A review_run row with task set and pr NULL never shows in a PR view, a run list, Ready to post, the stats, or the restart recovery of PR runs. The restart recovery marks running task runs failed with kind restart.
- Tests: db.test.ts for 031; one test per listed file with a task run row present (44 queries; the report lists each query and its test).
- Control mutation: drop the `pr IS NOT NULL` filter of the run list. Its test must fail.

### WP-B1. Bitbucket write calls and push (implementer-xhigh, W8, ports 7567/7568/7569)

- Files: src/server/bitbucket/{provider.ts (createPullRequest, updatePullRequest, repoRemote; buildStats comes from WP-PN), schemas, errors}; src/server/tasks/push.ts (new: refspec guard, lease rules, GIT_CONFIG env token); src/server/review/git.ts (push env helper, if needed); tests/support/fake-bitbucket.ts (the four endpoints, a git smart-HTTP push target or a local bare repo stand-in); tests/bitbucket/write.test.ts (new); tests/tasks/push.test.ts (new).
- Behavior: spec.md sections 6.8 (push), 6.9. AC-B16, AC-B17, AC-B22 (push part), AC-B23.
- Tests: request bodies match spec.md 6.9; error mapping; a first push with an empty lease to a bare remote; a second push with the pushed lease; a lease failure; a refspec to the target branch refused before git runs (spy); the token absent from argv and logs.
- Control mutation: remove the target-branch guard. AC-B16 must fail.

### WP-B2. Task core: create, interview, plan, sizing (implementer-xhigh, W8)

- Files: src/server/tasks/{tasks.ts (create, state machine, versions), interview.ts, plan.ts (spec run, render and parse of tasks.md and plan.md, sizing rules), routes.ts} (new); src/server/review/catalog.ts (interviewAgent, specAgent, replanAgent); src/server/review/prompt.ts (task prompts); src/server/review/jobs.ts (kinds interview and spec, task workspace from a branch head); src/server/review/workspace.ts (snapshot of a branch head without a PR); src/server/context/jira.ts and task-file.ts (fetch of a typed key; task.md for a task); tests/tasks/{tasks.test.ts, plan.test.ts, interview.test.ts} (new).
- Behavior: spec.md sections 6.1, 6.2 (to spec_draft), 6.4, 6.5, 6.6 (interview, spec, replan), 6.11 (tasks, answers, docs, plan, size). AC-B1 to AC-B4.
- Tests: the tasks.md grammar round trip; parse errors with line numbers; the two size rules; a second interview round at most once; the plan approval stores the picked commands in repo_task_settings and needs the warning once per repository; version conflicts give 409.
- Control mutation: skip the db rule in sizing. AC-B4 must fail.

### WP-B3. Worktree, implement runs, and checks (implementer-xhigh, W9)

- Files: src/server/tasks/{worktree.ts (create, sparse patterns, config, reset, patch save), checks.ts (argv runner, env, timeouts, tree kill, output tails), implement.ts (step context files, run spec, path check)} (new); src/server/review/claude.ts (implement tool set and allowed tools, init check for Edit and Write); src/server/review/jobs.ts (kind implement); tests/tasks/{worktree.test.ts, checks.test.ts, implement.test.ts} (new).
- Behavior: spec.md sections 6.7 (steps), 6.8 (worktree, path check). AC-B8, AC-B9, AC-B19 (checks part), AC-B22 (env part).
- Tests: sparse checkout hides each pattern and a commit keeps those files unchanged; a fake-CLI step that writes repo/src/a.ts passes; one that writes .claude/settings.json, CLAUDE.md, or a path outside repo/ fails, resets, and saves the patch; a check command that sleeps past its timeout is killed with its tree (Windows and Linux paths); the env of a check has no token, no ANTHROPIC_*, and HOME in a temp folder when isolate_home is on; argv never runs through a shell.
- Control mutation: skip the deniedPath check after a step. AC-B9 must fail.
- Depends: Gate B17 passed.

### WP-B4. The loop for one part (implementer-xhigh, W9 after WP-B3)

- Files: src/server/tasks/loop.ts (new: tests step, implement and fix steps, checks, commits with ticks, size check, own review, budgets, blocked reasons, pause, resume, stop, slot waits); src/server/review/jobs.ts (own review of a commit range for a task, slot wait API); tests/tasks/loop.test.ts (new).
- Behavior: spec.md section 6.7 and the small-task path of 6.2. AC-B10 to AC-B13, AC-B18, AC-B19, AC-B20.
- Tests (fake CLI scripts and fake check commands): red then green; red three times then blocked; green tests step blocked; a confirmed major fixed in one try; a blocker left after two tries; an over-budget part blocked; a review start during a step gets 409 and the loop continues after it; Stop during a check; Resume from the last commit with the patch saved; a spec file change blocks with spec_change.
- Control mutation: allow a fourth fix try. The red-three-times test must fail.

### WP-B5. Task UI for small tasks (frontend-implementer, W9 after WP-B4, ports 7577/7578/7579)

- Files: src/web/tasks/{TaskView.tsx, StepStrip.tsx, Questions.tsx, SpecDocs.tsx, PlanTab.tsx, LogTab.tsx, DiffTab.tsx, OpenPrDialog.tsx, model.ts (status sentence and primary button per state), data.ts} (new); src/web/review/TaskChips.tsx (menu item "Build this task"); src/web/shell (Tasks view, route /tasks/:id); tests/web/tasks-model.test.ts (one test per state row of spec.md section 6.12); tests/web/ui-words.test.ts (AC-UX2 scan); tests/e2e/task-small.e2e.ts (new).
- Behavior: spec.md sections 6.12 (small rows), 7. AC-B2, AC-B5, AC-UX1 to AC-UX7, AC-UX10.
- Tests: e2e of the small walkthrough of spec.md section 7.2 against the fake CLI, the fake Bitbucket, and a temp remote: one click start, the form with the recommended answers, the plan approval with the warning, the build, "Open the PR" with its confirm, exactly one push and one PR create at the fake server.
- Gates: screenshots (Task view in three states), README section "Build a Jira task", web-design-guidelines, axe.

### Gate US: small task smoke (user)

- docs/smoke-task.md part S on the designated test repository: a one-file Jira task, the questions, the plan, the build, the PR on click. Record the time, the usage, the number of fix tries, and any denied-path stop.

### WP-B6. Spec PR flow (implementer-xhigh, W10)

- Files: src/server/tasks/{specpr.ts (branch, commit of the plan files, push, create PR, link task_part to the PR row, follow), gates.ts (spec gate from the synced reviewers_json, tasks, and builds)} (new); src/server/sync/* (read build stats for task PR heads during the normal PR sync); src/server/review/fix-routes.ts and clone.ts (Apply mode "task": commit into the part worktree; push stays a click); tests/tasks/specpr.test.ts (new); tests/review/fix-task.test.ts (new).
- Behavior: spec.md sections 6.2 (spec states), 6.10 (spec gate), 6.11 (spec-pr, build, push). AC-B6, AC-B7.
- Control mutation: count a NEEDS_WORK reviewer as approval. The spec gate test must fail.

### WP-B7. Medium task UI (frontend-implementer, W10, ports 7587/7588/7589)

- Files: src/web/tasks/{SpecPrTab.tsx (new), TaskView.tsx, model.ts}; src/web/fix/ApplyDialog.tsx (task mode and "Push to <branch>"); tests/e2e/task-medium.e2e.ts (new).
- Behavior: spec.md section 6.12 (spec rows), the medium walkthrough of section 7.2.
- Gates: screenshots, README update.

### Gate UM: medium task smoke (user)

- docs/smoke-task.md part M: a task with one migration. The spec PR with one colleague comment, Draft replies and Fix on the spec, the approval, the code PR.

### WP-B8. Stack manager (implementer-xhigh, W11)

- Files: src/server/tasks/{stack.ts (part branches on the branch below, max open, retarget, rebase with conflict stop, lease pushes, replan after merges), gates.ts (part gate with build stats)} (new or extended); tests/tasks/stack.test.ts (new).
- Behavior: design.md section 5.5 (stack rules); spec.md sections 6.8 (rebase), 6.10 (part gate), and 6.11 (retarget, push with force). AC-B14, AC-B15.
- Tests (temp remote and fake Bitbucket): part 2 branches from part 1; part 3 waits at 2 open PRs; merge commit then retarget with one PUT; squash then rebase and a force push with a lease after confirm; a rebase conflict blocks with "Let Claude fix it"; a declined part PR offers "Open the PR again"; a replan with changed parts needs approval.
- Control mutation: retarget without the confirm flag. Its test must fail.
- Depends: Gates G4, G5, G6 recorded.
- Gate G5 (2026-10-22, integration-check.md "Review v2"): a deleted target branch declines the stacked PR, and its toRef stays on the deleted branch. Retarget the upper PR before the lower branch goes away. Never delete a lower branch that an upper PR targets. Detect a declined upper PR and offer to open it again (spec.md section 6.8).

### WP-B9. Large task UI (frontend-implementer, W11 after WP-B8, ports 7597/7598/7599)

- Files: src/web/tasks/{PlanTab.tsx (parts list with plain states and lines), TaskView.tsx, model.ts (large rows), ForceDialog.tsx (new)}; tests/e2e/task-large.e2e.ts (new).
- Behavior: spec.md section 6.12 (large rows), the large walkthrough of section 7.2.
- Gates: screenshots, README update.

### WP-B10. Task notifications and inbox rows (frontend-implementer, W11, ports 7607/7608/7609)

- Files: src/server/tasks/events.ts (new: task_event writes and claims); src/server/live.ts (task events on the shared stream); src/web/notify.ts; src/web/shell (Tasks view rows); src/web/inbox PrRow (task meta line); tests/tasks/events.test.ts (new); tests/e2e/task-notify.e2e.ts (new).
- Behavior: spec.md sections 6.12 (inbox), 6.13. AC-B21, AC-UX8, AC-UX9.
- Gates: screenshots of the Tasks view and a task PR row.

### Gate UL: large task smoke (user)

- docs/smoke-task.md part L: a 3-part task with an API change. Merge part 1 with a merge commit and part 2 with a squash in Bitbucket. Check the retarget, the rebase confirm, and the lease push. Record the time per part and the reviewer comments per PR.

### WP-CLOSE (implementer, W12)

- Files: docs/smoke-v2.md (with part E, PR context and notes) and docs/smoke-task.md (final), scripts/demo.ts (a review v2 run with folds, a discuss turn, an Explain page with a diagram, a small task in each state, a PR with one kept note and one suggestion on a reply draft), docs/smoke-autopilot.md and the Autopilot demo PR only when part 7 resumes, docs/screenshots (`bun run screenshots`), README.md, CHANGELOG.md, CLAUDE.md status.
- Run the full e2e suite twice. Report one control mutation per safety check of the plan, each with its "imported from" proof.

## 4. User-run gates and smoke steps

| Gate | Command or doc | When | PASS |
|---|---|---|---|
| G-EVAL-0 | `bun run eval -- --real --cases all --repeat 2` | after WP-M1, before WP-R2 | A result file with all 12 cases. |
| G-EVAL-1 | the same, then `bun run eval:compare` | after WP-R3 | The pass rule of section 2. |
| B17 to B20 | `bun scripts/gate/claude-checks.ts --only B17,B18,B19,B20` | before WP-R3 (B18, B20) and WP-B3 (B17) | spec of WP-G0. |
| G1 to G7 | `bun scripts/gate/bitbucket-write.ts --only G1,…` on the test repository | before WP-B1 (G1 to G3), before WP-B8 (G4 to G6) | spec of WP-G0. |
| Smoke v2 | docs/smoke-v2.md: A review with folds on a real PR; B discuss with all three verdicts; C Explain with a diagram and a link; D stats after a week of use | after W6 | Every step as written. Record the time and usage per phase. |
| Smoke task | docs/smoke-task.md parts S, M, L | after W9, W10, W11 | Every step as written. Nothing pushes without a click. |
| G9, G12 (UG) | `bun scripts/gate/bitbucket-write.ts --only G9,G12` on the test repository | after WP-PG, before WP-PN uses the Bitbucket peer reads | spec of WP-PG. |
| Reply eval (PR context) | `bun run eval -- --replies --real --repeat 2` | after WP-PN | The recommended pass of WP-PN. |
| G8, G10, G11 (on hold) | `bun scripts/gate/bitbucket-write.ts --only G8,G10,G11` on the test repository | before WP-A2 (G10) and WP-A5 (G8) | spec of WP-GA. |
| UA1 (on hold) | docs/smoke-autopilot.md part 1 | after WA3 | A draft for each scripted comment, one notification per burst, "Post this reply" posts once, nothing posts by itself. |
| G-EVAL-A (on hold) | `bun run eval -- --replies --real --repeat 3` | after WP-A5, before WP-A6 | 0 wrong auto-posts over 3 repeats (spec.md section 11.15). |
| UA3 (on hold) | docs/smoke-autopilot.md part 2 | after WA5 | Every step as written. Each auto post carries the mark. A decision stays a draft. Delete works without a reply and is refused with one. |

Unverified facts that the gates record in integration-check.md: Opus 5.5 recall under "report everything" (S2 was stated for Opus 5); Edit and Write confinement under `--restricted` (B17); usage and cost fields on a subscription (B19); the Data Center 9.x shape of create PR, update PR, build stats, and repository links (G1 to G4); the effect of a deleted target branch on a stacked PR (G5); the Mermaid version and its CSP behavior in the browser (WP-X2); the delete refusal for a comment with replies (G8); the open-PR list shape (G9); the change list of an open PR where the user is no participant (G12); the user type on comment authors (G10); a re-request review call (G11); the real CLI behavior on autopilotResult and guardResult (U-rows of WP-DA).

## 5. Work packages: part 7

On hold (2026-10-22): the user paused autopilot; a human posts every reply. Keep for later. No package of this section starts until the user resumes part 7. Then each package reads the part 2 PR context and notes (WP-PN) first: pr_note, the notes routes, and the Notes block already exist, and Gate G9 runs in WP-PG.

Rules of section 0 apply. Each package names the spec.md section 11 parts that it builds.

### WP-DA. Docs for part 7 (implementer, WA0)

- Files: BRIEF.md (spec.md section 10, row "part 7": principle 1, principle 4, 3.6, 7 Plan, the hard rule text, the safeguards list), CLAUDE.md (Hard rules: "Nothing goes to Bitbucket without an explicit user action, unless the user turned on Autopilot for that PR."; status line; layout src/server/autopilot/ and src/web/autopilot/), integration-check.md (rows G8 to G11 and U-rows for autopilotResult and guardResult, "not run").
- Tests: none.

### WP-GA. Gate checks G8, G10, and G11 (implementer, WA0)

- Files: scripts/gate/bitbucket-write.ts (adds G8, G10, G11), docs/gate-v2.md (rows). G9 moved to WP-PG (part 2). The G9 line below stays for reference.
- G8: on the designated test PR, post a comment and delete it with the current version (PASS: 204). Post a comment, reply to it from the same token, and delete the parent (record the status and the error text). Clean up the reply first, then the parent.
- G9: GET the open PRs of the test repository with limit 50 (record the shape: id, title, author, fromRef, toRef, updatedDate, isLastPage).
- G10 INFO: record the author type field of comments, and of a service account when the user has one.
- G11 INFO: record whether any documented call re-requests a review, and whether a push resets the approvals of the test repository.
- Each check has `--dry-run`. Output sanitizing as B1 to B16. Separate authorization as G1 to G7.
- Tests: argument parsing and dry-run output only.

### WP-A1. Contracts for Autopilot (implementer-xhigh, WA1)

- Files: src/shared/autopilot.ts (new: constants, classes, schemas, autopilotSettings); src/shared/review.ts (reply payload origin autopilot and the autopilot field, with defaults); src/shared/dto.ts (AutopilotDto, TurnDto, NoteDto, DependencyDto, route inputs of spec.md section 11.12, RunKind adds autopilot, ClaimedEvent kinds, PrRow autopilot fields, settings input); src/server/storage/migrations/033_autopilot.sql (or the next free number); src/server/storage/db.ts; src/server/settings.ts (autopilot in localFields, with the prefix rule); src/web/review/model.ts (RUN_TEXT and KIND_LABEL for autopilot); tests/support/fake-claude.ts (autopilot and guard echo by schema); tests/support/fake-bitbucket.ts (DELETE comment with the reply refusal, open-PR list, user type).
- Behavior: spec.md sections 11.6, 11.11, the settings part of 11.12.
- Tests: db.test.ts for 033 (spec.md section 8 rules: child rows kept, foreign_key_check empty, CHECKs refuse a bogus kind, a second open changes nothing); autopilot.test.ts (draft-07 schemas, defaults, old configs parse, the prefix rule refuses "", " ", and "--"); settings test (markAi off keeps the Autopilot prefix).
- Control mutation: accept an empty prefix. AC-A15 must fail.

### WP-A2. Level 1 server: trigger, queue, run, drafts (implementer-xhigh, WA2)

- Files: src/server/sync/engine.ts (trigger rules, queue upsert, no comment_new for trigger comments); src/server/autopilot/{queue.ts, context.ts, judge.ts, routes.ts} (new); src/server/review/{jobs.ts (kind autopilot, slot, restart), catalog.ts (autopilotAgent), prompt.ts (buildAutopilotPrompt), context-files.ts}; src/server/review/drafts.ts (origin autopilot rank 4); src/server/bitbucket/provider.ts (listOpenPullRequests, author type); src/server/publish/routes.ts (post-now); src/server/inbox/queries.ts (PrRow fields); tests/autopilot/{trigger.test.ts, queue.test.ts, run.test.ts, judge.test.ts} (new).
- Behavior: spec.md sections 11.2 (draft mode), 11.3, 11.4 (without the guard phase), 11.5 (level 1 column, validation, secrets), 11.7 (autopilot agent), 11.8 (all but post guards), 11.12 (autopilot GET and PUT with off and draft, pause, activity, notes, post-now), 11.13 (autopilot_draft and the comment_new fallback), 11.14. AC-A1 to AC-A5, AC-A12 (run caps), AC-A13, AC-A16, AC-A18, AC-A19.
- Tests (fake CLI, fake Bitbucket, temp repos, a fake clock): the quiet window coalesces three comments; quiet hours hold and release; each excluded trigger kind never queues; the canary never reaches stdin; argv has no Agent tool and the autopilot schema; draft items per class; a touched user draft gets a revision; one event per run; a schema failure adds comment_new per trigger comment; a restart re-queues; the usage limit pauses.
- Control mutations: let a comment that starts with "🤖" queue (AC-A3 fails); put the note text into stdin (the canary test fails).

### WP-A3. Level 1 UI (frontend-implementer, WA3, ports 7617/7618/7619)

- Files: src/web/autopilot/{Switch.tsx, TurnOnDialog.tsx, Panel.tsx, Activity.tsx, Notes.tsx, model.ts (status sentence table), data.ts} (new); src/web/pr/PrDetail.tsx (header switch and sentence); src/web/review/ReplyDraft.tsx (writer label Autopilot, class line, "Post this reply"); src/web/settings/Autopilot.tsx (new); src/web/inbox PrRow (icon, "1 reply draft waits"); src/web/notify.ts (texts); docs/smoke-autopilot.md part 1 (new); tests/web/autopilot-model.test.ts (one test per status row); tests/e2e/autopilot.e2e.ts (new).
- Behavior: spec.md sections 11.1 (draft rows), 11.13 (UI). AC-A20 (draft part), AC-UX1 to AC-UX3, AC-UX7, AC-UX10.
- Gates: screenshots (switch with sentence, dialog, draft card, panel, Settings section), README section "Autopilot", web-design-guidelines, axe.

### WP-A4. Reply eval (implementer, WA2)

- Files: fixtures/eval/replies/<12 cases>/ (new); fixtures/eval/README.md (reply cases); scripts/eval/{run.ts, score.ts} (`--replies`); tests/eval/replies.test.ts (new).
- Behavior: spec.md section 11.15. Until WP-A5 lands, the harness scores the class and the level 1 action only. WP-A5 adds the guard path to the harness.
- Tests: the scorer with a fixed result file (a wrong auto-post counts once per case and repeat); `--replies` without `--real` exits 2; one case with the fake CLI gives the result file shape.
- Control mutation: count a drafted answer as a wrong auto-post. The scorer test must fail.

### WP-A5. Level 2 server: guard, posts, cancel, delete (implementer-xhigh, WA4)

- Files: src/server/autopilot/judge.ts (class table post column, evidence check, guard agreement, post caps, age rule); src/server/review/{jobs.ts (guard phase, phase "checking"), catalog.ts (guardAgent), context-files.ts (proposed.md)}; src/server/publish/outbox.ts (auto rows, not_before, auto checks with the fresh read, the Autopilot mark, cancel); src/server/bitbucket/provider.ts (deleteComment); src/server/autopilot/routes.ts (mode post with understood, cancel, delete); scripts/eval (guard path); tests/autopilot/{post.test.ts, guard.test.ts, delete.test.ts, no-write.test.ts} (new); tests/publish/outbox.test.ts.
- Behavior: spec.md sections 11.2 (post mode), 11.4 (guard phase), 11.5 (level 2 column, evidence), 11.7 (guard agent), 11.8, 11.9, 11.13 (autopilot_posted). AC-A6 to AC-A11, AC-A12 (post caps), AC-A14, AC-A15.
- Tests: a post after the delay with the mark; each auto check failure (new message, resolve, merge, touched draft, pause, mode off) sends no POST; guard disagreement, a bad quote, commits true, a secret, and an old comment each give a draft or a drop; cancel before and after the send; delete without a reply sends one DELETE with the version; delete with a reply gets 409 and no DELETE; a spy provider over every part 7 test sees no approve, needs work, merge, decline, resolve, or reopen call.
- Control mutations: skip the guard agreement (a guard-disagree test fails); skip the newest-message check in the drain (AC-A11 fails); skip the reply check before DELETE (AC-A10 fails).
- Depends: Gate G8 recorded.

### WP-A7. Dependency watch server (implementer, WA4 after WP-A5)

- Files: src/server/autopilot/deps.ts (new); src/server/autopilot/judge.ts (blockedBy rows); src/server/sync/engine.ts (one GET per active dependency per cycle, dependency_merged); src/server/bitbucket/provider.ts (GET one PR by project, repo, and ID, if absent); src/server/autopilot/routes.ts (dependencies); tests/autopilot/deps.test.ts (new).
- Behavior: spec.md section 11.10 (levels 1 and 2). AC-A17.
- Control mutation: accept a blockedBy number outside open-prs.md. AC-A17 must fail.

### WP-A6. Level 2 UI (frontend-implementer, WA5, ports 7627/7628/7629)

- Files: src/web/autopilot/{TurnOnDialog.tsx (mode radios), Activity.tsx (posting countdown, Cancel, Delete with its confirm), Panel.tsx (dependency line and proposal), model.ts (post rows)}; docs/smoke-autopilot.md part 2; tests/e2e/autopilot-post.e2e.ts (new).
- Behavior: spec.md section 11.1 (post rows, dependency line). AC-A20 (post part).
- Gates: screenshots (post mode sentence, activity with Cancel, dependency proposal), README update, web-design-guidelines.
- Depends: Gate G-EVAL-A passed.

### WP-A8. Level 3 for task PRs (implementer-xhigh, WA6)

- Files: src/server/tasks/{loop.ts (update step), stack.ts (merge of the target into a part branch)}; src/server/autopilot/{judge.ts (change_request to the task loop), deps.ts (update step start)}; tests/tasks/update.test.ts (new).
- Behavior: spec.md sections 11.2 (level 3), 11.10 (level 3). The push uses the part 6 lease rules. The reviewer comment follows the Gate G11 result (Q37).
- Tests: a merged dependency on a task PR in post mode runs merge, checks, and one lease push; a conflict that the fix step cannot solve blocks with "Needs you"; draft mode never starts the update step.
- Control mutation: start the update step in draft mode. Its test must fail.
- Depends: WP-B8, WP-A7, Gate G11 recorded.
