# Bitbucket Review Inbox — project brief

Status: proposed scope and architecture, not an implemented or tested application.  
Research checked: 9 October 2026.  
Primary user: an individual developer reviewing work across self-hosted Bitbucket repositories.  
Working title only; no product-name or domain-availability claim.

## 1. Product decision

Build a local-first review inbox, not a Git client or a general-purpose agent console. A local TypeScript service keeps Bitbucket conversations synchronized and serves a browser interface. It invokes the user's installed, unmodified Claude Code CLI only when explicitly requested. The CLI owns its authentication. The application owns synchronization, read state, review drafts, and human-approved publication.

The product must remain useful with no Claude quota available. No AI is needed to discover pull requests, fetch discussions, identify unread changes, save decisions, publish approved text, or notify the user.

Windows is the first tested platform; Linux is the next release gate. Preserve portability to macOS, but do not advertise tested macOS support without testing it. A desktop shell is not part of the first release.

## 2. Problems and desired outcomes

1. **Lost conversations.** Identify replies to my comments, mentions, and new messages in discussions I follow, across repositories. Show what changed since I last read each thread.
2. **Repeated review effort.** Start a Claude Code review with one action, keep its output locally, and publish only findings I select and edit.
3. **Missing context.** Explain the change, inspect project documentation and connected code, and distinguish demonstrated defects from unanswered questions.

Success is a completed loop: discover PR → understand/review → inspect drafts → approve selected comments → receive replies → respond or re-review. The initial product optimizes this loop rather than the number of integrations.

## 3. Constraints

- Use actual Claude Code with the developer's existing supported subscription login. Do not substitute direct model API requests, an Agent SDK authentication workaround, extracted OAuth tokens, or a proxy.
- Do not collect or store Claude account credentials. A user signs in through Claude Code itself.
- Reviews are user-initiated, with one active job by default. No automatic review on every push, agent swarm, or unbounded repair loop.
- Bitbucket Server/Data Center comes first. Bitbucket Cloud is a different integration and is out of scope.
- All external comments and replies require explicit human confirmation. Nothing approves, requests changes, merges, resolves a remote thread, or edits repository code automatically.
- Keep the application single-user and local. No SaaS backend, team accounts, billing, shared subscription pool, or internet-facing listener.
- Existing Bitbucket MCP and the colleague's application are reuse candidates, not assumed implementations. Inspect their capabilities and licensing before choosing what to reuse.
- Company authorization to send proprietary source to Claude and approved external documentation services is a deployment prerequisite. Local hosting does not make inference local.

## 4. Minimum useful release and staged scope

### Gate 0 — prove the integration

Use one designated test PR. Record the actual Bitbucket version, authentication method, canonical current-user ID, Claude Code version/authentication mode, and installed review-skill name/version. Verify a complete discussion including nested replies, a pinned source revision, and a small structured Claude Code result. Test a single general comment and reply only with explicit authorization on the test PR.

Inspect the colleague's code, when available, for reusable provider authentication, persistent discussion state, CLI process management, and UI components. Reuse working modules rather than rebuilding them merely to match this proposed stack. Do not make reuse of an unavailable repository a blocker for fixture-based development.

### Slice 1 — useful inbox without AI

Connect one Bitbucket instance; select a small set of repositories or add a PR by URL. Show relevant open PRs, conversations, unread messages, read acknowledgements, and an Open in Bitbucket action. Persist state through restarts. Poll while the local service is running. Offer opt-in browser notifications while the UI is open.

This is a standalone useful release even if all later slices are postponed.

### Slice 2 — review drafts

Add Explain and Review actions. A review produces one cached explanation, grounded findings, questions for the author, and a coverage/limitations report. Render editable finding cards with source excerpts and links. No remote publication yet. Explain is an optional smaller job before review; after review it reuses the existing summary without a second model call.

### Slice 3 — close the review loop

Publish selected findings as separate **general PR comments** containing file/line references and the reviewed revision. Separate comments preserve independent reply threads. Present the exact text and destinations before submission. Track replies to those comments; support manually authored replies with preview and confirmation.

General comments are an intentional first-release shortcut, not inline comments disguised as equivalent functionality. AI analysis and publishing must remain separate capabilities.

### Next release

