# Implementation prompts — Bitbucket Review Inbox

Companion to PROJECT_BRIEF.md. Run one bounded step per agent session. Do not feed the entire future roadmap into every implementation task. The first feature is the no-AI inbox, not the whole product.

## 0. Establish facts and reuse opportunities

Use this as an ordinary coding-agent prompt before asking Spec Kit to create implementation tasks:

```text
Read PROJECT_BRIEF.md. Inspect the repository before editing it. If it contains my
colleague's existing application, identify reusable modules and preserve working
behavior. Do not rewrite it merely to match the proposed stack.

Create a short integration-check.md with: installed runtime/CLI versions,
authentication route, known Bitbucket version, capabilities actually tested,
and missing production inputs. Read local help/configuration without extracting
or displaying credentials. Do not infer success from an installed executable.

For the real server, use only explicitly authorized read operations. Test any
comment creation only on a designated PR with explicit authorization. Inspect
the existing Bitbucket MCP's actual tool schemas rather than inventing names.
Prove complete pagination and nested-reply retrieval. A missing server connection
is not a blocker for fixture-based development: state it and use a fake provider.

For Claude Code, verify the unmodified installed CLI and its existing login.
Do not use an SDK/proxy/token extraction or --bare as a subscription workaround.
Do not execute repository hooks, install untrusted plugins, or launch paid API
inference. A tiny real review requires available quota and the approved environment;
otherwise test the runner protocol using a fake executable.

Return the smallest reusable architecture and unresolved release gates. Do not
build the whole application or ask a long questionnaire.
```

## 1. Initialize Spec Kit and determine invocation names

Check the installed Specify CLI help before changing project files. Current upstream documentation describes both integration-specific skill names and slash-command forms; do not assume one syntax works for every installation.

Current upstream README shows `uv tool install specify-cli` and an initialization option named `--integration`; older installations may use `--ai`. Use `specify init --help` and the existing-project instructions before initializing an existing repository. Preserve existing agent configuration and work. The exact Claude integration key must come from that installed release, not a guessed alias.

In the prompts below, the dotted form such as `/speckit.specify` denotes the corresponding operation. If the installed integration exposes `/speckit-specify`, invoke that equivalent instead. These are agent-chat commands/skills, not shell commands.

Sources: `https://github.com/github/spec-kit` and `https://github.github.io/spec-kit/reference/agentic-sdd.html`.

## 2. Constitution — once

```text
/speckit.constitution
Set concise principles for the local-first Bitbucket Review Inbox:
- Deliver one usable vertical slice at a time; preserve working code.
- Strict TypeScript and a modular monolith, not speculative frameworks.
- No AI required for synchronization, unread state, notifications, or publication.
- Actual unmodified Claude Code owns authentication; no credential extraction,
  shared subscription pool, silent paid fallback, or automatic review loops.
- All remote writes require human approval of exact text and destination.
- Revision-pinned evidence, explicit incomplete coverage, and no fabricated findings.
- Durable read state, safe retry semantics, and hostile repository-content handling.
- Accessible, restrained, two-pane UI with explicit failure and stale states.
- Test acceptance behavior with fixtures; verify production compatibility separately.
Keep the constitution short enough to read at the start of each task.
```

## 3. Specify only the first useful feature

```text
/speckit.specify
Use PROJECT_BRIEF.md as the source of product requirements. Specify Slice 1 only:
a single-user local inbox for selected repositories on one self-hosted Bitbucket
instance. It shows PRs, nested discussions, unread message revisions, replies to
my comments, and links back to Bitbucket. Read state survives restart. New messages
arriving during mark-read remain unread. Polling and reconciliation run without AI.

The UI has a PR list and one detail pane; Needs attention, Waiting, All; a search
field; one repo filter; and Discussion/Overview. Existing historical comments are
imported without a notification flood. Show offline, incomplete-sync, empty, loading,
and permission-denied states. Notifications are optional, deduplicated, and limited
to the documented running-app lifecycle.

Exclude Claude review execution, publication, inline diff rendering, native shells,
GitHub, team features, vector search, and analytics from this feature. Refer to the
brief's later slices as future scope only. Convert behavior into testable acceptance
criteria. Do not claim production compatibility before the integration check passes.
```

## 4. Plan the feature, not the future product

