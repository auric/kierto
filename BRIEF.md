# Revido: Project Brief

Status: draft 3, 2026-10-11. Scope: a production-quality personal tool for Bitbucket Server pull request (PR) review with Claude Code. Edge-case reference: PROJECT_BRIEF_GPT_ASTRA_6.md.

## 0. How to use this file

- Sections 5, 6, and 7 are spec-kit inputs. Paste each one into the named command.
- Section 6 has no technology words on purpose. `/speckit-specify` must describe WHAT and WHY only.
- Run one spec-kit cycle per milestone (section 2). Do not specify the whole product in one cycle.
- spec-kit runs many long generation steps, and they cost many tokens. A cheaper path exists: tell Claude Code "Implement milestone M1 from BRIEF.md". Do the other milestones the same way.
- IMPLEMENTATION_PROMPTS_GPT_ASTRA_6.md is an alternative prompt set with the same per-slice process. Its two-pane and general-comments-only rules do not apply here.
- Section 8 gives a workflow that you can use this week without code.

spec-kit steps:
1. Run `uv tool install specify-cli`. If it fails, use the install line from the spec-kit README.
2. Run `specify init --here --integration claude` in this folder. Run `specify init --help` to confirm the flags.
3. Once: run `/speckit-constitution` with section 5.
4. M0 (Gate 0) is an integration check, not a feature. Use prompt 0 of IMPLEMENTATION_PROMPTS_GPT_ASTRA_6.md and write `integration-check.md`.
5. For each milestone M1 to M4: run `/speckit-specify` with section 6. Add "Specify milestone Mx only" and name its stories.
6. Run `/speckit-clarify`. Answer with the defaults from section 10.
7. Run `/speckit-plan` with section 7 and `integration-check.md`. Add "Plan milestone Mx only".
8. Run `/speckit-tasks`, then `/speckit-analyze` once. Fix real contradictions only.
9. Run `/speckit-implement` for one task group per fresh session. Start each group with its acceptance test.
10. End each session with a compact handoff: completed task IDs, changed files, tests run with results, known limits, next task group.
11. Start the next session with the constitution, the spec, the plan, the tasks, and the handoff only.

## 1. Problem

- Bitbucket Server does not show what changed since I last looked. New comments and replies to my comments get lost.
- There are too many PRs. I need a fast way to understand each PR and to review it.
- I want AI review with my Claude Code subscription. The subscription works only inside Claude Code. Other tools must not use its credentials.
- AI review invents library facts and misses side effects on other code. It must use real documentation and the whole repository, not only the diff.

## 2. Goals and build order

Release 1 goals:
- G1. One inbox shows every open PR that needs my attention, with unread markers and a concrete reason per row.
- G2. I follow each discussion per message. Edits, replies, and deletions show correctly. Read state survives restarts, sleep, and network loss.
- G3. I get a notification when someone replies to my comment or pushes new commits. Each event notifies once.
- G4. One click starts a Claude Code review or a cheaper Explain run of a PR.
- G5. I see what Claude Code does during a review: each tool call and each error.
- G6. Each result shows its reviewed commits, its coverage, and whether it is stale. An incomplete run never says "no issues".
- G7. I accept, edit, or discard each AI item. Only approved text goes to Bitbucket, exactly once from my point of view.
- G8. I write replies in the tool, with a preview and a confirmation.
- G9. The inbox and saved drafts work with no AI quota and with the code host offline.
- G10. Hostile PR content cannot run commands, change tool settings, or write to the code host.

Non-goals for Release 1:
- No diff viewer. Links open the diff in Bitbucket.
- No automatic review without a click. No automatic approval, merge, thread resolution, or code edit.
- Release 3 changes code only after an explicit Apply click. The app never pushes.
- No team features, no hosted server, no multi-user mode, no desktop shell.
- No Bitbucket Cloud, GitHub, or GitLab. Code-host access stays behind one boundary (ForgeProvider).

Build order (each milestone is useful alone):
- M0. Gate 0: integration check on a designated test PR. Record the Bitbucket version, auth route, current user ID, paging, nested replies, real edit, delete, and reply payloads, and inline anchors. Record Claude Code and Ponytail versions, the `claude auth status` route, the `structured_output` shape with stream-json, and the Windows checks (section 7). Missing production access does not block fixture work.
- M1. Inbox, sync, read state, notifications, and minimal settings: URL and token (US1 to US4, part of US9).
- M2. Review runner with the snapshot and all safety checks, live log, and Explain (US5, US6).
- M3. Triage, publish outbox, replies, and AI reply drafts (US7, US8).
- M4. Full settings and profiles (US9).

Release 2 (plan: docs/plans/r2.md):
- Re-review: review only the changes since the last review. Each earlier finding gets a verdict: open, fixed, or outdated. Open findings carry over to the new run.
- Jira context: fetch the text of the PR's Jira issues on a click. The review reads it as untrusted data.
- Ask the PR: a one-shot question about the PR. The answer is text only. Nothing can post.
- Read-only diff viewer: the changed files with threads and drafts on their lines. Links still open the diff in Bitbucket.

Release 3 (plan: docs/plans/r3.md):
- Fix it (author side): on my own PR, Fix works on each open, unresolved thread with a live message. This includes my own comments and posted findings. Fix also works on each open review finding that is not posted (new or accepted, with a place in the code). Each AI reply draft gets a judgement: valid, partly, invalid, question, or none. The judgement only sets the default tick in the Fix list. A read-only fix run first judges each point, then proposes exact edits. I review each edit, then click Apply. The app commits in my clone, or on an app branch that I fetch. I push by hand. A reviewer gets no Fix: "Fix works only on your own pull requests."
- Copy prompt for Claude Code: a prompt with the comment as untrusted data. I paste it into interactive Claude Code in my clone.
- Consult my session (plan: docs/plans/session-consult.md, parts A and B): on my own PR, "Copy for your session" copies the open review points, my own threads, and the resolved threads with IDs, code, and the view of the app. "Paste the answer" reads the JSON verdicts of the session that wrote the code, shows a preview, and on Apply makes reply drafts, discards or marks findings, and ticks the Fix list. Nothing posts. Part C, "Ask your session" (opt-in in Settings, Clones, default off): the app lists my transcripts on the PR source branch from their metadata only, forks the picked one with `claude -p --resume <path> --fork-session` and the read tools in a sanitized snapshot, and shows its answer in the same preview. Gate B16 (CLI 2.1.301) confirmed the resume flags. The fork runs with `--no-session-persistence` and leaves no transcript.
- Jira attachments: the brief lists the attachments of a fetched issue. I download each one on a click, save it, or open its folder. Inclusion in runs is an opt-in per file.
- Jira Markdown: the brief shows the Jira text as Markdown. The server converts it from the rendered HTML.
- Tasks for every run kind: reply drafts, Ask, and fix runs show the same task chips as the brief. Each run records the tasks it used.
- Resolved threads: a resolved thread shows who resolved it and when, read from Bitbucket. The diff folds resolved threads to one line. The app never resolves or reopens a thread.

## 3. Decisions

### 3.1 Form factor: local web app

| Option | Verdict |
|---|---|
| Local web app (TypeScript server on localhost, browser UI) | **Pick.** It can start the `claude` CLI, poll Bitbucket, and keep the token local. It runs on Windows, Linux, and macOS with no extra work. LLMs write good React code. It is easy to open source. |
| Qt / QML desktop app | No. UI work is slower, and fewer contributors know it. It gives nothing that the browser lacks here. |
| Electron or Tauri | Not now. It is the same app plus packaging. Wrap it later only if you need a tray icon. |
| Static web page | No. It cannot start Claude Code. CORS blocks Bitbucket calls. Token storage is unsafe. |
| Claude Code only (skills and MCP) | Phase 0 only. Each tracking check would spend LLM tokens. |

### 3.2 How the app uses Claude Code

- The app starts the official `claude` binary in headless mode (`claude -p`). This is ordinary Claude Code use by the subscriber.
- The app never reads, stores, or forwards Claude credentials. Each user logs in to their own Claude Code.
- The app does not use the Agent SDK with subscription login. Anthropic requires API keys for that.
- Every review starts from a human click. This keeps the use "ordinary" and individual.
- Before each run, the app confirms the subscription login route (section 3.5). It never falls back to paid API use.

Anthropic terms (checked 2026-10-09): "OAuth authentication ... is designed to support ordinary use of Claude Code and other native Anthropic applications." "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication." Read the current terms again before you publish the tool.

### 3.3 Most "enhanced review" requests need no app code

