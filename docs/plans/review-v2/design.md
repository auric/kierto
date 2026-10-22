# Review v2 plan: design

Status: draft for the user's decision, 2026-10-22. Docs only, no code changed. Code references point to HEAD abae1a2 on branch r2. "Unverified" marks a claim that no code, document, or gate run confirmed. Companion files: spec.md (behavior, data, routes, schemas, prompts, acceptance criteria) and tasks.md (work packages and gates).

Parts: 1 Review quality, 2 Discuss a finding, 3 Explain this PR, 4 Measure quality, 5 Brainstorm, 6 Build a Jira task. A UX rule set (section 5.6) applies to every part.

## 0. Sources and rules

- Inputs: the subsystem map, the prompt dump of 13 run kinds, and three research notes of 2026-10-22 (session scratchpad). Each code claim below was checked against the files at abae1a2.
- External sources: section 3 lists each one with its link. The Claude Code permission, sandbox, CLI, and headless pages were read on 2026-10-22. The Bitbucket REST rows come from the Bitbucket Server 7.21 reference. The Data Center 9.x behavior of each new Bitbucket call is a Gate-0 item (tasks.md, WP-G0).
- BRIEF hard rules stay unless section 10 asks the user to change one: sanitized snapshot for read-only runs, no `--bare`, auth route check, nothing posts without a click, untrusted data rules, token rules, one run slot, writer priority, field-by-field profile upgrades, draft-07 schemas, and "an incomplete run never says no issues".
- The visible app name in the code is "PR Review Inbox" (src/web/App.tsx:369). CLAUDE.md says "Kierto". The UI texts in this plan avoid the name.

## 1. Problem

### 1.1 Review quality today (verified at abae1a2)

| ID | Weak spot | Evidence |
|---|---|---|
| W1 | No verify pass. evidenceStatus and confidence are self-reported. They never gate, sort, or fold a finding. | review.ts:14-27; Drafts.tsx:253 shows them as one text line. |
| W2 | The model merges subagent findings. Auto mode has no check. Only always mode asks the main agent to drop unconfirmed findings. | catalog.ts:275-285 (DELEGATE). |
| W3 | The finder is told to be conservative ("Give no finding to fill the list", "Set confidence to low…"). Opus 5 guidance says such lines lower recall. | catalog.ts:254-265; research-opus55 item 3. |
| W4 | rl-reviewer has no ./context rules: no pr.md, task.md, history.md, or questions.md. It can raise a finding that the user discarded. | catalog.ts:476-493. |
| W5 | "Only what the PR adds" is a prompt line. The validator accepts anchors outside the hunks ("outside"). | catalog.ts:261; validate.ts:190-191. |
| W6 | Severity lives only in the prompt. category is free text. No cap applies. | review.ts:20-21. |
| W7 | Shipped profiles leave model and effort null, so the CLI default applies. Opus 5.5 defaults to medium effort. | catalog.ts:59-138; research-opus55 item 2. |
| W8 | Delegation is the model's choice in auto mode. Opus 5 delegates readily. | catalog.ts:277; research-opus55 item 9. |
| W9 | Explain is a review run with explain true. It returns one summary line and risk strings. The validator drops its findings. | catalog.ts:121-136; validate.ts:202; RunLine.tsx:441-500. |
| W10 | Nothing learns from discards. No stats exist per profile or prompt version. | BRIEF section 9 backlog "Learn from discards". |

### 1.2 Other gaps

- Discuss: the user cannot ask Claude about one finding before posting. Ask is one question per run about the whole PR (AskPanel.tsx, catalog.ts:402). After a post, only reply drafts reach the thread.
- Explain: no narrative, no reading order, no links to the diff, no diagrams. Markdown.tsx exists and is safe, but Explain does not use it.
- Measure: no way to prove that a prompt change finds more real bugs with less noise.
- Build a task: the app reviews and fixes PRs, but it cannot take a Jira task to a reviewed spec and small, reviewed PRs.

## 2. Goals and non-goals

Goals:
- G-R. More real findings and less noise: the finder reports all, a verify phase filters, the app applies caps from structured fields, and the UI shows confirmed points first.
- G-D. A short talk with Claude about one finding. Claude answers with a verdict: upheld, revised, or withdrawn. A revision never overwrites the user's text.
- G-X. "Explain this PR" gives a readable walkthrough with a reading order, links into the diff, risks on code, and safe diagrams.
- G-M. Numbers: precision, recall, noise, and cost per profile and prompt version, from synthetic fixtures and from real outcomes in the app.
- G-B. From a Jira task to reviewed PRs: questions, a spec that colleagues review, tests first, own review, small PRs on click.
- G-UX. One primary action per state, plain words, no setup before first use.

Non-goals:
- No automatic review, approval, merge, or thread resolve. Every run still starts from a click, or from the approved plan of a task (section 10, Q5).
- No hosted service, no team features, no other code host.
- No post without a click. The app never pushes to a target branch and never force-pushes without a confirm.
- No result cache that skips a run. A start runs the CLI again, except a start with the key of the running run.

## 3. Research summary