```text
/speckit.plan
Read the accepted feature specification, PROJECT_BRIEF.md architecture constraints,
and integration-check.md. Use Bun + Hono, React + Vite + Tailwind + selected shadcn/ui
components, TanStack Query, SQLite via bun:sqlite, and Zod. Use bun:test and Playwright
with their verified tooling requirements. Preserve existing equivalent working
modules discovered in the reuse assessment instead of performing a stack rewrite.

One local service serves the production UI and API. Use prepared SQL and migrations.
Keep provider mapping inside ForgeProvider with Bitbucket and a fixture implementation.
Do not implement ReviewRunner or ContextSource before their feature needs them.

Design observation/seen-version storage so mark-read is race-safe. Follow real server
pagination; expose incomplete fetches. Use transactions, bounded polling, reconciliation,
origin/session/CSRF protections, and server-side ephemeral credentials. Include a fixture
with nested replies, comment edits, duplicate activities, and a late-arriving message.

Plan only the necessary modules and tests. No ORM, queues-as-a-service, microservices,
plugin marketplace, desktop wrapper, or generated architecture encyclopedia.
```

## 5. Tasks and one consistency review

Run the integration's equivalents of:

```text
/speckit.tasks
/speckit.analyze
```

Resolve material contradictions between the spec, plan, and tasks without regenerating all artifacts. Prioritize migrations/domain behavior, provider fixtures, synchronization, the two-pane UI, and end-to-end verification. Do not run repeated analysis for stylistic differences.

## 6. Implement a bounded slice

```text
/speckit.implement
Implement only the next coherent task group in tasks.md. Start with its acceptance
fixture/test, then the minimal code to pass it. Do not pre-implement later review,
publication, or GitHub features. Do not rewrite completed modules unless this task
requires a specific change.

Run relevant tests and type checking. Use fake providers, not real model calls.
Finish with a compact handoff: completed task IDs, changed files, tests and results,
known limitations, and the next task group. Update tasks.md. Do not claim tests passed
unless they ran. Stop rather than expanding into adjacent features.
```

Use a fresh agent session for the next task group. Supply only the constitution, accepted feature spec, current plan/tasks, and compact handoff. If the installed Spec Kit offers a converge operation, use it to check acceptance gaps; do not interpret it as permission for an unlimited implementation loop.

## 7. Add reviews as a separate feature after the inbox works

```text
/speckit.specify
Add Slice 2 from PROJECT_BRIEF.md to the working inbox. A user explicitly starts
Explain or Review; the local service invokes the user's unmodified Claude Code CLI
with its existing supported subscription authentication. Use an inspected pinned
Ponytail review skill plus the project's evidence/output contract. No direct model
API/SDK workaround and no --bare for the subscription path.

Collect an immutable PR/source/document snapshot, include existing discussions and
relevant connected code, expose only approved read-only context/tools, and prevent
execution of repository-supplied configuration. Produce schema-validated explanation,
findings, questions, evidence, and coverage. Store and display editable drafts locally.
A completed review supplies the explanation too. No automatic remote comments.

Show cancellation, missing tools/context, quota exhaustion, malformed output, and
stale revisions honestly. One active job, cache immutable results, and use a fake CLI
for ordinary tests. No auto-fixes, builds, general agent console, or agent swarm.
```

Then run plan → tasks → one analysis → bounded implementation for this feature only.

## 8. Add human-approved publishing as the next feature

```text
/speckit.specify
Add Slice 3 from PROJECT_BRIEF.md. Select and edit findings; preview exact comments
and destinations; explicitly confirm publication. The backend, never Claude, posts
separate general PR comments with file references and reviewed revision. Store remote
comment IDs so replies return to the correct thread. Add manually written replies
with preview and explicit confirmation.

Implement a durable outbox, stale-result guard, duplicate-click protection, and an
unknown-outcome state when a write may have succeeded but its response was lost.
Reconcile before any retry. Never claim exactly-once delivery without server support.
No automatic approvals, merges, remote thread resolution, or inline comments yet.
Prove the selected-two-of-six, changed-head, and timeout-after-acceptance cases.
```

## 9. Only after real use

Next candidates are reliable inline anchoring/diff display, changes-since-review,
and targeted verification of an author's fix. Choose one based on observed friction.
Keep GitHub, desktop shells, autonomous fixes, and team features outside the current
spec until they are actually selected.