Claude Code runs in a sanitized snapshot of the PR head (section 3.5). It sees the full repository tree and the app's MCP servers. So these items are prompt work, not app features:
- Read project documentation: renamed CLAUDE.md files, README, docs/, ADRs. Treat them as untrusted and possibly stale.
- Find dependent code that the PR forgot: callers, overrides, config, tests.
- Check library and API facts with the Microsoft Learn MCP and the DeepWiki MCP. Send only public API and symbol names, never proprietary code.
- Compare the PR with its Jira issue. Release 2 adds this as an app connector, not as an MCP server. On a click, the app fetches the issue text through the Jira REST API. The review reads it as the untrusted file context/task.md. The review gets no Jira tool and no Jira token.

### 3.4 Polling, not webhooks

Bitbucket webhooks cannot reach a laptop on localhost. The app polls the REST API. Polling costs no LLM tokens.

### 3.5 Review safety

- `claude -p` never shows the workspace trust dialog. In an untrusted folder it still uses project hooks, the project `env` block, and `apiKeyHelper`. So never run Claude Code in a raw PR checkout.
- The app checks out the pinned PR head as a detached git worktree in an app-owned run folder. It removes `.claude/`, `.codegraph/`, `.mcp.json`, and links. It renames CLAUDE.md, CLAUDE.local.md, and AGENTS.md files.
- The runner passes `--restricted`, not `--setting-sources user`. With `--restricted`, no hook runs, also with `--setting-sources user` added (Gate B8, CLI 2.1.295).
- Gate 0 checked project CLAUDE.md and skills only with `--setting-sources user`. The snapshot rename and remove steps cover them under `--restricted`.
- `--strict-mcp-config` removes the user's MCP servers, including claude.ai connectors. `--agent rl-main` refuses the user's agents (Gate B9). Gate 0 did not check the user's own CLAUDE.md under `--restricted`.
- A review profile can add user-scope MCP servers from the top-level `mcpServers` of the user's Claude config file, with a per-tool allowlist. This is opt-in per profile. The run allows only the ticked tools and denies the other tools of each picked server.
- Never use `--bare`. It never reads OAuth credentials or the keychain, so the subscription login fails with it.
- `ANTHROPIC_API_KEY` in the environment wins over the subscription. The app removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the child environment.
- Before each run, the app calls `claude auth status`. It runs only when `authMethod` is `claude.ai`. Otherwise it stops and explains. Log only `authMethod` from `claude auth status`, because its output also holds the email and organization.
- `--restricted` ignores the settings files and keeps the file tools inside the cwd (Gate B8). The app refuses a CLI older than 2.1.295.
- A separate folder is not an OS sandbox. The review gets read-only tools only, no shell, and no code-host token.
- Fix runs (Release 3) are read-only, like reviews. They get no Edit, Write, or Agent tool. They return exact text replacements in `structured_output`. The app checks each edit. It applies the edits only after the user clicks Apply.
- The app never runs `claude` in the user's clone. A fix run uses the same sanitized snapshot as a review.

### 3.6 Local server safety

- Listen on 127.0.0.1 only. A random port is not authentication.
- Check the Host and Origin headers on every request. Use Hono `csrf()` on mutations. Never enable wildcard CORS.
- Every mutation needs a per-start session token. The server puts it into the page it serves.
- Outbound calls go only to the configured Bitbucket instance. Check redirects against it. Two exceptions: a review with a Docs profile lets the CLI call the documentation MCP servers (Microsoft Learn, DeepWiki). A profile with user MCP servers lets the CLI start or call those servers. The app also calls them for tools/list in Settings and at run start. A remote user server needs https, except on localhost.
- Release 2: outbound calls can also go to the configured Jira origin. They occur only on a Settings save or a Fetch click, never during polling. The Jira client sends GET only, follows no redirect, and calls no other origin.
- Release 3: a Download click also calls Jira. The attachment download follows same-origin redirects only, at most 3 hops. It checks the origin and the base path on each hop. A cross-origin redirect is an error, so the token never leaves the Jira origin.
- Release 3: the app runs git in the user's clone only on a clone check, Apply, and Undo. It runs no git network command there. Apply and the confirm of a post call Bitbucket once for the live PR state.
- Attachment files are served as downloads (`Content-Disposition: attachment`, `application/octet-stream`, `nosniff`, `Content-Security-Policy: sandbox`). Inline display is for raster images only: PNG, JPEG, GIF, and WebP by magic bytes. SVG and HTML are never served inline. No browser request goes to Jira.
- Support a corporate CA file. Never disable TLS verification.
- The Bitbucket token lives in the OS credential store through `Bun.secrets` (experimental; verify in Gate 0). Fallback: memory only, asked again after a restart. The Jira personal access token (Release 2) uses the same store under its own name.
- The tokens never go into SQLite, localStorage, URLs, logs, or prompts. Logs are redacted. No telemetry.
- Render comment Markdown safely. Never fetch external images from untrusted comments automatically. Skip raw HTML. A link URL with a scheme stays only for http(s). Relative URLs and fragments stay. An image source `attachment:<id>` (Release 3) maps only to the local image route of a downloaded raster image.

### 3.7 Stack and scope choices

| Choice | Reason |
|---|---|
| Hono on Bun | It runs on Node through `@hono/node-server` if Bun fails Gate 0. It has `csrf()`, `streamSSE`, `zValidator`, and the typed client `hc<AppType>()`. |
| Vite for the UI | shadcn/ui documents a Vite setup. Bun HTML imports are not needed. |
| bun:sqlite | Built in. Prepared SQL and checked-in migrations, no ORM. |
| Inline comments in Release 1 | Commit-pinned anchors, tests for renames, removed lines, and lines outside the diff, and a general-comment fallback. |
| Three panes (prototype) | Sidebar, list, detail. The process log opens as a dialog, out of the main reading path. |

## 4. Architecture

```
Browser UI (127.0.0.1, React + TanStack Query)
   |  HTTP JSON (typed client) + Server-Sent Events
Local server (Bun + Hono, TypeScript)
   +-- bitbucket/  ForgeProvider: REST client --> Bitbucket Server (read, post)
   +-- sync/       poll, page, reconcile, checkpoints
   +-- inbox/      attention rules, read state, notifications
   +-- review/     jobs, snapshot, auth check, CLI runner, validator, fix edits
   |     +-- clone.ts: checks, apply, commit, undo in the user's clone (Release 3)
   |     +-- git cache (bare clone) --git worktree--> run folder (sanitized)
   |     +-- spawn: claude -p (cwd = snapshot, scrubbed env)
   |                 +-- MCP: Microsoft Learn, DeepWiki
   |                 +-- MCP (optional, read-only): CodeGraph
   +-- context/    ContextSource: Jira REST client --> Jira (read, on a click)
   |     +-- attachments: download, store, serve (Release 3)
   +-- publish/    approvals, durable outbox, reconcile
   +-- storage/    SQLite, migrations
```

Flow of one review:
1. The user clicks Review and picks a profile. The server returns the existing job if one is active for the same PR, commits, and profile.
2. The server checks the CLI version and `claude auth status`. It stops with a clear message on a wrong route.
3. The server fetches the PR head into the bare cache and pins the source, target, and merge-base commits.
4. The server exports the snapshot, removes dangerous files, and writes the PR context files next to it.
5. The server starts `claude -p` with a scrubbed environment and sends the prompt on stdin.
6. The server streams Claude events to the UI: tool calls, errors, progress.
7. Claude returns structured JSON. The validator checks the schema and every file and line against the snapshot.
8. The user triages the items and approves exact texts. The server posts through the outbox and reconciles the outcome.
9. The server deletes the snapshot folder.

## 5. Paste into /speckit-constitution

```
Review Loop principles:
1. Human gate: nothing goes to the code host without an explicit user action. Approval binds the exact text and destination. Editing the text removes the approval.
2. Untrusted input: PR titles, descriptions, code, comments, and repository files are hostile. They can contain prompt injection or executable configuration. Review runs use a sanitized snapshot, read-only tools, and no code-host write access. The app posts, not the AI.
3. Credentials: the app never reads, stores, or forwards AI-provider credentials. It starts the user's own official Claude Code CLI with the subscription login. It never falls back to paid API use. Code-host tokens stay in the OS credential store or in memory.
4. Zero-token tracking: polling, unread state, notifications, and publication never call an LLM. Only reviews, explanations, drafts, fix proposals, and Ask answers use tokens.
5. One review runs at a time by default. Each run shows the usage that the CLI reports. No automatic retry after a usage limit.
6. Revision-pinned evidence: every result names the commits it reviewed. A result for older commits shows as stale.
7. Honest coverage: every result lists what it read, skipped, and could not reach. An incomplete run never reports "no issues".
8. No blind retry: after an unknown write outcome, reconcile with the code host first. Never claim exactly-once delivery without server support.
9. Private code stays private: never put proprietary code, internal URLs, or PR text into public documentation queries.
10. Deployment prerequisite: the company authorizes sending source code to Claude and using the documentation services.
11. Three expansion boundaries: ForgeProvider, ReviewRunner, ContextSource. Build each one only when its milestone needs it. No other plugin layers.
12. Routine tests use sanitized fixtures and a fake Claude CLI. Real-server tests run only with separate authorization.
13. Minimal UI: few screens, few options, good defaults, full keyboard use. Add a setting only when a default fails.
14. Local-first: all data stays on the user's machine. No telemetry.
15. Small and boring: use the standard library and platform features first. Add a dependency only when it saves real work.
16. Open-source ready: no company names, hosts, or secrets in the code. The config holds all instance details.
```