| # | Finding | Source | Consequence here |
|---|---|---|---|
| S1 | Effort is the only thinking control on Opus 5.5. Its default is medium, where Opus 5 had high. | https://platform.claude.com/docs/en/models/opus-5-5/migration-guide | Each agent gets an explicit effort (R11). |
| S2 | "Only report high-severity issues" or "be conservative" makes the model report less. Ask it to report everything and filter in a separate pass. Stated for Opus 5; unverified for 5.5. | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5 | Finder reports all with severity and confidence. Strictness moves to the verify phase (R1). |
| S3 | Drop CRITICAL and MUST emphasis. Say what to do, not what to avoid. Give the reason. | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices | Plain prompt lines in ASD-STE100, each with its reason in spec.md. |
| S4 | Ground claims in exact quotes. | same page | anchorText and cause quote code. The app checks both (R6). |
| S5 | Opus 5 delegates to subagents more readily. Control spawning. | prompting-claude-opus-5 page | The app decides delegation by diff size. A small change gets no Agent tool (R8). |
| S6 | `--json-schema` gives `structured_output`. A missing field fails the run. `format` is an annotation only. | https://code.claude.com/docs/en/headless | Draft-07 schemas with zod defaults for stored results. |
| S7 | Subagent fields include model, effort, tools, disallowedTools, maxTurns, omitClaudeMd. | https://code.claude.com/docs/en/sub-agents | rl-reviewer and rl-verifier pin effort and read-only tools. |
| S8 | Anthropic /code-review: parallel finders, then one validator subagent per issue; PR title and description go to every agent; CLAUDE.md rules only from files on the changed path, with the exact rule quoted. | https://raw.githubusercontent.com/anthropics/claude-code/main/plugins/code-review/commands/code-review.md | Verify phase (R1), intent to every agent (R12), path-scoped rules with quote check (R13). |
| S9 | qodo: "only issues introduced by this PR", a concrete scenario for lower severity, a reflect pass that rescores with caps ("verify/ensure" capped). | qodo-ai/pr-agent pr_reviewer_prompts.toml, pr_code_suggestions_reflect_prompts.toml | Trigger field, caps (R5), "please verify" becomes a question. |
| S10 | CodeRabbit: profiles quiet, chill, assertive. Quiet moves minor items to the summary. | https://docs.coderabbit.ai/reference/configuration | Three volume steps that change the display, not the finder (R10). |
| S11 | Greptile: about 19% good, 2% incorrect, 79% nits. Prompting alone could not cut nits without cutting real comments. Feedback learning raised the address rate from 19% to 55%+. | https://www.greptile.com/blog/make-llms-shut-up | Do-not-flag list, verify phase, outcome tracking, later "Learn from discards". |
| S12 | Google: target precision about 50%. ByteDance BitsAI-CR: 75% precision with a rule checker and a review filter; "Outdated Rate" as a metric. | https://research.google/blog/resolving-code-review-comments-with-ml ; arXiv 2501.15134 | Metrics in part 4: precision, addressed rate, outdated rate. |
| S13 | Split agents by evidence source (rules or code), not by topic. One strong default with toggles beats many profiles. | research-review-tools summary (inference from the tools above) | One finder prompt with module sections (R7) and one default profile (R9). |
| S14 | Mermaid: render to an SVG string, show it as a data-URL image. securityLevel strict, htmlLabels false, strip `%%{init}`, pin a version after the 11.15/11.16 advisories. | research-mermaid (mermaid docs and advisories; not browser-verified) | Part 3 diagrams with no CSP change (X4). |
| S15 | Claude Code sandbox: "The sandbox runs on macOS, Linux, and WSL2. On native Windows, Claude Code runs commands unsandboxed." Bash rules "aren't a security boundary around the program". In `-p`, a call that needs approval is denied unless an allow rule or a mode approves it. | https://code.claude.com/docs/en/sandboxing ; https://code.claude.com/docs/en/permissions ; https://code.claude.com/docs/en/headless | Part 6 gives Claude no shell. The app runs allowlisted commands. Section 10 Q2 states the Windows limit. |
| S16 | Bitbucket Server: POST /rest/api/1.0/projects/{projectKey}/repos/{repositorySlug}/pull-requests creates a PR (REPO_READ on both repositories). PUT .../pull-requests/{id} changes title, description, reviewers, or the destination branch. GET /rest/build-status/1.0/commits/stats/{commitId} gives successful, inProgress, and failed counts. | https://docs.atlassian.com/bitbucket-server/rest/7.21.0/bitbucket-rest.html ; https://docs.atlassian.com/bitbucket-server/rest/7.21.0/bitbucket-build-rest.html | Part 6 calls. Data Center 9.x behavior is Gate G2 to G5. |
| S17 | git push `--force-with-lease=<ref>:<expect>`: with an empty expect, the ref must not exist yet. | https://git-scm.com/docs/git-push | New branches push with an empty lease. Updates push with the last pushed hash as the lease. |

## 4. Decisions

### 4.1 Part 1: Review quality