Add a read-only diff viewer, reliable inline comment anchoring, changes-since-review, and targeted re-review. Do not build a diff editor in the first release.

## 5. Minimal interface

Use a two-pane master/detail screen, with no permanent third pane and no analytics dashboard.

**Inbox pane:** search, one repository filter, and three views: Needs attention, Waiting, All. Rows show PR title, repository/author, an unread count, and a concrete reason such as “Reply to your comment”, “New commits”, or “Review requested”. Allow personal follow/unfollow. Do not scan every repository on the server by default.

**PR pane:** title and status, followed by Overview, Discussion, and Review tabs. The header offers Explain, Review, and Open in Bitbucket; it shows Stop during a review. Publishing appears only when findings are selected, with a precise label such as “Publish 2 comments”.

Overview includes a short explanation, changed areas, review freshness, and missing context. Discussion emphasizes unread messages and provides “Next unread”; historical messages remain expandable. Review shows editable drafts, evidence, questions, and coverage. Put detailed process logs behind an expandable section, not in the primary reading path.

Use consistent spacing, readable typography, quiet neutral surfaces, restrained status accents, visible focus, keyboard navigation, and both dark and light themes. Never communicate status only through color. Preserve scroll position when events arrive. Notification permission is optional and denied permission never blocks the inbox.

Empty, loading, offline, permission-denied, quota-exhausted, cancelled, incomplete-review, stale-review, and ambiguous-publication states are required UI states—not generic error toasts.

## 6. State semantics

Keep three independent kinds of state:

| State | Examples | Owner |
|---|---|---|
| Provider state | Open, merged, declined; remote approval and thread state | Bitbucket |
| Personal attention | Needs review, needs reply, waiting, archived; seen revisions | Local application |
| Review job | Queued, running, completed, incomplete, cancelled, failed; fresh/stale result | Local application |

Unread is not the same as unresolved, and read is not the same as reviewed. Do not infer that an issue was fixed because a comment was marked read or the author replied. “Needs reply” is a useful heuristic, not an assertion that the user owes an answer.

Track each comment by provider/account/repository/PR/comment identity and observed version or content fingerprint. Flatten nested replies while retaining parent and root-thread IDs. Store which message revision the user actually acknowledged. Opening a PR does not mark every hidden thread read. A read acknowledgement names the displayed revisions, so a concurrent incoming reply remains unread.

For initial synchronization, import historical discussion as history without a notification flood. Newly discovered open PRs may still need review. Do not invent a historical read state from Bitbucket's PR timestamp. By default, one's own new comments do not create unread notifications.

Comment edits can make a message unread again. Deleted content becomes a tombstone only when deletion is supported by evidence; a failed or partial fetch is not deletion. Continue following a merged PR's active conversation until locally archived or unfollowed.

## 7. Review behavior and output contract

The review is a bounded investigation, not a diff-only opinion. Collect the PR description, exact revision range, existing discussions, changed files, relevant source, nearby tests, and selected project documents. Read actual callers, callees, producers, and consumers where a changed contract makes them relevant.

Prefer context in this order: exact reviewed source and tests; project architecture/contracts and build manifests; public documentation for the dependency version actually used; external generated summaries as supporting navigation. Project documents can be stale: report contradictions rather than treating prose as proof.

Every result contains:

- **Identity:** result schema version, PR identity, source and target heads, merge-base/diff-range information where available, job/session ID, runner version, skill revision, model, and context fingerprint.
- **Explanation:** intended behavior, changed areas, and material assumptions.
- **Findings:** category, severity, confidence, location, triggering scenario, evidence references, consequence, and suggested direction. Evidence status distinguishes code-grounded analysis, reproduced behavior, and unverified hypotheses.
- **Questions:** missing facts that affect correctness, with why each answer matters. Do not mix these with demonstrated bugs.
- **Coverage:** files/documents inspected, excluded or truncated content, unavailable repositories/tools, and tests run or explicitly not run.

A deterministic validator rejects malformed output and invalid file/line references. A schema-valid answer is not automatically a correct review. An incomplete run cannot be shown as “no issues found”. Do not repair malformed output through an unlimited sequence of model calls.

### Cross-component review example