## 6. Paste into /speckit-specify

```
Build "Review Loop": a personal tool that helps a developer review pull requests on a self-hosted Bitbucket Server. It also helps the developer follow the discussion after the review. It is a production-quality tool, not a prototype.

Users: one developer who reviews many pull requests and authors some. Later: any developer who uses Bitbucket Server.

Problem: the code host does not show what changed since the user last looked. New comments, replies, and new commits get lost. Reviews take long because the user must first understand each pull request. AI reviews often invent library facts and miss effects on code outside the diff.

User stories, in priority order:

US1 Inbox (P1). As a reviewer, I see one list of open pull requests where I am a reviewer or the author. Each row shows the title, repository, author, my role, my review state, the last activity time, and the unread count. Each row also gives a concrete reason: "Reply to your comment", "New commits since your review", or "Review requested". Rows with unread events come first. I can filter by text and by repository.
Acceptance: a new comment on a listed pull request shows as unread within one check interval. A merged or declined pull request leaves the open views but keeps its unread conversation.

US2 Read state and following (P1). As a reviewer, I track each message, not only each pull request. The first check imports old history silently: no unread flood, no notifications. Marking read covers only the messages that the tool showed me. An edited message can become unread again. A deleted message shows as deleted only after the tool confirms that the code host no longer has it. A failed or partial check never deletes anything. I can follow, unfollow, and archive a pull request. A merged pull request stays followed until I archive or unfollow it. Read is not the same as resolved or reviewed.

US3 Notifications (P1). As a reviewer, I can turn on desktop notifications. I get one in these cases: someone replies in a thread that I started or joined; someone comments on my pull request; someone adds me as a reviewer; someone pushes commits to a pull request that I already reviewed. A click opens that pull request. Events for one pull request combine into one notification. After the tool was closed, I see one digest instead of many notifications.
Acceptance: each event gives one notification only. My own actions give no notification. A denied notification permission never blocks the inbox.

US4 Pull request page (P1). As a reviewer, I see the description and the discussion. Unread messages are highlighted. I also see my open threads and a link to the diff on the code host. "Next unread" jumps to the next unread message. Old messages stay available but collapsed.

US5 AI review and explanation (P1). As a reviewer, I click "Review" and pick a profile. The AI reviews the pull request with the full repository, the project documentation, and trusted documentation sources. The "Explain" profile gives only the summary and the questions, at lower cost. The result has: the reviewed commits; a summary of what changed and why; risk areas; questions for the author, each with why it matters; findings; and a coverage report. Questions stay apart from findings. Each finding has a category, a severity, a confidence, and a location (file, line, side). It also has the scenario that triggers it, its evidence, and its evidence status (shown in code, reproduced, or unverified). It ends with the consequence and a suggested direction. The coverage report lists what the AI read and what it skipped or got cut. It also lists the sources it could not reach. I can cancel a running review.
Acceptance: a review never changes the repository and never posts anything. A failed review shows why it failed. An incomplete review never says "no issues". When the pull request gets new commits, the old result stays but shows as stale, with the reason.

US6 Review transparency (P1). As a reviewer, I watch a running review live: each tool call, its target, its result state, and each error. I can open the log of a finished, failed, or cancelled run. The log stays out of the main reading path.

US7 Triage, approval, and posting (P1). As a reviewer, I accept, edit, or discard each finding and each question. Before posting, I see the exact text and the destination of each comment and confirm them. Findings go as comments on the exact line of the reviewed commit. Questions go as one general comment. Items that cannot attach to a line also go into the general comment. Before posting, the tool checks the pull request again. It blocks stale items and shows why. It warns when a colleague already raised the same point. I see which items were posted, with links. Replies to posted comments come back into the discussion view.
Acceptance: discarded items are never posted. Editing an approved text removes its approval. A second post action does not create duplicates. If the tool cannot tell whether a post arrived, it says so and checks before any new attempt.

US8 Replies (P1). As a reviewer or author, I write a reply to any thread in the tool. I see a preview and confirm before it is sent. I can ask the AI to draft replies for all threads that wait for me, or for one thread. An AI draft is a draft only: I accept, edit, or discard it like a finding. I can copy the raw Markdown of any message. The same posting rules as US7 apply.

US9 Settings (P2). As a user, I set the code-host URL, my access token, the check interval, notifications, and the review profiles. A profile has a name and a prompt. The tool ships with four profiles: general review, over-engineering review, security review, and Explain. The token is kept safely and is never shown again after entry.

User experience: the tool looks clean and modern, like a good email client. It has three panes, as in the prototype: sidebar, list, and detail. The sidebar holds the views: Needs you, Reviewing, My PRs, Following, Archive, Review runs, Ready to post. It also holds the repositories with unread counts, the check status, the theme switch, settings, and a Collapse sidebar control. The list pane shows the view name, the count, a repository chip, and a filter field. The detail pane shows, in scroll order: a header, a sticky action bar, a status strip, a panel slot, the review record, the Description, Drafts, Threads, Files, and Commits. Once a review exists, the review record comes before the Description. Header: the key "PROJ/repo #id" is one link to the PR in Bitbucket. Below it are the title and a byline: the author (a link when the server gives the user page), the source branch link with a visible copy button, the target branch link, and the task chips. A chip without a task link is a dashed button that opens Settings, Task IDs. Action bar: Ask (q), Draft replies N, Fix N (own PR only), Review (r), Full width (z), and More (Open on the server, Copy the pull request link). It has no split buttons and no profile menu. A button never goes disabled without a reason in text: Draft replies with no thread to answer opens a popover that says why. Status strip: one line of jumps: your turn, new messages, open threads, drafts, and files. Panel slot: the review brief or Ask opens under the strip, one at a time. Esc closes it. Ask holds the box and all answers of the PR, newest first. Review record: the newest run with its profile, head commit, and age, then its summary and a ledger of severity counts. "Not checked: N" opens in place with one plain line per skipped or unavailable item. It never jumps to the run log. Run setup and Log are on the same line. Drafts: findings and questions are compact rows in one section. o or Enter opens a row with its code, comment, and actions. Threads: groups Your turn, Waiting on others, and Other discussions, with an "All | Need me" toggle. Each thread footer holds the reply box, Draft reply, Fix (own PR), and More. Files: each file row is one button. Without the code, a click first gets the code of both branches, then opens the diff of that file. One bottom bar holds the fix part and Ready to post. Panels: a splitter on the list edge sets the list width from 280 to 560 px by drag or keys. The detail keeps at least 560 px. The sidebar becomes an icon rail below 1440 px, or by choice. The width and the sidebar choice stay in localStorage only. z or Full width hides the sidebar and the list. Prose keeps its reading width. Only diffs use the extra width. Below 760 px, one pane shows at a time. URL and Back: the URL holds the view, the selected PR (/:view/:project/:repo/:id), the thread, the open file and line, full width (full=1), the repository filter, the filter text, and the Settings section or profile. A view change, a PR open by click, a file open, full width, and a Settings link push a history entry. j, k, thread focus, and filter edits replace it. Back and Forward walk these entries and restore the detail scroll. A reload or a link in a new tab opens the same place. A URL with an unknown PR shows "Cannot find this pull request". Dialogs, menus, the panel slot, triage state, and panel widths never go into the URL. Keyboard: j and k move in the focused pane, and over drafts, threads, and file rows in the detail; Enter or → goes into the detail pane; Esc or ← goes back (Esc closes a menu, a dialog, the panel slot, and full width first); 1, 2, 3 go to the top, the drafts, and the run log; r opens the review brief; q opens Ask; z toggles full width; a, d, e accept, discard, or edit the current draft; f and F open the Fix list on an own PR; p posts the accepted items after confirmation; n jumps to the next unread message; / filters the list; ? shows all keys. Each message has a copy button that copies its raw Markdown. Status is never shown by color alone; an icon or text always goes with it. The scroll position stays when new events arrive. Focus is always visible. The tool supports light and dark themes.

Required UI states (each one is a designed screen state, not a generic error message): empty, loading, offline, permission denied, usage limit reached, cancelled, incomplete review, stale review, uncertain publication.

Acceptance scenarios:
| # | Situation | Expected result |
|---|---|---|
| A1 | Someone replies to a comment that I posted. | One unread event appears in the correct thread. It stays unread after a restart. |
| A2 | A new message arrives while I mark a thread read. | Only the messages that I saw become read. The new message stays unread. |
| A3 | The same event arrives twice or out of order. | No duplicate message, thread, or notification appears. |
| A4 | A colleague edits or deletes a reply. | An edit shows the new text and can become unread. A deletion shows only after the tool confirms that the message is gone from the code host. |
| A5 | A discussion has many pages, nested replies, or replies whose parent is gone. | No message is lost silently. Any gap shows on screen. |
| A6 | The network or VPN drops during a check, or a check gets only part of the data. | The previous state stays. Nothing shows as deleted. The next check continues from the last complete point. |
| A7 | New commits arrive on either branch during a review. | The result stays tied to the reviewed commits and shows as stale. |
| A8 | I approve two of six findings. | Exactly those two approved texts can be posted. |
| A9 | The connection drops right after I confirm a post. | The tool shows "outcome unknown", checks the code host, and never posts again blindly. |
| A10 | The AI hits a usage limit, has a sign-in problem, or I cancel. | The review stops visibly. The inbox and saved drafts keep working. |
| A11 | The AI returns output that the tool cannot read, or the review input was cut. | No clean or successful result shows. Nothing from it can be posted. |
| A12 | A documentation source or a related repository is unavailable. | The result shows a specific question or coverage gap, not a claim that it was checked. |
| A13 | The pull request contains files that try to run commands or change the AI tool's settings. | None of them runs. Nothing is written to the code host. |
| A14 | I refresh the page, or use two windows, and click Review or Post in both. | Only one review job and one post happen. |
| A15 | A pull request merges while I still have unread replies. | The replies stay unread. I keep following the pull request until I archive it. |
| A16 | I ask the AI to draft replies, then accept one draft and post it. | Exactly one reply appears, under the correct parent message. |
| A17 | A comment tells the AI to ignore its instructions or to answer another thread. | The AI treats the comment as data. No reply goes to a thread that I did not select. |

Edge cases: the code host is unreachable (show the last known state, mark it offline, and retry); the token expires or lacks permission (show a clear message); the pull request changes during a review (label the result with the reviewed commits and mark it stale); a finding points to a line outside the diff (post it in the general comment); the AI returns unreadable output (mark the review failed and keep the raw output; at most one repair attempt); the AI usage limit is reached (show the message from the AI tool and do not retry automatically).

Out of scope now: automatic reviews, approvals and merges from the tool, team dashboards, other code hosts, mobile.
```