| ID | Decision | Alternatives | Why |
|---|---|---|---|
| R1 | Two phases in one review run: the finder reports every candidate with severity and confidence. A verify phase gives each candidate a verdict: confirmed, refuted, unsure, question, or duplicate. | Keep "be conservative" in one pass (today). Let the finder self-check. | S2, S8, S9, S11: finding and judging work better apart. The finder stops self-censoring. |
| R2 | The verify phase is a second CLI process in the same job, the same workspace, the same run row, and the same run slot. | Verifier subagents inside the finder run (model-driven, cannot be enforced, W2). A second run row (two slot grabs, two results). | The app enforces the phase. Cancel stops both. The user sees one run with two phases. |
| R3 | Verify works in batches in one process. Above 12 candidates (VERIFY_SPLIT), the app adds the rl-verifier agent, and the verify main agent gives each call up to 6 candidates. | One subagent per candidate (S8; each one reads the context again). One process for any count (slow for 40 candidates). | Cost against wall time. The eval harness tunes both constants. |
| R4 | Dedupe: the app groups candidates whose anchors overlap on the same path and side. The verifier marks duplicates in a group. | Text similarity in the app (a heuristic). The finder merges (W2). | Overlap is exact. The model judges sameness only inside a group. |
| R5 | Caps use structured fields only: verdict, evidenceStatus, confidence, trigger, and volume. The app never matches words in the text. | Phrase rules such as "please verify" in the app. | No heuristic. The finder writes a question when it has no trigger, and the verifier gives verdict question. |
| R6 | "Only what the PR adds": a finding anchors on a changed line, or it names a cause on a changed line. The app checks the quotes of both. Else it drops the finding with reason "unchanged". | Prompt line only (today, W5). | Deterministic. It removes findings on old code that the change does not touch. |
| R7 | Modules are checklist sections in the one finder prompt. Agents split by evidence source only: code slices by path (rl-reviewer) for size, and the verify phase. Rules and task match stay in the finder, with an app check of the rule quote. | One parallel specialist per topic (security agent, performance agent). | S13: topic agents repeat work and conflict. A second CLI process per topic costs time in the single slot. The eval can revisit. |
| R8 | The app decides delegation from the diff stat. Below 1,200 changed lines and 30 files, the finder gets no Agent tool. | The model decides (today, auto mode). | S5. A fixed agent set with a known shape per run. |
| R9 | One default review profile "Review" with module checkboxes and a three-step volume. The shipped Security and Over-engineering profiles retire when the user never edited them; "Security" and "Simplify" become modules. The Explain profile becomes the setup of "Explain this PR". | Keep four topic profiles. Keep General and Over-engineering as two shipped profiles. | S13 and the UX rules: one choice that most users never change. A pure cut pass stays possible as the user's own profile. Section 10 Q7. |
| R10 | Volume (Only what matters, Balanced, Show everything) changes the display and the nit rule only. The finder always reports the rest. | Volume changes the finder prompt. | S2: the finder must not self-filter. |
| R11 | Explicit effort per agent. Shipped: finder high, rl-reviewer high, verify phase medium, Explain medium. Discuss and Ask use the effort of the profile in the brief. | Leave null (W7). | S1. The profile keeps each field editable. |
| R12 | Author intent goes to every agent: each agent prompt says to read ./context/pr.md and ./context/task.md first. The stdin keeps no PR text. | Put the PR title and description into stdin. | BRIEF prompt rule: stdin never quotes PR or tracker text (prompt.ts:3). |
| R13 | Path-scoped project rules: CLAUDE.md files of the target head on the path of each changed file join the project instructions with a scope header. A rule finding quotes the rule. The app checks that the quote is in a loaded file whose scope covers the path. | Root CLAUDE.md only (today). | S8: only rules that apply to the path, and an exact quote. |
| R14 | Subagent parity: one context block (Tools lines for the existing context files, the intent rule, the history rule, the do-not-flag list, the rubric, modules, language lists, project instructions) goes to every agent of the run. | Per-agent lists (today, W4). | Same facts in every agent. No re-raise of discarded findings. |
| R15 | Explain leaves the review schema. It gets its own run kind and schema (part 3). | Keep explain true on review runs. | W9. |
| R16 | The UI uses the stored verdicts: confirmed points show; unsure points fold under "Low confidence"; refuted and duplicate points stay in the run record and the log, with Restore. | Show everything as today. | S10, S11. Nothing is lost, and the main list is short. |
| R17 | REVIEW_PROMPT_VERSION (a constant in src/shared/review.ts) goes into each run row. | Profile revision only. | Stats and the eval compare prompt versions. |

### 4.2 Part 2: Discuss a finding

| ID | Decision | Alternatives | Why |
|---|---|---|---|
| D1 | One CLI run per user message (kind discuss), in the one run slot. | A chat session with `--resume`. | BRIEF 3.5: app runs never resume and delete their transcripts. Resume loads the whole history, which costs quota. |
| D2 | Each turn rebuilds its context: the finding with its run head, anchor excerpt, verdicts, and the user's current text; the earlier turns; a fresh snapshot at the current heads. | Resume the review run's session. | Deterministic and safe. The same pattern as Ask and fix runs. |
| D3 | No message table. Each turn is a review_run row: question (the user message), answer, discuss_json (verdict and revision), and item (the finding). | A new item_message table. | Run rows already give status, log, cancel, usage, and errors. |
| D4 | Verdict upheld changes nothing. Revised stores a revision item of the finding (payload revises) for Use revision or Keep mine. Withdrawn discards the finding with a mark and Restore. On a posted finding, the answer can make a reply draft through the writer priority. Nothing posts. | Overwrite the finding text. | The thread-outcome revision rule (BRIEF, Revisions): no AI writer overwrites the user's text. |
| D5 | One link "Ask Claude about this" on the finding card opens an inline chat under the card. Key t. | A panel or a dialog. | UX rule 1 and 10: the talk stays next to the code. |

### 4.3 Part 3: Explain this PR

| ID | Decision | Alternatives | Why |
|---|---|---|---|
| X1 | Run kind explain with its own schema: a one-line summary, a Markdown walkthrough, a reading order, file roles, risks with anchors, a glossary, questions, and coverage. | Keep the review schema. | W9. A narrative needs long Markdown. Structured parts allow links and checks. |
| X2 | "Explain this PR" opens a readable page in the detail pane (URL suffix /explain), with Back. | The panel slot (cramped; it pushes the PR down). A new window. | UX rule: one readable page at reading width. |
| X3 | Links into the diff use `diff:<path>#N<line>` or `#O<line>` hrefs. The server checks each one against the change and turns a bad link into plain text. | Free text paths. | Clickable, checked links. |
| X4 | Mermaid flowchart, sequence, and class diagrams, at most 3. The mermaid module loads lazily. The SVG shows as a data-URL image. securityLevel strict; `%%{` directives stripped; a failure shows the code and the error line. | No diagrams. Server-side render with a headless browser. Inline SVG (needs a CSP change). | S14. No CSP change, because img-src allows data: (app.ts:55-61). |
| X5 | One stored result per run. The page shows the newest one, marks it stale when the heads move, and runs again only on a click. | Auto-run on open. | BRIEF: every run starts from a click. |