A consumer adds display of function arguments. The review must trace who produces argument metadata, which schema and version carry it, whether the producer change is deployed or included, and whether a producer-to-consumer fixture proves the feature end to end. A perfect-looking consumer diff may still be incomplete.

The first implementation uses a small, locally approved repository context configuration: documentation paths, important entry points, relevant related repositories, contract owners, and known test commands. Related repository revisions must be recorded. If the producer repository is unavailable, emit a specific question and coverage gap—not a claim that it was checked. No vector database or universal code graph is required initially.

### Ponytail and documentation MCPs

Use an inspected, pinned Ponytail review skill as the initial profile. Its current upstream scope includes correctness, security, load, testing, performance, and simplification; older descriptions emphasizing simplification alone are no longer sufficient [S5]. Add the application's evidence and output contract without silently rewriting the skill on every review. Record its version.

Microsoft Learn MCP supplies official Microsoft documentation [S6]. DeepWiki MCP supplies public-repository documentation/search; it is not an index of private Bitbucket repositories [S7]. Check exact dependency versions and upstream source before turning an external claim into a finding. MCP access improves evidence access; it does not guarantee truth.

Do not send proprietary source, internal URLs, or complete PR text as public MCP search queries. Query approved public APIs/symbols with minimal information. Surface tool unavailability as a coverage gap. Add more MCPs only when a demonstrated missing capability requires one.

## 8. Architecture and exact starting stack

Architecture: a modular monolith. Browser → loopback HTTP service → SQLite and Bitbucket. The service starts Claude Code as a separate local child process for an explicit job. There is no model call in synchronization or publication.

| Area | Selection |
|---|---|
| Language/runtime/package manager | Strict TypeScript; Bun |
| Local HTTP service | Hono; ordinary JSON endpoints and server-sent events |
| Browser UI | React, Vite, Tailwind CSS, selected shadcn/ui components |
| UI server state | TanStack Query; no additional global state framework initially |
| Persistence | SQLite through bun:sqlite; prepared SQL and checked-in migrations |
| Runtime validation | Zod; one review-result contract shared with the UI and runner |
| Review execution | Installed Claude Code executable through Bun.spawn argument arrays |
| Bitbucket integration | Typed REST adapter using fetch, behind ForgeProvider |
| Git snapshot operations | simple-git where local Git operations are needed; no shell-concatenated commands or ad hoc raw-diff parser |
| Tests | bun:test for logic/integration; Playwright for browser acceptance |
| Later diff UI | @pierre/diffs, introduced only with the inline-review slice |

Bun documents Hono integration, subprocesses, and built-in SQLite [S8–S10]. Vite and shadcn document a React/TypeScript setup [S11–S12]. Test tools have their own system requirements; Node may still be needed for upstream build/test tooling even though the application service uses Bun. Prove and pin the working Windows/Linux toolchain instead of promising a completely Node-free development environment.

Create just three expansion boundaries: **ForgeProvider**, **ReviewRunner**, and **ContextSource**. Implement Bitbucket and Claude Code first. Keep provider-specific payloads inside adapters, but retain raw identity/anchor information needed for correctness. A fixture provider supports offline development and tests. Do not build a plugin marketplace, dependency-injection framework, or speculative GitHub implementation.

Suggested layout:

```text
src/
  web/                  # inbox, PR workspace, shared UI
  server/
    bitbucket/          # REST transport, mapping, capabilities
    sync/               # polling and reconciliation
    inbox/              # attention rules and seen state
    review/             # jobs, CLI, context, result validation
    publish/            # human-approved durable outbox
    storage/            # SQLite and migrations
  shared/               # IDs, domain DTOs, schemas
fixtures/               # sanitized Bitbucket payloads and fake CLI output
tests/                  # unit, contract, browser acceptance
```

Why not Qt/QML, Tauri, or Electrobun now: a desktop wrapper does not solve comment synchronization, review freshness, or publishing correctness. Qt would add custom discussion/diff UI work; Tauri introduces a Rust/sidecar packaging boundary; Electrobun introduces desktop packaging and lifecycle work. These are valid later choices, not prerequisites. Do not combine two desktop frameworks. Keep the browser/service boundary so a shell can be added later.

## 9. Provider and synchronization requirements