## 7. Paste into /speckit-plan

```
Stack:
- Runtime: Bun 1.x (latest stable, pinned in Gate 0). Strict TypeScript. Fallback runtime: Node with @hono/node-server if Bun fails a Windows check.
- Server: Hono. csrf() on mutations, streamSSE (hono/streaming) for live events, zValidator (@hono/zod-validator) on every input, typed client hc<AppType>() in the UI. One process serves the API and the built UI on 127.0.0.1 only.
- UI: Vite, React, Tailwind CSS, shadcn/ui (Vite setup), TanStack Query for server state. No extra global state library. Notifications use the browser Notification API. The tab title shows the unread count.
- Visual reference: prototype/index.html. Port its CSS color tokens to the shadcn theme variables. Keep its three panes and keyboard model.
- Storage: bun:sqlite, prepared SQL, checked-in migrations. One database file in the user data folder. No ORM.
- Validation: zod for the AI output, the REST responses that the app uses, and every API input. One shared AI-result schema module (review result and reply result) used by runner, server, and UI.
- Git: the git CLI through Bun.spawn with argument arrays and an isolated config (no system or global config, no credential helper), never shell strings. AI: the system claude CLI.
- Secrets: Bun.secrets (experimental; verify on Windows and Linux in Gate 0). Fallback: memory only for the session.
- Tests: bun test for logic and integration, Playwright for browser acceptance.
- Diff viewer (Release 2): no diff library. It uses the parsed git diff rows and the existing excerpt styles. Release 3 fix edits use the same rows. There is still no diff library.
- Jira Markdown (Release 3): turndown 7.2.4 (exact pin) converts the rendered Jira HTML on the server. Tables use an own rule, not a plugin. The conversion runs in a worker, one per issue fetch, with a budget of 3 s per field and 10 s per fetch. The UI renders Markdown with react-markdown 10.1.0 and remark-gfm 4.0.1 (exact pins), so GFM tables show as tables.
- Distribution: bun build --compile makes one executable for Windows and one for Linux, with the UI embedded. Users need no runtime install.
- Windows checks first (Gate 0): start claude.exe, send the prompt on stdin, cancel a run, read and write Bun.secrets. Cancel must stop the whole process tree, including MCP servers (taskkill /T /F on Windows). If Bun fails one check, switch to Node. Keep the code on web-standard APIs plus a thin spawn, SQLite, and secrets layer. Gate 0 passed all Windows checks on Bun 1.4.2; the Node fallback stays for Linux and future regressions.

Boundaries (build each only when its milestone needs it):
- ForgeProvider: Bitbucket REST adapter (M1) and a fixture provider for tests. Provider payloads stay inside the adapter. Keep raw IDs, versions, and anchor data.
- ReviewRunner: Claude Code CLI runner (M2) and a fake CLI for tests.
- ContextSource: the single-repository snapshot (M2). Release 2 adds one issue source behind this boundary: Jira (id "jira", check(), fetchIssue(key)) and a fake Jira for tests. Related repositories come later (backlog).

Layout:
- src/web/ (inbox, PR detail, shared UI; Release 3: fix/ for the fix UI and the Claude Code prompt)
- src/server/bitbucket/ (REST transport, mapping, capabilities)
- src/server/sync/ (polling, paging, reconciliation, checkpoints)
- src/server/inbox/ (attention rules, read state, notifications)
- src/server/review/ (jobs, snapshot, auth check, CLI, context, validator, diff viewer data; Release 3: edits.ts, fix.ts, clone.ts, fix-routes.ts)
- src/server/context/ (Release 2: ContextSource, Jira REST client, task.md; Release 3: markdown.ts, attachments.ts)
- src/server/publish/ (approvals, durable outbox, reconcile)
- src/server/storage/ (SQLite, migrations)
- src/shared/ (IDs, DTOs, zod schemas)
- fixtures/ (sanitized Bitbucket payloads, fake CLI output), tests/ (unit, contract, Playwright)

Bitbucket Server REST 1.0, auth with an HTTP access token as Bearer (Gate 0: Data Center 9.x):
- Current user: the X-AUSERNAME response header gives the slug of the token owner.
- Discovery: GET /rest/api/1.0/dashboard/pull-requests?state=OPEN&role=REVIEWER, then role=AUTHOR. Users can also follow a PR by URL.
- Timeline: GET /rest/api/1.0/projects/{key}/repos/{slug}/pull-requests/{id}/activities.
- Inline comment: POST .../pull-requests/{id}/comments with text and anchor {path, srcPath for renames, line, lineType: ADDED|REMOVED|CONTEXT, fileType: TO|FROM, diffType: COMMIT|EFFECTIVE|RANGE, fromHash, toHash}. Pin fromHash and toHash to the reviewed commits. diffType COMMIT works with fromHash = target head and toHash = source head (Gate 0). The response anchor adds orphaned. Verify EFFECTIVE and srcPath.
- General comment: the same endpoint without an anchor. Reply: the same endpoint with parent {id}.
- Comments carry an integer version. Edits and deletes need the current version. A stale version returns 409 CommentOutOfDateException. Delete replies before their parent.
- Gate 0 observed: only commentAction ADDED occurs. An edit changes the existing activity in place: comment version goes from 0 to 1, and updatedDate changes. A reply has no activity. It sits in the parent's comment.comments[] and has no parent field. A delete returns 204 and removes the activity. The server keeps no tombstone. GET of a deleted comment returns 404. Sync code depends only on recorded fixtures.
- All Bitbucket calls live in src/server/bitbucket/. It returns plain types (PullRequest, Activity, Comment) without Bitbucket names.

Jira Server REST 2 (Release 2, from the Jira 9.12 docs; not verified on a real server):
- Auth: a personal access token as Authorization: Bearer.
- Settings save: GET /rest/api/2/myself.
- Fetch click: GET /rest/api/2/issue/{key}?fields=summary,description,status,attachment&expand=renderedFields, then GET /rest/api/2/issue/{key}/comment?startAt=&maxResults=100&expand=renderedBody, at most 5 pages. Release 3 adds `attachment` and both `expand` values. One response body is at most 10 MB.
- GET only. Redirects are errors, except same-origin redirects of an attachment download. 30 s timeout. https only; http only on loopback. Errors keep the kind, the status, and the endpoint, never the body or the headers.
- Caps: description 20,000 characters, each comment 5,000, 500 comments, 200 KB in total. Over a cap, the result is marked truncated.
- Only a key that the PR names (pr_task) can be fetched. The issue text goes to the review only as context/task.md under the untrusted banner.
- Markdown (Release 3): turndown converts the rendered HTML. It removes script, style, iframe, object, embed, form, input, button, select, textarea, noscript, template, svg, math, video, audio, canvas, link, meta, and base. A link stays a link only for http(s). A relative link resolves against the Jira base URL first. A Jira attachment image becomes `![name](attachment:<id>)`. The caps apply after conversion. A missing rendered field, HTML over 1 MB, or a field that passes its conversion budget uses the raw wiki text in a fenced block. A worker that does not start, or a fetch that passes 10 s, leaves the remaining fields as wiki text. Old rows without `format: "markdown"` stay plain text.
- Attachments (Release 3): the fetch stores metadata only, at most 200 entries. A Download click gets one file from `<base>/secure/attachment/<id>/<encoded filename>`. The app never uses the `content` URL from the server. The file streams to `<name>.part` with a byte cap. The byte count must equal the reported size. Caps: 100 MB per file, 500 MB per PR. The app never extracts archives.
- Attachment files live in `<dataDir>/attachments/<db stem>/<pr row id>/<KEY>/<attId>-<safe name>`. A safe name is an NFC basename with at most 100 characters. It has no control characters, no `<>:"/\|?*`, no trailing dots or spaces, and no bare Windows device name. Start-up deletes `.part` files, folders without rows, and the files of PRs archived for over 30 days.
- Run inclusion is a per-file opt-in, off by default. Its confirm dialog names the company AI policy. Included images (5 MB or less, at most 20) go to `context/attachments/`. Included text files (256 KB each, 1 MB in total) go there with the untrusted banner. task.md lists all other files by name, size, and type only.