### 4.4 Part 4: Measure quality

| ID | Decision | Alternatives | Why |
|---|---|---|---|
| M1 | An eval harness on synthetic fixture PRs with seeded bugs and known non-bugs (traps). Scoring is deterministic: path, side, and line overlap. The user runs it with the real CLI. | An LLM judge for matching. Real company PRs. | No heuristic, no private code. Repeatable. |
| M2 | The harness first records a baseline of the current prompts, before any prompt change. | Compare only v2 variants. | Proof that v2 beats v1. |
| M3 | In-app outcome tracking from existing tables, plus an optional discard reason and the prompt version. A small "Review quality" table in Settings. | A new outcome table. | Most facts exist: status, edits, posts, resolves, orphaned anchors. |
| M4 | "Learn from discards" comes later, after the stats show the main discard reasons. | Build now. | It needs data. A wrong suppression hides real bugs. |

### 4.5 Part 6: Build a Jira task

| ID | Decision | Alternatives | Why |
|---|---|---|---|
| B1 | Three sizes. Small: one PR with a short plan and the code. Medium: a spec PR, then one code PR. Large: a spec PR, an optional contract PR, stacked part PRs, and a cleanup PR. Claude proposes the size. Two app rules raise it: a migration or an API change gives at least medium; an estimate over the line budget gives large. The user confirms before code. | One flow for all tasks. | A one-line fix does not need a spec review. A big feature needs small PRs. |
| B2 | An interview comes first: structured questions with options and a recommended answer, at most 2 rounds. | Spec first, questions inside it. | Unknowns surface before the spec. The answers feed the spec. |
| B3 | The spec lives in the repository at `specs/<KEY>/` (per-repo setting). Small uses one file plan.md with three sections. Medium and large use design.md, spec.md, and tasks.md. | Only in the app data folder. | Colleagues review it in Bitbucket, and it stays with the code. |
| B4 | The spec PR is a normal Bitbucket PR that the app creates on a click. Draft replies, Fix, revisions, "Fixed in", and resolve work on it as on any own PR. | A review screen inside the app. | Reuse. Colleagues use the tool they know. |
| B5 | Code goes into separate PRs. Medium: one code PR stacked on the spec branch. Large: each part PR targets the branch of the part before it. | Spec and code in one PR for every size. | Small reviewable PRs. The code does not wait for the spec merge. |
| B6 | Write runs (kind implement) run only in an app-owned worktree of the cache, never in the user's clone. Claude gets Read, Grep, Glob, Edit, Write, and the read-only git tools. It gets no shell. The app runs the allowlisted build and test commands. | Give Claude an allowlisted Bash. | S15: Bash rules are no boundary, and native Windows has no sandbox. The app keeps a full log of each command. |
| B7 | Tests first in each part, from its acceptance criteria. A line budget of 400 changed lines per PR (lock files excluded). A part that grows past it stops and proposes a split. | Tests last. No budget. | Reviewable PRs and proof of behavior. |
| B8 | Own review (the part 1 finder and verify phase) before any PR. The loop fixes confirmed blocker and major points, at most 2 tries. | Open the PR and let colleagues find them. | Colleagues see fewer known defects. |
| B9 | Push and PR only on a click. Only branches the task created. Never the target branch. A force push only after a confirm, with a lease. | Auto-push. | BRIEF: nothing goes to Bitbucket without an explicit action. |
| B10 | At most 2 open code PRs per task. After a lower PR merges, the app proposes to move the next PR to the new target in one click. After a squash merge, it proposes a rebase and a force push with a lease, after a confirm. | Unlimited stack. Auto-retarget. | Reviewer load and review safety. |
| B11 | The next part starts when the PR before it has at least 1 approval, no "Needs work", no open blocker task, and green or no builds on its head. The user can override with one confirm. | Wait for the merge. | Fast flow with a review gate. Section 10 Q19. |
| B12 | The loop shares the one run slot step by step. It takes the slot for each Claude step and frees it between steps. | A second slot for tasks. | Constitution principle 5: one run at a time. A review click waits at most one step. |
| B13 | Living spec: when the code shows the spec is wrong, the loop proposes a commit to the spec files and stops for the user. | Drift silently. | The spec stays the truth. |
| B14 | All Claude runs of a task are review_run rows with a task column. pr becomes nullable for them. | A second run table. | Reuse of slot, log, cancel, usage, and restart recovery. 44 queries need an audit (tasks.md WP-B0). |
| B15 | The plan uses fixed patterns. A prep part holds a refactor that keeps behavior. A feature flag hides new behavior when the repository has flags, and the plan names its removal. Schema and API changes go expand, then migrate, then contract. A spike part explores an unknown. It never merges, and its result changes the spec. Parallel parts in several worktrees come later. | Parallel parts now. | One run slot and the reviewers' load. A stack of 2 open PRs already overlaps review and build. |

## 5. Architecture

### 5.1 Part 1: Review pipeline

```
Start (brief) -> workspace (unchanged) -> finder run (phase "finding")
   -> validate: anchor + cause + rule quote (app) -> dedupe groups (app)
   -> verify run (phase "checking", same workspace) -> caps + groups (app)
   -> items + summary (judge) -> UI groups by verdict and volume
```