Target the installed Bitbucket version, not whichever Data Center documentation is newest. Verify capabilities with authorized test data. Useful REST resource families include application properties, selected repositories' PR lists, a PR's activities, comment lookup/create/reply, diff/changes, and source retrieval at a revision [S4].

The app uses deterministic REST calls for synchronization and publication. The existing Bitbucket MCP can be reused for Claude's approved read tools. An MCP-only transport is acceptable behind ForgeProvider only after it proves stable IDs, complete pagination, nested replies, and predictable writes. Calling an MCP tool programmatically does not require an LLM; do not make Claude the transport layer.

Suggested initial operational defaults—not benchmark claims: poll followed active PRs roughly once a minute, allow at most two simultaneous Bitbucket requests, use jitter/backoff, and reconcile periodically. Avoid downloading source and full diffs during ordinary polling. Document and tune the defaults with the server administrator as needed.

Follow the actual returned pagination cursor rather than computing it. APIs that return page-shaped objects are not necessarily fully pageable. Bitbucket versions can cap changes or truncate diffs; explicitly detect incompleteness [S4]. Treat source/target changes during collection as a consistency failure or record an explicit older snapshot. Do not assemble one review from multiple moving revisions.

Use activity IDs plus observed comment revisions; do not rely solely on PR updatedDate, local clock comparisons, or assumptions that IDs are globally ordered. Reconcile watched threads to catch edits and missed events. Advance checkpoints only after a successful database transaction. Resume safely after sleep, VPN loss, and service restart.

## 10. Claude Code integration and boundaries

Official documentation supports noninteractive CLI execution, structured output, and streaming [S1]. Anthropic also distinguishes ordinary use of the unmodified binary with an end user's own login from collecting/intermediating subscription credentials in third-party products [S2]. Public distribution requires checking the applicable terms; open-source licensing alone does not waive provider terms.

Before enabling Review, inspect the installed CLI's help and authentication status. A present API-key environment variable can select API billing instead of the subscription [S3]. For this user's subscription-only configuration, explain and stop on a conflicting billing route; do not silently switch to paid inference or modify the CLI's built-in authentication methods. Do not invent an API for exact remaining weekly quota.

Use the documented print mode and structured output supported by the installed release. Begin with a single final JSON result; add detailed streaming only after its parser and cancellation behavior are tested. Recognize structured error results, not only process exit codes. Store session IDs for traceability, but never resume a different PR's session.

**Do not use --bare for this subscription-based design:** current documentation says bare mode does not read subscription OAuth credentials [S1]. Also, do not start noninteractive Claude Code in an arbitrary PR checkout: it can load repository-supplied hooks/configuration without the interactive trust prompt [S15].

Create an application-controlled review workspace. Supply reviewed files as a sanitized source snapshot, not an executable project environment. Prevent discovery/execution of PR-supplied .claude settings, hooks, skills, and .mcp.json files; read relevant project guidance explicitly as untrusted evidence. Restrict tools and MCP configuration, inspect installed trusted plugins, and respect organizational managed policies. Test the effective policy against the pinned CLI version. --allowedTools is not by itself a complete deny-by-default boundary.

The review process does not receive the publisher's Bitbucket token. Do not expose a combined read/write MCP or a generic HTTP/shell tool as though it were read-only. If a safe read-only view of the existing MCP cannot be enforced, omit that MCP and supply the materialized Bitbucket context instead. No automatic builds, test execution, dependency installation, or code modification in the first review profile. These require a separate, explicitly authorized execution environment later.

A separate directory is not an OS sandbox. Keep that limitation explicit. Harden source export against symlinks, path traversal, repository-controlled Git helpers, and executable configuration. Do not auto-run submodules or repository scripts.

## 11. Publication, freshness, and reliability

Persist approval decisions separately from model findings. A publication command binds the exact approved body, destination, finding revision, and reviewed source revision. Editing text invalidates its prior approval. The backend—not Claude—performs the write.

Before sending, refresh PR identity/state/revisions and discussions. Block stale findings when source/target context changed; show the reason. Detect potential duplicates already raised by colleagues. Once inline comments exist, preserve provider-native diff coordinates and commit anchors; do not confuse a new-file line with an old-file line. Renames, removed lines, and orphaned threads require tests [S4]. A preflight check alone cannot eliminate the race with a concurrent remote push; commit-specific references and post-write reconciliation remain necessary.