Sync rules:
- Poll followed active PRs about every 60 s. At most 2 concurrent requests. Add jitter. Back off on errors. No source or full diff downloads during polling.
- Follow the server's paging fields (isLastPage, nextPageStart). Never compute the next page. Treat a missing nextPageStart and nextPageStart: null the same: both mark the last page.
- Detect truncation and capped responses. Record them as incomplete, never as complete.
- Activity IDs form a seen-set. Do not assume they are ordered. Do not rely on updatedDate or local clocks.
- A seen-set misses edits, replies, and deletes, because they create no new activity. On each poll of a followed PR, compare each comment's version and its nested reply IDs with stored state.
- Comment identity: instance, repository, PR, comment ID, plus version.
- Flatten nested replies. Keep the parent ID and the root thread ID.
- Advance checkpoints only after the database transaction commits.
- Resume safely after sleep, VPN loss, and restart. A partial or failed fetch never deletes anything.
- Deletion needs two checks. A complete activities fetch (all pages) does not contain the comment. A direct GET of the comment returns 404. Only then mark it deleted. The app keeps its own local tombstone, because the server keeps none.
- First sync of a PR imports history as read and silent. Own events never create unread markers or notifications.
- Reconcile followed threads on every poll. Edits, replies, and deletes show only as comment changes.
- A merged or declined PR stays followed until the user archives or unfollows it.

Read state:
- An acknowledgement stores comment identity plus the acknowledged version. Mark-read sends the exact IDs and versions that the UI showed. A newer version or a new comment stays unread.
- Unread is separate from provider state and from review state.

