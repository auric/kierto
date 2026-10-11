# Review Loop: Project Brief

Status: draft 2, 2026-10-09. Scope: a production-quality personal tool for Bitbucket Server pull request (PR) review with Claude Code. Edge-case reference: PROJECT_BRIEF_GPT_ASTRA_6.md.

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
- No team features, no hosted server, no multi-user mode, no desktop shell.
- No Bitbucket Cloud, GitHub, or GitLab. Code-host access stays behind one boundary (ForgeProvider).

Build order (each milestone is useful alone):
- M0. Gate 0: integration check on a designated test PR. Record the Bitbucket version, auth route, current user ID, paging, nested replies, real edit, delete, and reply payloads, and inline anchors. Record Claude Code and Ponytail versions, the `claude auth status` route, the `structured_output` shape with stream-json, and the Windows checks (section 7). Missing production access does not block fixture work.
- M1. Inbox, sync, read state, notifications, and minimal settings: URL and token (US1 to US4, part of US9).
- M2. Review runner with the snapshot and all safety checks, live log, and Explain (US5, US6).
- M3. Triage, publish outbox, replies, and AI reply drafts (US7, US8).
- M4. Full settings and profiles (US9).

Release 2: read-only diff viewer, changes since my review, targeted re-review of earlier findings.

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
- Compare the PR with its Jira issue through a read-only Jira MCP, when one is configured.

### 3.4 Polling, not webhooks

Bitbucket webhooks cannot reach a laptop on localhost. The app polls the REST API. Polling costs no LLM tokens.

### 3.5 Review safety

- `claude -p` never shows the workspace trust dialog. In an untrusted folder it still uses project hooks, the project `env` block, and `apiKeyHelper`. So never run Claude Code in a raw PR checkout.
- The app exports the pinned PR head with `git archive` into an app-owned temp folder. It removes `.claude/`, `.mcp.json`, and symlinks. It renames CLAUDE.md files.
- With `--setting-sources user`, project settings, hooks, `.mcp.json`, CLAUDE.md, and skills do not load (Gate 0, CLI 2.1.295). The snapshot rename and remove steps stay as defense in depth.
- `--setting-sources user` still loads the user's own CLAUDE.md, agents, plugins, hooks, and MCP servers, including claude.ai connectors. Only `--strict-mcp-config` removes the MCP servers.
- Never use `--bare`. It never reads OAuth credentials or the keychain, so the subscription login fails with it.
- `ANTHROPIC_API_KEY` in the environment wins over the subscription. The app removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the child environment.
- Before each run, the app calls `claude auth status`. It runs only when `authMethod` is `claude.ai`. Otherwise it stops and explains. Log only `authMethod` from `claude auth status`, because its output also holds the email and organization.
- `permissions.blockReadsOutsideWorkingDirectories: true` (Claude Code v2.1.257 or later) keeps file tools inside the snapshot. The app refuses an older CLI.
- A separate folder is not an OS sandbox. The review gets read-only tools only, no shell, and no code-host token.

### 3.6 Local server safety

- Listen on 127.0.0.1 only. A random port is not authentication.
- Check the Host and Origin headers on every request. Use Hono `csrf()` on mutations. Never enable wildcard CORS.
- Every mutation needs a per-start session token. The server puts it into the page it serves.
- Outbound calls go only to the configured Bitbucket instance. Check redirects against it.
- Support a corporate CA file. Never disable TLS verification.
- The Bitbucket token lives in the OS credential store through `Bun.secrets` (experimental; verify in Gate 0). Fallback: memory only, asked again after a restart.
- The token never goes into SQLite, localStorage, URLs, logs, or prompts. Logs are redacted. No telemetry.
- Render comment Markdown safely. Never fetch external images from untrusted comments automatically.

### 3.7 Stack and scope choices

| Choice | Reason |
|---|---|
| Hono on Bun | It runs on Node through `@hono/node-server` if Bun fails Gate 0. It has `csrf()`, `streamSSE`, `zValidator`, and the typed client `hc<AppType>()`. |
| Vite for the UI | shadcn/ui documents a Vite setup. Bun HTML imports are not needed. |
| bun:sqlite | Built in. Prepared SQL and checked-in migrations, no ORM. |
| Inline comments in Release 1 | Commit-pinned anchors, tests for renames, removed lines, and lines outside the diff, and a general-comment fallback. |
| Three panes (prototype) | Sidebar, list, detail. The process log is a tab, out of the main reading path. |

## 4. Architecture