| Area | File | Change |
|---|---|---|
| Profile fields | src/shared/dto.ts:118-150 | modules (string[]), volume (quiet, balanced, thorough), verifier {mode on or off, model, effort}. Defaults on parse. |
| Shipped profiles | src/server/review/catalog.ts:59-138, 161-184 | "Review" (id general) with modules and efforts. Explain lens text. FORMER[4]. Former covers name, note, prompt, maxTurns, languageChecks, effort, reviewer, modules, volume, verifier, with a deep compare. |
| Version | src/server/config.ts:50 | PROFILES_VERSION 5. |
| Retire | src/server/settings.ts:56 (upgradeConfig) | Drop shipped security and over when every field equals its v4 value. Else keep them as the user's own profiles. |
| Finder prompt | catalog.ts:241-333 | FINDER_RULES replace SEVERITY_RULES and RESULT_RULES lines for review runs. Module sections. Context block (R14). No DELEGATE when the app gives no Agent tool. |
| rl-reviewer | catalog.ts:476-493 | Same context block, modules, rubric, and do-not-flag list. Pinned effort. |
| Verify agents | catalog.ts (new verifyAgent, verifierAgent) | Verify rules (spec.md section 1.6). |
| Schemas | src/shared/review.ts:14-94 | finding gains title, trigger, cause, rule, module (with defaults). New verifyResult. explainResult and discussResult (parts 2, 3). |
| Delegation | src/server/review/jobs.ts:534-545 | Agent tool only above the size limit, or with reviewer mode always. |
| Validation | src/server/review/validate.ts:146-213 | cause check on changed lines (diffmap.ts newLines "add"), rule quote check, drop reason "unchanged" and "rule". |
| Verify phase | jobs.ts steps (after runner.run, before workspace remove), judge.ts | context/candidates.md, second runner.run, verdict merge, caps. One Ending. |
| Storage | migration 030 | review_run.prompt_version, phase usage in usage_json. Finding payload verify {…}. |
| UI | src/web/review/Brief.tsx, Drafts.tsx, RunLine.tsx | Checkboxes and volume. Groups. Refuted list with Restore. Phase line and cost. |

Phases and time: the run line says "Finding problems" and then "Checking 9 findings". The run log groups the events by phase (run_event gains no column: the verify events carry agent "rl-verify" or "rl-verifier"; migration 028 added run_event.agent).

Estimate for a 500-line change (not measured; WP-M1 measures it): finder 5 to 12 min, verify 2 to 6 min for about 10 candidates, so the run takes 30 to 50% longer and costs 30 to 50% more tokens than today. The verify phase reads only the code around each candidate.

Failure rules: a verify phase that fails (usage limit, auth, max turns, schema) makes the run incomplete. The candidates stay with verdict "unchecked", and the run line says "The check did not finish: 9 findings are not checked." The run never says "no issues".

### 5.2 Part 2: Discuss