Use a small durable SQLite outbox. Save the returned remote comment ID and link it to the local finding. Do not assume the server provides an idempotency key. If a network timeout occurs after submission, mark the outcome unknown, reconcile against remote comments, and do not blindly retry. Require human resolution when the result remains ambiguous. Never claim exactly-once publication without server support.

On a new source or target revision, keep the old report but mark it stale. Incremental review may examine the new delta plus affected context; after a force-push, changed merge base, or missing history, fall back to an explicit full review. Never reuse the old summary as fresh just because the PR number is unchanged.

## 12. Local safety, privacy, and notifications

Bind the service only to loopback. Validate Host and Origin, require a local session for sensitive endpoints, protect mutations against CSRF, and do not enable wildcard CORS. A random port is not authentication. Restrict server destinations to the configured Bitbucket instance, validate redirects, and handle corporate CA certificates without disabling TLS verification.

Keep provider credentials server-side; never put them in localStorage, URLs, exported briefs, review prompts, or SQLite content tables. For the first release, keep the entered Bitbucket token in service memory and request it again after restart. Add OS credential-store persistence later. Redact logs and avoid external telemetry by default. Render Markdown safely and do not automatically fetch external images embedded in untrusted comments.

The service owns polling while it is running; the browser does not own synchronization correctness. Notifications are opt-in, deduplicated by event/revision, coalesced per PR, and exclude self-events. A basic browser notification implementation is not an always-on desktop notification service [S16]. Document that notifications require the relevant UI/service to be active; after downtime, show a reconciled digest on reopening. A later tray/OS-service feature can notify with the browser closed, but nothing on a sleeping/offline laptop can detect new server events in real time.

## 13. Token and context controls

No AI on application startup, polling, page navigation, notifications, or publication. One explicit review job by default, no automatic retry after quota exhaustion, and no automatic paid fallback. Preserve the usable inbox and completed drafts when review is unavailable.

Cache by immutable inputs: repository and PR, source/target/diff revisions, context/doc versions, related-repo revisions, review policy and skill version, model, and relevant discussion snapshot. Do not blindly append every previous transcript. Review once to obtain explanation, findings, and questions together. Fetch relevant documentation on demand. Prefer a recorded coverage gap over silently exceeding the budget or claiming a comprehensive review.

Display actual tool-reported usage where available; distinguish estimates from plan quota. Never fabricate a percentage of the weekly allowance. Use canned provider responses and fake CLI output for implementation tests so most development consumes no review quota.

## 14. Required acceptance scenarios

| Scenario | Expected result |
|---|---|
| New reply to my previously published comment | One unread event linked to the correct thread; survives restart |
| New message arrives during mark-read | Only displayed revisions become read; new message remains unread |
| Same activity appears twice or out of order | No duplicate thread or notification |
| Colleague edits an existing reply | Updated revision is visible and can become unread |
| Pagination, nested replies, or orphaned threads | No silent loss; missing/truncated coverage is visible |
| VPN failure or partial sync | Prior state remains; no false deletion or cursor advancement |
| New head or target revision during review | Result remains tied to its original snapshot and is marked stale |
| User selects two of six findings | Exactly those approved bodies are eligible for publication |
| Timeout after server may have accepted a write | Unknown outcome; no blind duplicate retry |
| CLI rate limit, auth error, or cancellation | Review stops visibly; inbox and saved drafts still work |
| Invalid JSON or truncated review context | No misleading successful/clean review and no publication |
| MCP unavailable or related repository missing | Specific question/coverage gap instead of fabricated verification |
| Malicious repository configuration | No PR-controlled hook, arbitrary command, or remote write runs |
| UI refresh or multiple tabs | No extra AI job or duplicate publication |
| Provider state says merged | Does not falsely imply unread conversations were read |

Use sanitized fixtures for routine tests and a separately authorized integration smoke test for the real server. Record what was actually tested on Windows and Linux. Fix acceptance failures without regenerating the whole application or rewriting accepted features.

## 15. Later workflows, in priority order