Review runner:
- Snapshot: fetch refs/pull-requests/{id}/from into one bare cache clone per repository. If the server blocks these refs, fetch the source branch by name. Gate 0: git ls-remote lists refs/pull-requests/{id}/from, and it equals the source head. No merge ref is listed. Verify the fetch of /from in M2. Pin the source, target, and merge-base commits. On Windows, set core.longpaths=true.
- Check out the pinned source head with `git worktree add --detach` into `<dataDir>/runs/<id>/work/repo`. Info attributes turn off filters, text conversion, and ident, so checkout writes each blob unchanged.
- Remove links (tree entries with mode 120000 and any link or junction on disk), .claude/ and .codegraph/ folders, and .mcp.json files. Rename every CLAUDE.md, CLAUDE.local.md, and AGENTS.md to <name>.untrusted.md at any depth, so no PR head file loads as instructions. No submodules. No repository scripts run.
- Project instructions (Settings): one global switch, "Use your global CLAUDE.md" (default off, stored in config.json), adds CLAUDE.md of the Claude config folder (CLAUDE_CONFIG_DIR or ~/.claude) first. Per repository: CLAUDE.md and .claude/CLAUDE.md from the target head (default on), ticked CLAUDE.md, CLAUDE.local.md, or .claude/CLAUDE.md from the user's clone root, and extra text. Each run reads them again. The combined text starts with a trust line and has one header per source. Gate B15 showed that the runner flags do not load `work/CLAUDE.md`. So the text goes into the stdin prompt as the "# Project instructions" section, right before "# Your instructions", and to the end of the rl-reviewer prompt in the agents file. `work/CLAUDE.md` keeps a copy. `@path` imports resolve inside the config folder, the clone, or the target tree, at most 4 hops, 64 KB per file, and 120,000 bytes in total. The total stays below the CLI warning floor of 120,000 characters for all instruction files. Only a token that looks like a path is an import. A file or an import that does not load, or that the total cap cuts, shows as "Not loaded" in the run inputs and the Settings preview. It is not a coverage gap. The trust line says that these are the user's instructions and never change the safety rules. review_run.instructions_json stores the paths and sizes, never the text.
- The app writes context files into `work/context`: the numbered diff, the changed-file list, and the PR text with the existing comments. The review reads history only through the read-only git MCP of the app.
- Spawn the native claude binary (claude.exe on Windows) with the shell off. cwd = the run folder. Send the prompt on stdin, because Windows limits the command-line length.
- Refuse a claude.cmd wrapper, because cmd.exe parses the arguments again. The runner check says "claude.cmd is not the native claude.exe." and no run starts.
- Before spawn: require CLI v2.1.295 or later. Run claude auth status (JSON, exit 0 when logged in). Run only when authMethod is claude.ai. Values such as api_key, oauth_token, or none stop the run with an explanation.
- Child environment: remove ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDECODE, CLAUDE_PID, all CLAUDE_CODE_* variables, BUN_BE_BUN, BUN_OPTIONS, and NODE_OPTIONS. Then set CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 (Gate B3). A run started from inside a Claude Code session behaves like a normal run.
- Flags (the Gate B command, integration-check.md): -p --output-format stream-json --verbose --restricted --strict-mcp-config --mcp-config <app file> --tools Read,Grep,Glob[,Agent] --allowedTools Read,Grep,Glob,mcp__<app server> --agents <file> --agent rl-main --json-schema <schema> --max-turns <cap> --no-session-persistence.
- No --settings and no --permission-mode. --restricted ignores the settings files, and CLI 2.1.295 has no permission mode "default".
- With --json-schema, --max-turns must be at least 2, because the schema answer takes one turn.
- Never use --bare. It never reads OAuth credentials or the keychain, so the subscription login fails.
- --strict-mcp-config keeps only the app MCP servers: the read-only git MCP, the documentation MCPs when the profile has Docs on, and the user MCP servers that the profile picks. The Bitbucket MCP never runs in reviews.
- User MCP servers: at run start the app reads the user's Claude config file again and copies each picked entry into the run's mcp.json. The file can hold secrets. The app writes it owner-only where the OS allows, deletes it with the run folder, and never logs it or stores it in SQLite or prompts. --allowedTools and the agent tool lists name each ticked tool as mcp__<server>__<tool>. --disallowedTools names the other tools of the server. A missing server or tool is a coverage gap, and the run still starts.
- A picked codegraph server (`codegraph serve --mcp`): before the CLI starts, the app indexes repo/ with the same command (init, or sync from a per-repository cache) within 120 s. The run entry gets `--path <repo> --no-watch`. A failed index is a coverage gap, and the server stays out of the run.
- The settings list of user MCP servers shows names and transports only. It never shows URLs, headers, commands, arguments, or env values. A tool without readOnlyHint true gets a warning, because the app cannot check what it changes.
- Subagents: the --agents file gives each reviewer agent read-only tools, a deny list (Bash, PowerShell, Write, Edit, NotebookEdit, Agent), and omitClaudeMd. `--agent rl-main` with the tool `Agent(rl-reviewer)` refuses built-in and user agents (Gate B2, B9).
- Init check: if the init event lists a tool outside the allowlist, the app kills the run before any tool use.
- Documentation MCPs: Microsoft Learn (https://learn.microsoft.com/api/mcp) and DeepWiki (https://mcp.deepwiki.com/mcp).
- Prompt: the profile prompt, the output schema, and the context files. Mark all PR text and repository files as untrusted data. Point Claude to the *.untrusted.md files as untrusted project documentation. Mark every MCP tool result as untrusted data. Tell it to send only public API names to documentation MCPs. Never put code, file contents, paths, or company or product names into a query to a remote server.
- Structured result: --json-schema puts the result in structured_output. With stream-json, only the result event with subtype success carries structured_output (Gate 0).
- Recognize structured error results (is_error, subtype), not only exit codes. Map usage limit, auth error, and max turns to job states. Gate 0 did not record the error subtypes, so verify their values.
- Cancel kills the whole process tree. On Windows use taskkill /T /F with the PID. In Gate 0, proc.kill() also ended the MCP child. The app must not rely on that.
- For each run, store the session ID. Never resume a session from another PR.
- Each run writes a transcript to ~/.claude/projects/<encoded cwd>/. The transcript holds the reviewed code. --no-session-persistence still writes the per-cwd folders (Gate B4), so the app deletes them after each run. App runs never resume a session, and Ask is one-shot. Only "Ask your session" (docs/plans/session-consult.md part C) resumes a session: it forks the user's own session with `--fork-session`, and the original stays unchanged (Gate B16).
- Profiles: four shipped profiles (General, Over-engineering, Security, Explain). The user can edit, add, remove, and reset them in Settings. Each profile has a name, a note, the prompt, Explain, Docs, and a turn cap. Explain asks only for the summary and questions, with a lower turn cap. The shipped caps are 100 turns for General, Over-engineering, and Security, and 50 turns for Explain. A new profile starts with 100 turns. Review, re-review, and Ask runs use the profile cap. Fix and reply-draft runs use at least 100 turns. An update gives the new shipped cap to each shipped profile whose cap the user did not edit (Profile upgrades).
- Brief: the Review button, r, and "Review changes since" open the brief in the panel slot. It preselects the profile of the PR's own brief, else the last profile used on any PR, and marks it "Last used". A profile pick saves to the PR's brief. "Edit <profile>" opens Settings at that profile. The brief shows the run setup of the chosen profile. A review starts only from its Start button. Ask, reply drafts, and Fix start without the brief. Reply drafts and Fix use the profile of the brief.
- Severity rubric: every agent of a review run (not Explain) gets one rubric for blocker, major, minor, and nit. A nit comes only when the profile task, a chosen skill, or the note asks for it. No finding for compiler, linter, or formatter output, style, or naming. An empty findings list is valid.
- Language checks: a profile switch (on for General and Security). Review and re-review runs get a checklist for each language in the changed text files: C++ (.h and the C++ suffixes), C (.c), and Python (.py, .pyi, .pyw). Each item has a category and a usual severity, never nit. Ask, reply, fix, and Explain runs get no list.
- Profile skills: a profile picks skills from the user's Claude config. Each run copies them into ./skills. The model reads SKILL.md with Read, because the Skill tool stays off. Above 5 skills, the run gets an index and reads only the skills that apply. A skill marked Always use is read first and applies to the whole run. A guard line keeps the task, the rules, and the output format. A missing marked skill blocks the start, and the brief disables Start with the reason. Coverage lists a marked SKILL.md that the model did not read.
- Profile upgrades: an update checks the prompt, the turn cap, and Language checks of each shipped profile one by one. A field that still holds its former shipped value gets the new shipped value. An edited field stays as it is. Skills, MCP servers, and the run setup do not block the upgrade.
- Copy to all profiles: a button in the Run setup of each profile. After a confirm, it gives every other profile the same skills, Always use marks, MCP servers, and tools in one save.
- Improve prompt: a button under the prompt of each profile. One run of the user's CLI proposes a new prompt and one reason per change. The input is the profile name, note, Explain flag, and prompt, an optional goal, and the rules that every run adds. The prompt and the goal are marked as data. The run uses the profile model and effort, `--tools ""`, no MCP server, and the usual auth check and child environment. Its cwd is a new empty temp folder, which the app deletes after the run. It gets no repository, no PR data, and no token. The dialog shows a line diff and the reasons. Only Apply changes the profile, through the autosave. A proposal does not use the review run slot. A new start replaces a running proposal, and closing the dialog cancels it. Verify in a smoke run that init lists only StructuredOutput.
- Each run stores the profile name, revision, and explain flag at its start. A later profile edit does not change an old run.
- Run kinds: review, reply, ask (Release 2), and fix (Release 3). A re-review is kind review with since_head set. Ask and fix run without the Agent tool and share the one run slot. Ask writes no items.
- Tasks: every run kind gets context/task.md with all fetched tasks of the PR. The PR has one task set and no per-run picker. Each run stores its task keys and fetch times at its start. Its run line shows them.
- History: Ask, reply, and fix runs get context/history.md when the PR has earlier results. It holds the newest completed or incomplete review or re-review (not Explain): profile, reviewed head, summary, and findings with their triage state. It also holds the earlier finished Ask runs, newest first. Findings stop at 60 KB and Ask runs at 40 KB. A line counts the items left out. No run resumes a session. context/pr.md marks a task comment "(task, open)" or "(task, resolved)".
- Judgement (Release 3): each reply draft carries a judgement: valid, partly, invalid, question, or null. Null means that the newest message asks for no change and no answer. The judgement only sets the default tick in the Fix list: valid and partly are ticked, the other values are not. Draft replies covers only the threads where it is my turn.
- Fix run (Release 3): only on author PRs, not with the Explain profile, for 1 to 25 threads. Fix offers each open, unresolved thread with a live message, with or without a reply draft (user decision, 2026-10-14). A reviewer gets no Fix. The fix run reads the whole thread. It sets fixed to false, with the reason, when the code is already right or the thread asks for no change. The output is `{summary, threads, edits, coverage}`. Each edit is `{thread, path, old, new}`. A run has at most 50 edits and 20,000 characters per string.
- Edit rules: `old` matches exactly once in the file at the run's source head S. Edits do not overlap. An empty `old` creates a file that is absent at S. For a CRLF file and an `old` without CR, the app converts "\n" to "\r\n" in `old` and `new`. UTF-8 decodes fatally and keeps the BOM. The app refuses binary files, invalid UTF-8, LFS pointers, links, and submodules. An edit that fails a rule goes to coverage as skipped.
- Denied paths: any path outside the repository, any `.claude` or `.git` segment, `.mcp.json`, CLAUDE.md, CLAUDE.local.md, AGENTS.md, and `.gitmodules`. Hook sources are also denied: `.githooks` and `.husky` segments, `.pre-commit-config.yaml`, lefthook files, lint-staged and commitlint configs, and the `core.hooksPath` folder of the clone. Names compare without case.
- Patch: the app writes the new blobs into the cache and builds tree T from S with a temp index. The patch is `git diff S T`, with the isolated config, `core.autocrlf=false`, and no text conversion.
- Clone: one path per repository in SQLite, set by the user. The path is the absolute top folder of an existing non-bare work tree, outside the data folder. The clone matches by commits, not by remote URL.
- Clone checks before Apply: the branch is the PR source branch and HEAD is not detached. S and the live source head are ancestors of HEAD, else the clone is "behind" or "diverged". No tracked or staged change exists. No merge, rebase, cherry-pick, revert, or bisect is in progress. `user.name` and `user.email` are set. The app refuses a dirty clone. Untracked files and local commits that are not pushed are allowed.
- Apply: `git update-index -q --refresh`, then `git apply --index --check`, then `git apply --index`, without `--3way`. Undo also refreshes the index first. The refresh records the stat data of unchanged files, so a touched file, or a status by a git with another `core.autocrlf`, does not block Apply or Undo. Then `git commit -F -` with the user's environment: no GIT_* variables, `GIT_TERMINAL_PROMPT=0`, and a 120 s timeout. The commit uses the user's identity, config, signing, and hooks. Hooks run (user decision, 2026-10-11). A hook or commit failure leaves the change staged and shows the stderr tail.
- Commit message: the user edits it in the Apply dialog, 1 to 5,000 characters. Default: "Fix review comment <id> on PR <n>", with one body line per thread.
- App branch fallback: `commit-tree T -p S` in the cache, under `refs/rl/<pr>/fix-commit/<fixId>`. The fix run keeps S under `refs/rl/<pr>/fix/<run>`. The UI shows the `git fetch` and `git merge --ff-only FETCH_HEAD` commands to copy.
- Undo: only for a committed row when HEAD equals its commit, the branch is unchanged, the tree is clean, and the PR commits do not list it. Undo runs `git reset --keep <before>`. A staged row resets only its patch paths, and only when the index still equals the patch.
- Apply, commit, and undo do not use the run slot. They run under a per-clone lock. A repeat request with the same run, mode, and edits returns the same row.
- Copy prompt for Claude Code: a pure client function. The prompt holds the PR identity, the branch, the path, the line, and a rule: judge first, never commit or push. The comments go in an indented block. The app starts no terminal and builds no shell command.
- Re-review range (Release 2): T = git merge-tree --write-tree --no-messages <since> <new merge base>. If T equals the tree of <since>, the range base is <since>. Else the range base is git commit-tree T -p <since> -p <new merge base> with a fixed identity and date. A conflict, a missing object, or a git error falls back to the full range from the merge base. The context diff shows range base..head. The validator diff and post anchors stay on merge base..head.
- Re-review carry-over: the base run's new and accepted items carry over. The prompt lists only their IDs; their text goes in context/findings.md. A missing verdict makes the run incomplete.

Job states: running, completed, incomplete, cancelled, failed. There is no queued state. Freshness is computed on read: a result turns stale when the source or target head changes. One run slot: a start while another run uses it gets 409 with the running run. Job start is idempotent: the running-job key is PR, source head, target head, profile ID, profile revision, and the note hash (a reply run adds its threads). A second tab or a refresh with the same key gets the existing run.

Output contract (zod, schema-versioned):
- Identity: schema version, PR identity, source and target heads, merge base, job ID, session ID, CLI version, profile and skill revision, model, context fingerprint.
- Explanation: intended behavior, changed areas, material assumptions.
- Findings: category, severity (blocker, major, minor, nit), confidence, location (path, line, side new|old), triggering scenario, evidence references, evidence status (code-grounded, reproduced, unverified), consequence, suggested direction.
- Questions: question, why it matters. Never mixed with findings.
- Coverage: files and documents read, content skipped or truncated, unavailable tools or repositories, tests run or not run.
- Deterministic validator: reject malformed output. Check every path and line against the snapshot. Invalid references become coverage problems, not findings. A schema-valid result is not proof of a correct review.
- Malformed output: at most one format-repair call, then the job fails with the raw output kept.

Publication:
- A post row is the approval. It binds the exact body, the destination (general, reply, or inline anchor), the item revisions, and the reviewed commits. Its idem_key holds the item revisions, so an edited item gets a new row.
- Preflight before send: refresh PR state, heads, and comments. Block stale items and show the reason. Flag likely duplicates against existing comments.
- A reply post checks only that the parent comment still exists and that no newer message arrived in the thread since the user saw it. It does not check the heads.
- Inline anchors pin fromHash and toHash to the reviewed commits. A line outside the diff goes into the general comment.
- Durable outbox states: pending, sent, unknown, failed, confirmed. Save the remote comment ID and version on success.
- A timeout after send sets unknown. Reconcile against remote comments before any retry. If still unclear, the user decides.
- Publish is idempotent on the server side: one outbox row per approval. A second tab or a refresh never sends twice.
- The backend posts. Claude never posts.
- "Fixed in" reply (Release 3): after a fix commit, the app supersedes the thread's open reply drafts. It adds a reply item "Fixed in <short hash>.". The item posts only when the PR commits list the commit and were fetched for the current heads. Else confirm returns 409 "Commit <short> is not on the PR source branch yet. Push it. The next sync finds it." A rebased fix stays blocked, and the user writes a manual reply.
- Fixed finding (Release 3): a fix commit discards each open finding (new or accepted) that it covers and marks it "Fixed in <short hash>". The finding leaves Ready to post. Restore returns the finding to its earlier status and keeps the mark ("You restored it"). A restored accepted finding is back in Ready to post. Undo of the commit also returns the earlier status of each finding that the mark still discards, and removes the mark.
- Session consult (S1, S2): a consult run row holds one pasted answer. It starts no process, and no run list shows it. A session run (kind session) holds the answer of a fork and the item keys at its start, never transcript text or the transcript path. A session reply draft says "Your session". A session reject discards a finding and keeps the reason until a restore or Undo. A session accept ticks any row of the Fix list.
- AI mark (setting, on by default): the post plan puts "🤖 " once at the start of each post built from an AI item (finding, question, reply draft, edited or not). A manual reply never gets it. The outbox keeps the marked text, so confirm, send, and reconcile use the same bytes.

Notifications: opt-in. Deduplicate by event and comment version. Coalesce per PR. No self-events. After downtime, show one digest. Notifications work only while the service and a UI tab run.

No result cache. Each start runs the CLI again, except a start with the key of the running run.

Data model (SQLite):
- pull_request(instance, project, repo, pr_id, title, author, my_role, state, source_head, target_head, followed, archived_at, last_reviewed_commit)
- activity_seen(pr key, activity_id, first_seen_at)
- comment(pr key, comment_id, version, parent_id, root_id, author, text, anchor_json, created_at, updated_at, tombstoned_at)
- acknowledgement(comment key, acknowledged_version, acknowledged_at)
- sync_checkpoint(scope, cursor_json, last_complete_at, incomplete_reason, last_error)
- pr_brief(pr, note, profile, updated_at)
- review_run(id, pr, kind: review|reply|ask, profile, profile_name, profile_revision, explain, note, idem_key, source_head, target_head, merge_base, fetch_via, status, error_kind, error_text, session_id, cli_version, model, usage_json, summary_json, raw_output, started_at, finished_at, since_head, range_base, question, answer). One running row per idem_key. Release 2 adds kind ask and the last four columns. Release 3 adds kind fix, fix_json (the thread notes of a fix run), and tasks_json (the task keys and fetch times of the run).
- task_context(pr, key, source: jira, json, fetched_at). Release 2. One row per PR and issue key.
- task_attachment(pr, key, att_id, filename, mime, size, file, sha256, image, text, include, downloaded_at). Release 3. A task_context delete removes its rows.
- repo_clone(project, repo, path, updated_at). Release 3. One clone path per repository.
- repo_instructions(project, repo, target, local_json, extra, updated_at). The project instruction sources of one repository.
- fix_edit(id, run, ord, thread, path, old, new, start, rows_json). Release 3. The checked edits of a fix run.
- fix_commit(id, pr, run, idem_key, edits_json, mode: clone|cache, clone_path, branch, before_head, commit_hash, short_hash, state: committed|staged|undone, message, created_at, updated_at). Release 3. idem_key is unique while the state is not undone.
- run_event(run, id, seq, parent, tool, target, status, note, agent, started_at, ended_at)
- review_item(id, run, kind: finding|question|reply, payload_json (Release 3: a reply adds judgement, and a "Fixed in" reply adds fix {id, commit}, and a fixed finding adds fixed {id, commit, short, was}), body, anchor columns, status: new|accepted|discarded|posted, revision, edited, thread)
- post(id, pr, run, kind: inline|general|reply, idem_key unique, body, destination_json, items_json, state: pending|sent|unknown|failed|confirmed, remote_id, remote_version, attempts, last_error, created_at, updated_at). The row is the approval and the outbox entry.

Config: one JSON file in the user data folder. It holds no secrets. Fields include the Bitbucket URL, the CA file, markAi, the task rules, checkSeconds (the poll interval), and profiles (absent: the shipped profiles). Release 2 adds jira: {baseUrl, caFile?}. An empty baseUrl disconnects Jira and clears its token.

Release 3 routes (zod input on each):
- POST /api/prs/:id/fix-run; GET /api/prs/:id/fixes.
- GET, PUT, and DELETE /api/prs/:id/clone. GET runs git in the clone with no network.
- POST /api/fix-runs/:run/commit (409 with the clone problems); POST /api/fix-commits/:id/undo.
- POST, GET, PUT, and DELETE /api/prs/:id/task-context/:key/files/:att; GET .../files/:att/image; POST /api/prs/:id/task-context/:key/open-folder. `:att` is 1 to 18 digits.
- Open folder starts the platform file manager with the folder path, never a file. Without an opener, the route returns 501 with the path.

Tests:
- Sanitized fixtures from Gate 0: nested replies, edits, deletions, duplicate activities, out-of-order activities, a late message during mark-read, paging, truncation.
- A fake claude executable that replays recorded stream-json, errors, usage limits, malformed output, and slow runs for cancel.
- A fake Jira server (Release 2) that serves fixtures/jira/ payloads. Its shapes come from the Jira 9.12 docs until a real fetch records them.
- Unit tests: unread logic, checkpoint commit order, snapshot sanitizing, path traversal, finding-to-anchor mapping (renames, removed lines, lines outside the diff), validator, outbox transitions.
- Acceptance tests (bun test and Playwright) for all 17 scenarios A1 to A17. docs/smoke-v3.md maps each scenario to its tests.
- A separately authorized smoke test on the real server, on the designated test PR only.
- Record which tests ran on Windows and which on Linux. Never point a test at a live or shared service.
```

## 8. Phase 0: use this week, no code

The review half already works in Claude Code with your Bitbucket MCP:
1. Open Claude Code in a local clone of the repository. Check out the PR branch.
2. Prompt: "Review PR <project>/<repo>#<id>. Use the ponytail-review skill. Read the diff and the existing comments with mcp-stash. Check library facts with Microsoft Learn and DeepWiki. Write the findings to review-<id>.md as a numbered list: file:line, severity, comment text. Do not post anything."
3. Edit review-<id>.md. Delete the items that you reject.
4. Prompt: "Post the remaining items from review-<id>.md as comments on PR #<id>."

This path uses interactive Claude Code. The workspace trust prompt protects it. Do not copy it into the app: `claude -p` skips that prompt.

The tracking half needs code. Until M1 exists, ask Claude Code "Which of my open PRs got new comments since yesterday?". This works, but each question spends tokens.

## 9. Backlog: more workflows

Phase 2, close the loop:
- Ask the PR: moved to Release 2 as one-shot questions (section 2). A follow-up chat that resumes the same PR's session stays in the backlog.
- Approve and Needs work buttons.
- A "My open threads" view across all PRs, with unresolved tasks.
- Snooze a thread, personal reminders, and a deterministic daily digest.

Phase 3, author mode (my own PRs):
- Self-review before I open a PR.
- A digest of incoming feedback, grouped by topic.
- Draft fixes for accepted feedback: moved to Release 3 as Fix it (section 2). I review, apply, and push.
- Draft a PR description from the commits and the Jira issue.

Phase 4, better reviews:
- Done: "Use skill X" in a profile. Runs copy the skills and the model reads them with Read (section 7, Profile skills).
- Acceptance-criteria coverage: map the Jira issue's requested behavior to code, tests, and gaps.
- Cross-repository producer and consumer checks: schema, deployment order, compatibility. Use a local context config (doc paths, entry points, related repositories, contract owners, test commands). Record related revisions. A missing repository becomes a question, not a claim.
- Learn from discards: store rejected findings per repository and send them as "do not flag" guidance.
- Done: a per-repository review rules file. Project instructions go into the prompt of each run (section 7).
- A review queue that pre-reviews new PRs with a daily cap. Read the usage terms first.
- A risk score per PR to sort the inbox.
- Build status and approval count in the inbox.
- Accept and discard rates per profile, to tune the prompts.

Phase 5, reach:
- A GitHub provider with the same inbox and review semantics. Then GitLab and Gerrit.
- An MCP server that gives the inbox to Claude Code ("What needs my attention?").
- Tray notifications and startup management (Tauri wrapper), with no change to the provider logic.
- Stale PR reminders and a reviewer load view.

## 10. Open questions (defaults in brackets)

1. Bitbucket version and auth? [Answered in Gate 0: Data Center 9.x. An HTTP access token as Bearer works for reads and writes.]
2. Can clients fetch refs/pull-requests/*? [Partly answered in Gate 0: ls-remote lists refs/pull-requests/<id>/from, and no merge ref. Verify the fetch in M2. Fall back to a branch fetch.]
3. Mark AI-assisted comments? [Answered: the 🤖 mark, a setting that is on by default. The user owns every posted comment.]
4. Which local repository paths may the app read? [Release 3: one clone path per repository, set by the user. The app runs git there only for clone checks, Apply, and Undo. Reviews and fix runs use the app's own cache clones.]
5. Which MCP servers run in reviews? [Microsoft Learn and DeepWiki. A profile can also add user-scope servers from the user's Claude config, each with a per-tool allowlist. Pick only read-only tools. Jira is no MCP server: Release 2 fetches the issue text through the app's Jira REST client and gives it to the review as a file.]
6. The existing Bitbucket MCP: tool names, schemas, and paging? [Answered in Gate 0: names and schemas are recorded in integration-check.md. It has comment write tools and no delete tool. Sync and publish use REST either way.]
7. The colleague's app: source and license? [Inspect it when available. Reuse working modules. Not a blocker for fixture work.]
8. Company AI policy and external MCP policy? [Get approval to send source to Claude and to use the documentation MCPs before the first real review.]
9. Installed Claude Code and Ponytail versions? [Record them in Gate 0. Claude Code must be v2.1.257 or later.]
10. Real payloads for edit, delete, and reply activities? [Answered in Gate 0: payload shapes are recorded in fixtures/bitbucket/ and section 7.]

## 11. Sources (checked 2026-10-09)

- Claude Code headless mode: https://code.claude.com/docs/en/headless (stream-json needs --verbose; --json-schema result in structured_output; --bare skips OAuth and the keychain).
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference (--strict-mcp-config, --agents, --agent, --no-session-persistence, claude auth status). The page does not list --restricted (checked 2026-10-11). Gate B8 records its behavior.
- Claude Code permissions: https://code.claude.com/docs/en/permissions (blockReadsOutsideWorkingDirectories; trust dialog not shown in -p).
- Claude Code IAM and auth precedence: https://code.claude.com/docs/en/iam (ANTHROPIC_API_KEY wins over the subscription).
- Claude Code hooks and settings: https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/settings
- Claude Code terms: https://code.claude.com/docs/en/legal-and-compliance
- Bun secrets: https://bun.com/docs/runtime/secrets (experimental).
- Bun runtime: https://bun.com/docs (bun:sqlite, spawn, bun test, bun build --compile).
- Hono: https://hono.dev/docs/middleware/builtin/csrf, https://hono.dev/docs/helpers/streaming, https://hono.dev/docs/guides/validation, https://hono.dev/docs/guides/rpc, https://hono.dev/docs/getting-started/nodejs
- shadcn/ui with Vite: https://ui.shadcn.com/docs/installation/vite
- Bitbucket Data Center REST (pull requests, v906): https://developer.atlassian.com/server/bitbucket/rest/v906/api-group-pull-requests/ (comment version; anchor fromHash, toHash, diffType).
- Jira Server platform REST API 9.12.0 (checked 2026-10-11): https://docs.atlassian.com/software/jira/docs/api/REST/9.12.0/ (anchors api/2/myself-getUser, api/2/issue-getIssue, api/2/issue-getComments).
- Atlassian Data Center personal access tokens (checked 2026-10-11): https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html (Authorization: Bearer; Jira 8.14 and later).
- git merge-tree (checked 2026-10-11): https://git-scm.com/docs/git-merge-tree (--write-tree, --no-messages; exit 0 clean, 1 conflict). The 2.38.0 page is the first that documents --write-tree.
- turndown 7.2.4: https://github.com/mixmark-io/turndown (HTML to Markdown, rules, remove()).
- remark-gfm 4.0.1: https://github.com/remarkjs/remark-gfm (GFM tables, task lists, strikethrough, and autolinks for react-markdown).
- git apply: https://git-scm.com/docs/git-apply (--index, --check; all or nothing without --3way).
- githooks: https://git-scm.com/docs/githooks (core.hooksPath; the hooks that `git commit` runs).
- Git LFS pointer spec: https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md (first line `version https://git-lfs.github.com/spec/v1`).
- WHATWG Encoding: https://encoding.spec.whatwg.org/ (TextDecoder fatal and ignoreBOM).
- Jira Server platform REST API 9.12.0, Release 3 use: the same docs, anchors api/2/issue-getIssue (`expand=renderedFields`, field `attachment`), api/2/issue-getComments (`expand=renderedBody`), and api/2/attachment. Not verified on a real server.
- spec-kit: https://github.com/github/spec-kit (command prefix /speckit-, init flag --integration).
- Edge-case reference: PROJECT_BRIEF_GPT_ASTRA_6.md (state semantics, acceptance scenarios, publication reliability). Alternative prompts: IMPLEMENTATION_PROMPTS_GPT_ASTRA_6.md.