```
Browser UI (127.0.0.1, React + TanStack Query)
   |  HTTP JSON (typed client) + Server-Sent Events
Local server (Bun + Hono, TypeScript)
   +-- bitbucket/  ForgeProvider: REST client --> Bitbucket Server (read, post)
   +-- sync/       poll, page, reconcile, checkpoints
   +-- inbox/      attention rules, read state, notifications
   +-- review/     jobs, snapshot, auth check, CLI runner, validator
   |     +-- git cache (bare clone) --git archive--> snapshot folder (temp)
   |     +-- spawn: claude -p (cwd = snapshot, scrubbed env)
   |                 +-- MCP: Microsoft Learn, DeepWiki
   |                 +-- MCP (optional, read-only): Jira, CodeGraph
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
4. Zero-token tracking: polling, unread state, notifications, and publication never call an LLM. Only reviews, explanations, and drafts use tokens.
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

User experience: the tool looks clean and modern, like a good email client. It has three panes, as in the prototype. The sidebar holds the views: Needs you, Reviewing, My PRs, Review runs, Ready to post. It also holds the repositories with unread counts, the check status, the theme switch, and settings. The list pane shows the view name, the count, a repository chip, and a filter field. The detail pane shows the title, a Review button with a profile menu, Open in Bitbucket, and three tabs: Activity, Review, Run log. The Review tab holds the item list and the detail of the selected item. On a narrow screen, one pane shows at a time. Keyboard: j and k move in the focused pane; Enter or → goes into the detail pane; Esc or ← goes back; 1, 2, 3 select Activity, Review, Run log; r starts a review; a, d, e accept, discard, or edit the selected item; p posts the accepted items after confirmation; n jumps to the next unread message; / filters the list; ? shows all keys. Each message has a copy button that copies its raw Markdown. Status is never shown by color alone; an icon or text always goes with it. The scroll position stays when new events arrive. Focus is always visible. The tool supports light and dark themes.

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

Out of scope now: a diff viewer, automatic reviews, approvals and merges from the tool, team dashboards, other code hosts, mobile.
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
- Git: simple-git with argument arrays, never shell strings. AI: the system claude CLI.
- Secrets: Bun.secrets (experimental; verify on Windows and Linux in Gate 0). Fallback: memory only for the session.
- Tests: bun test for logic and integration, Playwright for browser acceptance.
- Later: @pierre/diffs only when the diff viewer is built (Release 2).
- Distribution: bun build --compile makes one executable per OS with the UI embedded. Users need no runtime install.
- Windows checks first (Gate 0): start claude.exe, send the prompt on stdin, cancel a run, read and write Bun.secrets. Cancel must stop the whole process tree, including MCP servers (taskkill /T /F on Windows). If Bun fails one check, switch to Node. Keep the code on web-standard APIs plus a thin spawn, SQLite, and secrets layer. Gate 0 passed all Windows checks on Bun 1.4.2; the Node fallback stays for Linux and future regressions.

Boundaries (build each only when its milestone needs it):
- ForgeProvider: Bitbucket REST adapter (M1) and a fixture provider for tests. Provider payloads stay inside the adapter. Keep raw IDs, versions, and anchor data.
- ReviewRunner: Claude Code CLI runner (M2) and a fake CLI for tests.
- ContextSource: the single-repository snapshot (M2). Related repositories come later (backlog).

Layout:
- src/web/ (inbox, PR detail, shared UI)
- src/server/bitbucket/ (REST transport, mapping, capabilities)
- src/server/sync/ (polling, paging, reconciliation, checkpoints)
- src/server/inbox/ (attention rules, read state, notifications)
- src/server/review/ (jobs, snapshot, auth check, CLI, context, validator)
- src/server/publish/ (approvals, durable outbox, reconcile)
- src/server/storage/ (SQLite, migrations)
- src/shared/ (IDs, DTOs, zod schemas)
- fixtures/ (sanitized Bitbucket payloads, fake CLI output), tests/ (unit, contract, Playwright)

Bitbucket Server REST 1.0, auth with an HTTP access token as Bearer (Gate 0: Data Center 9.4.26):
- Current user: the X-AUSERNAME response header gives the slug of the token owner.
- Discovery: GET /rest/api/1.0/dashboard/pull-requests?state=OPEN&role=REVIEWER, then role=AUTHOR. Users can also follow a PR by URL.
- Timeline: GET /rest/api/1.0/projects/{key}/repos/{slug}/pull-requests/{id}/activities.
- Inline comment: POST .../pull-requests/{id}/comments with text and anchor {path, srcPath for renames, line, lineType: ADDED|REMOVED|CONTEXT, fileType: TO|FROM, diffType: COMMIT|EFFECTIVE|RANGE, fromHash, toHash}. Pin fromHash and toHash to the reviewed commits. diffType COMMIT works with fromHash = target head and toHash = source head (Gate 0). The response anchor adds orphaned. Verify EFFECTIVE and srcPath.
- General comment: the same endpoint without an anchor. Reply: the same endpoint with parent {id}.
- Comments carry an integer version. Edits and deletes need the current version. A stale version returns 409 CommentOutOfDateException. Delete replies before their parent.
- Gate 0 observed: only commentAction ADDED occurs. An edit changes the existing activity in place: comment version goes from 0 to 1, and updatedDate changes. A reply has no activity. It sits in the parent's comment.comments[] and has no parent field. A delete returns 204 and removes the activity. The server keeps no tombstone. GET of a deleted comment returns 404. Sync code depends only on recorded fixtures.
- All Bitbucket calls live in src/server/bitbucket/. It returns plain types (PullRequest, Activity, Comment) without Bitbucket names.

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
- Export with git archive of the pinned head into an app-owned temp folder. Put "* -export-ignore -export-subst" into the cache's info/attributes, so the PR cannot hide or rewrite files (verify in Gate 0).
- Extraction rejects absolute paths, ".." parts, and links. Reject link entries (tar typeflag 1 for hard links, 2 for symlinks) during extraction, not after. On Windows, use the system tar.exe or extract in-process. Do not use Git for Windows GNU tar, because it fails on drive-letter paths. Remove .claude/ folders, .mcp.json files, and symlinks. Rename every CLAUDE.md and CLAUDE.local.md to <name>.untrusted.md. No submodules. No repository scripts run.
- The app writes context files beside the snapshot: the diff, the changed-file list, the PR text, and the existing comments. The snapshot has no .git folder, so the review uses no git commands.
- Spawn the native claude binary (claude.exe on Windows) with the shell off. Do not spawn claude.cmd, because a .cmd file needs a shell. If only claude.cmd exists, run the CLI JavaScript entry file with bun. cwd = the run folder. Send the prompt on stdin, because Windows limits the command-line length.
- Before spawn: require CLI v2.1.257 or later. Run claude auth status (JSON, exit 0 when logged in). Run only when authMethod is claude.ai. Values such as api_key, oauth_token, or none stop the run with an explanation.
- Child environment: remove ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDECODE, CLAUDE_PID, and all CLAUDE_CODE_* variables. Then a run started from inside a Claude Code session behaves like a normal run.
- Flags: -p --output-format stream-json --verbose --json-schema <findings schema> --setting-sources user --strict-mcp-config --mcp-config <app review-mcp.json> --settings <app settings JSON> --permission-mode default --tools <read-only built-ins: Read, Grep, Glob> --allowedTools <read-only list> --disallowedTools <deny list> --max-turns <cap>.
- With --json-schema, --max-turns must be at least 2, because the schema answer takes one turn.
- Never use --bare. It never reads OAuth credentials or the keychain, so the subscription login fails.
- --settings JSON sets permissions.blockReadsOutsideWorkingDirectories: true.
- With --setting-sources user, project settings, hooks, .mcp.json, CLAUDE.md, and skills do not load (Gate 0, CLI 2.1.295). The snapshot rename and remove steps stay as defense in depth.
- Read-only list: Read, Grep, Glob, and the read-only MCP tools from review-mcp.json.
- Deny list (also when user settings allow more): Bash, Edit, Write, NotebookEdit, WebFetch, WebSearch, Agent, and every code-host write tool. Name the Bitbucket MCP write tools create_pull_request_comment and edit_pull_request_comment explicitly. --strict-mcp-config already removes that MCP, so this is defense in depth. --allowedTools does not limit the tool set. Gate 0 saw the model start a subagent through the Agent tool.
- review-mcp.json ships Microsoft Learn (https://learn.microsoft.com/api/mcp) and DeepWiki (https://mcp.deepwiki.com/mcp). Users can add Jira and CodeGraph only with a read-only tool list. If read-only cannot be enforced, leave that MCP out and give the data as context files.
- Prompt: the profile prompt, the output schema, and the context files. Mark all PR text and repository files as untrusted data. Point Claude to the *.untrusted.md files as untrusted project documentation. Tell it to send only public API names to documentation MCPs.
- Structured result: --json-schema puts the result in structured_output. With stream-json, only the result event with subtype success carries structured_output (Gate 0).
- Recognize structured error results (is_error, subtype), not only exit codes. Map usage limit, auth error, and max turns to job states. Gate 0 did not record the error subtypes, so verify their values.
- Cancel kills the whole process tree. On Windows use taskkill /T /F with the PID. In Gate 0, proc.kill() also ended the MCP child. The app must not rely on that.
- For each run, store the session ID. Never resume a session from another PR.
- Each run writes a transcript to ~/.claude/projects/<encoded cwd>/. The transcript holds the reviewed code. The app deletes that folder after each run, unless the user keeps the session for follow-up questions. --no-session-persistence exists, but Gate 0 did not test it, and it blocks --resume. Decide in M2.
- Shipped profiles hold the full prompt text in the config. Explain asks only for the summary and questions, with a lower turn cap. A profile can say "use skill X" for users with that skill; Gate 0 confirmed that user skills load with --setting-sources user.
- Record the Ponytail skill version when a profile uses it.

Job states: queued, running, completed, incomplete, cancelled, failed. Freshness: fresh or stale. A result turns stale when the source or target head changes. One active job by default. Job start is idempotent: the key is PR, source head, target head, and profile. A second tab or a refresh gets the existing job.

Output contract (zod, schema-versioned):
- Identity: schema version, PR identity, source and target heads, merge base, job ID, session ID, CLI version, profile and skill revision, model, context fingerprint.
- Explanation: intended behavior, changed areas, material assumptions.
- Findings: category, severity (blocker, major, minor, nit), confidence, location (path, line, side new|old), triggering scenario, evidence references, evidence status (code-grounded, reproduced, unverified), consequence, suggested direction.
- Questions: question, why it matters. Never mixed with findings.
- Coverage: files and documents read, content skipped or truncated, unavailable tools or repositories, tests run or not run.
- Deterministic validator: reject malformed output. Check every path and line against the snapshot. Invalid references become coverage problems, not findings. A schema-valid result is not proof of a correct review.
- Malformed output: at most one format-repair call, then the job fails with the raw output kept.

Publication:
- An approval record binds the exact body, destination (general, reply, or inline anchor), item revision, and reviewed commits. Any edit invalidates it.
- Preflight before send: refresh PR state, heads, and comments. Block stale items and show the reason. Flag likely duplicates against existing comments.
- A reply post checks only that the parent comment still exists and that no newer message arrived in the thread since the user saw it. It does not check the heads.
- Inline anchors pin fromHash and toHash to the reviewed commits. A line outside the diff goes into the general comment.
- Durable outbox states: pending, sent, unknown, failed, confirmed. Save the remote comment ID and version on success.
- A timeout after send sets unknown. Reconcile against remote comments before any retry. If still unclear, the user decides.
- Publish is idempotent on the server side: one outbox row per approval. A second tab or a refresh never sends twice.
- The backend posts. Claude never posts.

Notifications: opt-in. Deduplicate by event and comment version. Coalesce per PR. No self-events. After downtime, show one digest. Notifications work only while the service and a UI tab run.

Cache: key review results by immutable inputs: repository, PR, source and target heads, merge base, profile and skill revision, model, CLI version, context fingerprint.

Data model (SQLite):
- pull_request(instance, project, repo, pr_id, title, author, my_role, state, source_head, target_head, followed, archived_at, last_reviewed_commit)
- activity_seen(pr key, activity_id, first_seen_at)
- comment(pr key, comment_id, version, parent_id, root_id, author, text, anchor_json, created_at, updated_at, tombstoned_at)
- acknowledgement(comment key, acknowledged_version, acknowledged_at)
- sync_checkpoint(scope, cursor_json, last_complete_at, incomplete_reason, last_error)
- review_run(id, pr key, source_head, target_head, merge_base, profile, profile_revision, cli_version, model, context_fingerprint, status, freshness, session_id, idempotency_key, started_at, finished_at, usage_json, log_path)
- item(id, run_id, kind: finding|question, payload_json, edited_body, status: new|accepted|edited|discarded|posted)
- approval(id, item_id, body_hash, destination_json, reviewed_commits, approved_at, invalidated_at)
- outbox(id, approval_id unique, state: pending|sent|unknown|failed|confirmed, request_json, remote_comment_id, remote_version, attempts, last_error, updated_at)

Config: one JSON file in the user data folder. It holds no secrets.

Tests:
- Sanitized fixtures from Gate 0: nested replies, edits, deletions, duplicate activities, out-of-order activities, a late message during mark-read, paging, truncation.
- A fake claude executable that replays recorded stream-json, errors, usage limits, malformed output, and slow runs for cancel.
- Unit tests: unread logic, checkpoint commit order, snapshot sanitizing, path traversal, finding-to-anchor mapping (renames, removed lines, lines outside the diff), validator, outbox transitions.
- Playwright acceptance for all 15 scenarios A1 to A15.
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
- Ask the PR: a chat box that resumes the same PR's review session for follow-up questions.
- Approve and Needs work buttons.
- A "My open threads" view across all PRs, with unresolved tasks.
- Snooze a thread, personal reminders, and a deterministic daily digest.

Phase 3, author mode (my own PRs):
- Self-review before I open a PR.
- A digest of incoming feedback, grouped by topic.
- Draft fixes in a worktree for accepted feedback. I review and push.
- Draft a PR description from the commits and the Jira issue.

Phase 4, better reviews:
- Acceptance-criteria coverage: map the Jira issue's requested behavior to code, tests, and gaps.
- Cross-repository producer and consumer checks: schema, deployment order, compatibility. Use a local context config (doc paths, entry points, related repositories, contract owners, test commands). Record related revisions. A missing repository becomes a question, not a claim.
- Learn from discards: store rejected findings per repository and send them as "do not flag" guidance.
- A per-repository review rules file that each review reads first.
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

1. Bitbucket version and auth? [Answered in Gate 0: Data Center 9.4.26. An HTTP access token as Bearer works for reads and writes.]
2. Can clients fetch refs/pull-requests/*? [Partly answered in Gate 0: ls-remote lists refs/pull-requests/<id>/from, and no merge ref. Verify the fetch in M2. Fall back to a branch fetch.]
3. Mark AI-assisted comments? [No marker. The user owns every posted comment.]
4. Which local repository paths may the app read? [None at first. The app uses its own cache clones.]
5. Which MCP servers run in reviews? [Microsoft Learn and DeepWiki. Add Jira and CodeGraph only with a read-only tool list.]
6. The existing Bitbucket MCP: tool names, schemas, and paging? [Answered in Gate 0: names and schemas are recorded in integration-check.md. It has comment write tools and no delete tool. Sync and publish use REST either way.]
7. The colleague's app: source and license? [Inspect it when available. Reuse working modules. Not a blocker for fixture work.]
8. Company AI policy and external MCP policy? [Get approval to send source to Claude and to use the documentation MCPs before the first real review.]
9. Installed Claude Code and Ponytail versions? [Record them in Gate 0. Claude Code must be v2.1.257 or later.]
10. Real payloads for edit, delete, and reply activities? [Answered in Gate 0: payload shapes are recorded in fixtures/bitbucket/ and section 7.]

## 11. Sources (checked 2026-10-09)

- Claude Code headless mode: https://code.claude.com/docs/en/headless (stream-json needs --verbose; --json-schema result in structured_output; --bare skips OAuth and the keychain).
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference (--setting-sources, --strict-mcp-config, --settings, claude auth status).
- Claude Code permissions: https://code.claude.com/docs/en/permissions (blockReadsOutsideWorkingDirectories; trust dialog not shown in -p).
- Claude Code IAM and auth precedence: https://code.claude.com/docs/en/iam (ANTHROPIC_API_KEY wins over the subscription).
- Claude Code hooks and settings: https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/settings
- Claude Code terms: https://code.claude.com/docs/en/legal-and-compliance
- Bun secrets: https://bun.com/docs/runtime/secrets (experimental).
- Bun runtime: https://bun.com/docs (bun:sqlite, spawn, bun test, bun build --compile).
- Hono: https://hono.dev/docs/middleware/builtin/csrf, https://hono.dev/docs/helpers/streaming, https://hono.dev/docs/guides/validation, https://hono.dev/docs/guides/rpc, https://hono.dev/docs/getting-started/nodejs
- shadcn/ui with Vite: https://ui.shadcn.com/docs/installation/vite
- Bitbucket Data Center REST (pull requests, v906): https://developer.atlassian.com/server/bitbucket/rest/v906/api-group-pull-requests/ (comment version; anchor fromHash, toHash, diffType).
- spec-kit: https://github.com/github/spec-kit (command prefix /speckit-, init flag --integration).
- Edge-case reference: PROJECT_BRIEF_GPT_ASTRA_6.md (state semantics, acceptance scenarios, publication reliability). Alternative prompts: IMPLEMENTATION_PROMPTS_GPT_ASTRA_6.md.