1. Changes since my review; targeted verification of previously raised findings.
2. Explain a colleague's response; prepare a draft reply, still requiring approval.
3. Issue/acceptance-criteria coverage: map requested behavior to code, tests, and gaps.
4. Cross-repository producer/consumer checks, including schema, deployment order, and compatibility.
5. Thread snooze, personal follow-up reminders, and a deterministic daily digest.
6. Native tray notifications and startup management, without changing the core provider logic.
7. GitHub provider using the same inbox/review semantics with capability-specific differences.

Defer automatic fixes, merge automation, team dashboards, knowledge graphs, vector search, marketplace plugins, multiple simultaneous review agents, and a full editor until actual use justifies them.

## 16. Open inputs—not assumptions to hide

Record the actual Bitbucket version and supported authentication; the existing MCP's name, tool schemas and pagination behavior; approved local repository paths; the colleague application's source/license when available; organizational AI and external-MCP policy; and the installed Claude Code/Ponytail versions. These are not verified by this brief. Missing production inputs must not block development against fixtures, but they do block claims of working production integration.

## Research references

These references establish external capabilities and constraints, not that the proposed product has been built or that the user's environment is compatible. All implementation-specific requirements above are design decisions. Pin and recheck relevant versions during Gate 0.

- **S1 — Claude Code programmatic execution.** Print mode, structured results, and bare-mode authentication limitation. `https://code.claude.com/docs/en/headless`
- **S2 — Anthropic legal/compliance.** Unmodified binary, end-user authentication, and third-party credential restrictions. `https://code.claude.com/docs/en/legal-and-compliance`
- **S3 — Claude Code with Pro/Max.** Subscription authentication and API-key billing precedence. `https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan`
- **S4 — Bitbucket Server REST 7.6 reference and Atlassian comment guidance.** Versioned baseline, not a claim that the user's server is 7.6. `https://docs.atlassian.com/bitbucket-server/rest/7.6.0/bitbucket-rest.html` and `https://support.atlassian.com/bitbucket-data-center/kb/how-to-retrieve-pull-request-comments-using-rest-api/`
- **S5 — Ponytail upstream and review skill.** Current review scope; inspect and pin rather than assuming an older description. `https://github.com/DietrichGebert/ponytail` and `https://raw.githubusercontent.com/DietrichGebert/ponytail/main/skills/ponytail-review/SKILL.md`
- **S6 — Microsoft Learn MCP.** Official service and developer reference. `https://learn.microsoft.com/en-us/training/support/mcp-developer-reference`
- **S7 — DeepWiki MCP.** Public repository documentation/search. `https://docs.devin.ai/work-with-devin/deepwiki-mcp`
- **S8 — Hono on Bun.** `https://hono.dev/docs/getting-started/bun`
- **S9 — Bun subprocesses.** `https://bun.com/docs/runtime/child-process`
- **S10 — Bun SQLite.** `https://bun.com/docs/runtime/sqlite`
- **S11 — Vite setup and tooling requirements.** `https://vite.dev/guide/`
- **S12 — shadcn/ui with Vite, React/TypeScript, and Tailwind.** `https://ui.shadcn.com/docs/installation/vite`
- **S13 — Testing.** `https://bun.com/docs/test` and `https://playwright.dev/docs/intro`
- **S14 — Git and later diff rendering.** `https://github.com/steveukx/git-js` and `https://diffs.com/`
- **S15 — Claude Code permissions and hooks.** Noninteractive trust behavior and configuration controls. `https://code.claude.com/docs/en/permissions` and `https://code.claude.com/docs/en/hooks`
- **S16 — Browser notifications.** `https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API`
- **S17 — Spec Kit.** Installed integration determines command/skill naming. `https://github.com/github/spec-kit` and `https://github.github.io/spec-kit/reference/agentic-sdd.html`
- **S18 — CLI flags and authentication status.** `https://code.claude.com/docs/en/cli-reference`
- **S19 — Desktop alternatives.** `https://v2.tauri.app/concept/architecture/`, `https://v2.tauri.app/develop/sidecar/`, `https://framework.blackboard.sh/electrobun/`, and `https://doc.qt.io/qt-6/supported-platforms.html`
- **S20 — Validation and UI data state.** `https://zod.dev/` and `https://tanstack.com/query/latest/docs/framework/react/overview`