- Start: the "Ask Claude about this" link on a finding card, in Drafts or on a diff line. After a post, the thread More menu item "Ask Claude about this comment" starts it. It shows only when the root post holds an AI finding.
- Run: kind discuss. Workspace at the current heads, as Ask. Context files: context/finding.md (the finding at its run head, with the anchor excerpt, verdicts, and the user's current text and state) and context/discussion.md (earlier turns of this finding, newest last, 40 KB cap). The new user message is the only content of "Your instructions" (prompt.ts common(), as Ask).
- Result: answer (Markdown), verdict, reason, revision (severity, title, body) for revised, reply for a posted finding.
- Apply at the run end: upheld changes nothing. Revised stores a revision item (kind finding, status discarded, payload revises <finding>). Withdrawn discards the finding with withdrawn {run, reason, was}. A posted finding gets a reply draft (origin discuss, writer rank of a reply run) when reply has text. Withdrawn on a posted finding also proposes resolve, ticked when the user started the thread.
- Items: items.ts use-revision and keep-mine accept a finding revision. Ready to post, history.md, and the post plan skip a finding with revises set.
- Limits: 20 user messages per finding, 4,000 characters per message, 8,000 per answer, 40 turns per run.

### 5.3 Part 3: Explain

- Start: the action bar button "Explain this PR" (key w). The setup comes from the Explain profile (model, effort, turns, prompt lens). With 2 or more explain profiles, the page shows a small picker.
- Run: kind explain. The same workspace and context files as a review, but no history.md and no questions.md.
- Validation: anchors of risks use the finding anchorer. Diff links are checked against the change. A bad link becomes plain text and counts in coverage.skipped. Extra mermaid fences after 3 become code blocks.
- Page: route `/:view/:project/:repo/:id/explain`. Sections in order: summary, "Read in this order", walkthrough, risks, files, glossary. Questions go to Drafts as today. A diff link opens the Files diff at that line and pushes a history entry.
- Mermaid: src/web/explain/mermaid.ts imports mermaid lazily, renders one diagram at a time, and gives an `<img>` with a data URL. Theme variables come from the CSS tokens. A theme change renders again.

### 5.4 Part 4: Measure

- Eval harness: fixtures/eval/cases/<id>/ holds case.json, base/ (files), and head.patch. scripts/eval/run.ts builds a temp git repo per case. It serves the repo through the `gitRemote` option of createReviewJobs (jobs.ts:625) and seeds a temp database with one PR row. Then it starts the review job with the real CLI and scores the shown items. scripts/eval/compare.ts prints the deltas of two result files. The harness refuses to start without `--real`.
- In-app tracking: GET /api/stats/review computes per profile and prompt version: runs, candidates, refuted, unsure, shown, accepted, edited, discarded by reason, posted, addressed, outdated, mean time, and mean cost. Addressed: the thread of a posted finding is resolved, or a "Fixed in" draft exists. Outdated: the anchor turned orphaned after the post (comment.orphaned_at).
- Discard reason: after d or Discard, the card offers chips: Not a bug, Not worth fixing, Duplicate, Intended, Wrong place. One click stores payload discardReason. No chip is required.

### 5.5 Part 6: Build a Jira task

#### Flow by size

```
Small : Questions -> Plan -> Build (tests, code, own review) -> Open PR (plan + code) -> Done
Medium: Questions -> Plan -> Spec PR (colleagues) -> Build -> Open code PR -> Done
Large : Questions -> Plan -> Spec PR -> [contract PR] -> part 1 PR -> part 2 PR (stacked) ... -> cleanup PR -> Done
```

- Sizing: the spec run returns the estimate (parts, changed lines per part, files, modules, flags db, api, unknowns). The app applies the two rules of B1. The plan screen shows the size with one line of meaning, and the user confirms or changes it.
- Re-size: a small task that grows past the budget stops and offers "Make it medium" or "Make it large". It never opens a big PR. A large task whose plan has one part offers "Use one PR".

#### Entities (spec.md section 6.3 has the columns)

| Table | Holds |
|---|---|
| task | One task per Jira key and repository: state, size, branches, spec folder, settings, budgets. |
| task_question | Interview and loop questions with options, recommended answer, and the user's answer. |
| task_part | One row per PR of the task: spec, contract, part, cleanup, or spike. Branch, base branch, PR link, state, size. |
| task_step | One row per loop step: interview, spec, tests, implement, check, fix, review, commit, push, pr, retarget, rebase, replan, question, spec-change. Commands with exit codes and output tails, diff stats, run link. |
| task_event | Notifications: needs you, part ready, spec approved. One row per task, kind, and ref. |
| repo_task_settings | Per repository: spec folder, branch prefix, line budget, max open code PRs, approvals needed, commands (argv lists), test path globs, excluded globs. |

#### Run kinds

| Kind | Tools | Workspace | Output |
|---|---|---|---|
| interview | Read, Grep, Glob, rl-git | Sanitized snapshot of the target head | questions[] or done |
| spec | Read, Grep, Glob, rl-git | Sanitized snapshot of the target head (or the spec branch for a replan) | docs, tasks, estimate |
| implement | Read, Grep, Glob, Edit, Write, rl-git | The task worktree (writable, app-owned) | summary, done, question, specChange |
| review (task) | as today | Sanitized snapshot of the task commit | findings (part 1 pipeline) |

#### Write runs: what enforces what

| Layer | Enforced by | Rule |
|---|---|---|
| Tools | CLI `--tools Read,Grep,Glob,Edit,Write` and `--allowedTools` with the same names plus the rl-git server | No Bash, PowerShell, WebFetch, WebSearch, or Agent. The init check kills a run that lists another tool (existing rule). |
| Approvals | CLI `-p` manual mode | A call that needs approval and has no allow rule is denied (S15). |
| Settings and hooks | CLI `--restricted`, `--strict-mcp-config` | No hooks, no settings files, only app MCP servers (Gate B8, B9). |
| File tool confinement | CLI `--restricted` | Read stays in the cwd (Gate B8). Edit and Write confinement is unverified: Gate B17. |
| Config files | App: sparse checkout of the worktree | `.claude/`, `.mcp.json`, `.codegraph/`, CLAUDE.md, CLAUDE.local.md, AGENTS.md, `.gitmodules`, and hook sources are absent on disk. Commits keep them unchanged. |
| Changed paths | App: `git status` after each step | A denied path (fix edit rules, BRIEF Denied paths) or a path outside repo/ fails the step and resets the worktree to the last commit. |
| Commands | App | Only the argv lists of repo_task_settings, run by the app, with timeouts and process-tree kill. Claude never starts a process. |
| Secrets | App | Scrubbed env (BRIEF Child environment), no token in the worktree or env, isolated git config without credential helper, optional HOME isolation. |
| Not enforceable | nobody | A test or build command runs code that Claude wrote. It can read the user's files and reach the network. Native Windows has no OS sandbox (S15). Safeguards: the plan approval, the own review, the user's look at each PR before push, the first-use warning (section 10 Q2). |

#### Git and Bitbucket

- Cache: the existing bare cache per repository. Task refs live under `refs/rl/task/<task id>/`. Task branches are local branches of the cache, named like the remote branch.
- Worktree: one per open part under `<dataDir>/tasks/<db stem>/<task id>/part-<n>/repo`, made with `git worktree add` from the cache, with sparse checkout, `core.symlinks=false`, and `core.hooksPath` set to an empty folder. Commits use the user's name and email from Settings or the clone config. No hook runs.
- Push: `git push` from the cache with the token in the GIT_CONFIG env (git.ts:46, as the fetch). A new branch pushes with `--force-with-lease=refs/heads/<b>:` (must not exist). An update pushes with the lease of the last pushed hash. The app refuses any refspec to a branch that the task did not create, and to the target branch.
- Bitbucket calls (src/server/bitbucket/ only): create PR, update PR (destination, title, description, reviewers), build stats of a commit, repository clone links for a task without a PR. Gate G1 to G6 check them on Data Center 9.x.
- Remote HEAD: `git ls-remote --symref <url> HEAD` gives the default target branch for a task without a PR.

#### Stack rules (large)

- Each part branch starts from the head of the branch below it. The first part starts from the spec branch (or the contract branch).
- At most 2 open code PRs. The loop builds the next part only when the PR below it passes the gate (B11) and the open count allows it.
- A lower PR gets new commits (colleague fixes, Fix flow): the app proposes "Update part 3", which rebases the upper branch on the new lower head. The rebase changes published commits, so the push needs a confirm and uses a lease.
- A lower PR merges with a merge commit: the app proposes to move the next PR to the lower PR's target (PUT destination). The diff stays clean.
- A lower PR merges with a squash: the app proposes the move plus a rebase onto the target (`git rebase --onto <target> <old lower head> <branch>`) and a force push with a lease, after a confirm.
- A lower branch deleted at merge: Bitbucket can decline the PRs that target it (unverified, Gate G5). The part PR text asks the merger to keep the branch until the next PR moves. If Bitbucket declined the next PR, the app offers "Open the PR again" and says that its comments stay on the declined PR.
- After each merge, a replan run reads the target branch and the remaining tasks. A changed plan needs the user's approval and goes in as a commit to tasks.md.

#### Loop of one part

```
tests step (implement, mode tests) -> checks must fail (new tests red)
for each task of the part:
    implement step -> checks -> red: fix step (at most 3) -> green: commit (tick the task in tasks.md)
    size check -> over budget: stop, propose a split
own review (finder + verify on part base..head) -> blocker or major: fix step (at most 2) -> checks -> verify again
ready -> "Open PR for part 2 of 4" (click) -> push + create PR -> wait for review and builds
```

Stop points (each one says why and offers one button): red after 3 fixes; a check that times out twice; a blocker after 2 fixes; a question from Claude; a spec change proposal; a denied path; over the line budget; over the time, turn, or cost budget; usage limit or auth problem; Cancel. Resume restarts the stopped step from the last commit. The app keeps the discarded changes as a patch file in the task folder.

#### Run slot and notifications

- Each Claude step takes the slot. Checks, git, and Bitbucket calls do not. A user start during a step gets 409 with "Pause building after this step". The loop waits for a free slot and says "Waiting for your review of PR #12 to finish."
- task_event notifies only for: needs you, a part ready to open, and spec approved. One tab claims each event. The notifications setting applies.

### 5.6 UX rules for every part

1. One primary action per state, with a short step strip.
2. Plain words in the UI ("part 2 of 4", not slice or stack).
3. Say what happens now, what the app waits for, and who must act.
4. Good defaults and no setup before the first use.
5. Questions as a simple form with the recommended option preselected.
6. Few approvals: the plan and each PR. One confirm only for destructive or outward actions.
7. Errors name the cause and the next step, with one button.
8. Notifications only when the user must act or a part is ready.
9. Progress visible in the inbox row.
10. Reuse components, the prototype look, the keyboard model, and the accessibility rules.

Parts 1 to 3 follow the same rules: one "Review" setup with a few named checkboxes and a three-step volume; one "Ask Claude about this" link; one "Explain this PR" button. spec.md section 7 checks each screen against each rule.

## 6. Migration

- Profiles: PROFILES_VERSION 5. FORMER[4] holds the version 4 values of every changed shipped field. upgradeProfile compares arrays and objects by their JSON. An unedited field gets the new value; an edited field stays (BRIEF Profile upgrades).
- New fields parse with defaults: modules [] (a user profile keeps today's checks), volume balanced, verifier {mode on, model null, effort null}. A user profile therefore gets the verify phase. The changelog says so.
- Retire: a shipped security or over profile whose every field equals its version 4 value leaves the list. An edited one stays as the user's own profile and gets no later upgrades. pr_brief.profile with a removed ID falls back to the default (profileOf, catalog.ts:141). Old runs keep profile_name.
- Explain: the explain profile stays as the setup of "Explain this PR". Its prompt and effort upgrade field by field. Old explain runs (kind review, explain 1) keep their old run line.
- Results: new keys of finding, verify, and summary parse with defaults. A finding without verify shows as "Not checked", in the main list as today.
- Database: 030 rebuilds review_run for kinds explain and discuss and adds prompt_version, item, and discuss_json. 031 rebuilds review_run again for kinds interview, spec, and implement, makes pr nullable, adds task, and adds the task tables (spec.md section 8).

## 7. Risks

| Risk | Mitigation |
|---|---|
| The verify phase refutes real bugs. | Refuted points stay visible with Restore. The eval reports candidate recall and shown recall apart. |
| Cost and time grow. | Verify reads only around each candidate, at medium effort. The run line shows time and cost per phase. The eval measures. |
| The model ignores the cause rule. | The app drops the finding with reason "unchanged". The dropped list shows it. |
| Retiring profiles surprises a user. | Only fully unedited profiles retire. The changelog names the Security and Simplify checkboxes. |
| Mermaid CSP noise or layout breaks. | Fallback to the code block. WP-X2 checks the console in e2e. |
| Nullable review_run.pr breaks a query. | WP-B0 audits the 44 queries and adds a test per file. |
| A write run escapes the worktree. | Gate B17 before WP-B4. Path check after each step. No shell. |
| Test commands run hostile code from a hostile Jira text. | Plan approval before code. The user sees each PR before push. First-use warning. WSL2 sandbox later. |
| Bitbucket declines a stacked PR when its target branch is deleted. | Gate G5. PR text asks to keep the branch. "Open the PR again". |
| A loop holds the slot for long. | Per-step time caps (20 min default) and "Pause building after this step". |
| Terms: many runs after one click. | Each part waits for colleagues anyway. Per-part budgets. Section 10 Q5. |

## 8. Brainstorm (part 5)

| Idea | Verdict | Reason |
|---|---|---|
| Time and cost per run and phase in the run line | Now | usage_json exists. Users need it to trust the verify phase. |
| Summary ledger in plain words ("2 must fix, 3 worth fixing, 4 low confidence") | Now | Part of WP-R4. |
| Two passes, cheap then deep (a fast triage marks risky files, a deep pass reads them) | Later | The verify phase comes first. The eval shows if recall needs it. |
| CodeGraph for the finder by default when the user has it | Later | Index time up to 120 s per run. Measure with an eval case that has a caller bug first. |
| Re-anchor dropped findings (post as a general comment) | Later | BRIEF: invalid references become coverage problems. Needs a user decision. |
| Per-repo learned rules ("Learn from discards") | Later | Needs the discard reasons of part 4 first (M4). |
| Topic specialist agents for "Show everything" | Later | S13. The eval can show a gain. |
| A suggested fix block in reviewer findings | Later | Useful only when small and complete (S12). Fix covers own PRs. |
| Incremental Explain ("what changed since my last look") | Later | Needs the base explain result. |
| Risk score per PR in the inbox | Later | BRIEF backlog. |
| "Fix all" plan handed to the user's session as design, spec, and tasks | Reject | Part 6 and "Copy for your session" cover it. |
| Auto-review on push, pre-review queue | Reject | BRIEF: every run starts from a click; usage terms. |
| A second model as verifier by default | Reject | The verify model is a profile field. The eval can compare. |

## 9. Comparison with the colleague's app (placeholder)

Fill this in when the sources arrive. Compare each row on the same eval cases where possible.

| Area | Questions |
|---|---|
| Prompts | Structure, emphasis words, severity rubric, do-not-flag list, intent input. |
| Agents | Split, delegation control, effort and model per agent. |
| Verify | Separate pass or not, per finding or per batch, caps. |
| Anchoring | Line checks, quote checks, "only what the PR adds". |
| Noise | Volume levels, folds, dedupe, learning from discards. |
| Discussion | Per-finding talk, verdicts, revision safety. |
| Explain | Narrative, links, diagrams, safety of rendering. |
| Measurement | Eval data, metrics, outcome tracking. |
| Cost and time | Per 500-line PR on the same cases. |
| Safety | Read-only runs, sandbox, token handling, post gate. |
| Build a task | Interview, spec review, tests first, PR size, stack handling. |
| UX | Steps to a posted review, keyboard, plain words. |

## 10. Open questions (recommended default in brackets)

Hard-rule changes first. Each one needs the user's explicit yes.

1. Q1 Write runs. BRIEF 3.5 says runs are read-only. Allow a new run kind implement with Edit and Write? It runs only in an app-owned worktree of the cache. It never runs in the user's clone, and review runs stay read-only. Safeguards: no shell, `--restricted`, and `--strict-mcp-config`. Config files stay out of the worktree (sparse checkout). A path check after each step resets a bad step. Each step has turn and time caps. Cancel works at any time. The plan approval comes first. The log keeps each command and diff. [Yes, after Gate B17 passes.]
2. Q2 App-run commands. BRIEF section 7 says no repository scripts run. Allow the app to run the build and test commands that the user approves per repository? They run as exact argv, with no shell and with timeouts, in the task worktree. These commands run code that Claude wrote. On native Windows no OS sandbox exists (S15). [Yes. The first use shows one warning with "I understand". A WSL2 or sandbox runner comes later.]
3. Q3 Push and PR. BRIEF and CLAUDE.md say the app never pushes. Allow a push and a PR create or update on a click? Rules: only branches that the task created, never the target branch, always with a lease, and a force push only after a confirm. The token needs Repository write. [Yes.]
4. Q4 Jira keys without a PR. BRIEF section 7 lets the app fetch only keys that a PR names. Allow a fetch of the key that the user types in "Build a Jira task"? [Yes.]
5. Q5 Many runs after one approval. BRIEF 3.2 says every review starts from a click. The loop starts several Claude runs after the plan approval and after each PR click. [Yes. Each part stops at its PR click and at the colleagues' review. Re-read the usage terms before a release.]
6. Q6 Spec files in the repository. The spec PR adds `specs/<KEY>/` to the target branch. [Yes, folder per repository setting, default `specs/<KEY>/`.]
7. Q7 Retire the unedited Security and Over-engineering profiles and replace them with the Security and Simplify checkboxes? [Yes.]
8. Q8 Verify phase effort. [medium. The eval can raise it.]
9. Q9 A revised verdict on an untouched finding also stores a revision, not an in-place change? [Yes, one rule for all.]
10. Q10 A withdrawn verdict on an accepted finding discards it at once, with Restore and the mark? [Yes, as a session reject does.]
11. Q11 Size limits: no Agent tool below 1,200 changed lines and 30 files; rl-verifier above 12 candidates. [Yes. The eval tunes them.]
12. Q12 Default volume. [Balanced.]
13. Q13 Explain as a page in the detail pane, not in the panel slot. [Page.]
14. Q14 Discard reason chips after a discard, optional. [Yes.]
15. Q15 Small tasks use one combined plan.md. [Yes.]
16. Q16 Code of a medium or large task stacks on the spec branch, so it does not wait for the spec merge. [Yes.]
17. Q17 Line budget per PR. [400 changed lines, lock files excluded, per repository setting.]
18. Q18 Open code PRs per task at once. [2.]
19. Q19 Gate for the next part: approvals needed. [1 approval, no Needs work, no open blocker task, builds green or none. Override with one confirm.]
20. Q20 Open part PRs without a click. [Off. A per-task switch "Open part PRs for me" exists under More.]
21. Q21 Minor points of the own review. [Listed in the Task view. Not fixed by the loop. "Fix these too" is one click.]
22. Q22 Tasks started outside a PR: attachments. [Later. v1 lists them by name only.]
23. Q23 Retarget after a merge. [One click with one confirm, because it changes a colleague's view.]
24. Q24 Review runs for a task before any PR exists need review_run.pr nullable (B14). [Yes, with the query audit.]
