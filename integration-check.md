# Gate 0 integration check

Status: local checks done on 2026-10-09 (Windows 11). Bitbucket checks done on 2026-10-09 on a sandbox PR. Raw evidence is in `.gate0/local/` and `.gate0/raw/`. Both folders are gitignored.

## Local

Run: `bun scripts/gate0/local-checks.ts`. Each `claude -p` call uses `--model haiku --max-turns 2 --output-format stream-json --verbose`. The prompt goes on stdin. `Bun.spawn` gets an argument array and no shell. The child environment has no `ANTHROPIC_API_KEY` and no `ANTHROPIC_AUTH_TOKEN`. The script also removes `CLAUDECODE`, `CLAUDE_PID`, and `CLAUDE_CODE_*`. These mark a nested Claude Code session. The app does not run nested.

Cost of the final run: 8 `claude -p` calls, reported cost 0.0226 USD. Usage: input 20, cache creation 96933, cache read 282747, output 755 tokens. The two cancelled runs in check g report no cost. The script deletes its temp folders and the matching `~/.claude/projects/*rl-gate0-*` transcript folders.

| Check | Result | Command or flags | Evidence |
|---|---|---|---|
| Toolchain | CONFIRMED | `--version` of each tool | Bun 1.4.2, Node 22.17.1, git 2.56.0.windows.1, Claude Code 2.1.295 (native `claude.exe` under `%USERPROFILE%\.local\bin`, no `.cmd`), Ponytail plugin 4.12.0, Python 3.12.9. |
| Auth route | CONFIRMED | `claude auth status` | Exit 0. JSON keys: loggedIn, authMethod, apiProvider, analyticsDisabled, projectsDirectory, configDirectory, email, orgId, orgName, subscriptionType. `authMethod` = `claude.ai`, `apiProvider` = `firstParty`. The output holds account data, so the app must log only `authMethod`. |
| a. Bun.secrets | CONFIRMED | `Bun.secrets.set/get/delete` on service `review-loop-gate0-test` | `get` returned the stored value. `delete` returned `true`. `get` after delete returned `null`. |
| b. structured_output with stream-json | CONFIRMED | `--json-schema <one-field schema>` | Only the `result` event (subtype `success`) carries `structured_output` = `{"answer":"pong"}`. `num_turns` = 2: the schema answer uses one tool turn, so `--max-turns` must be 2 or more. Result keys include is_error, subtype, session_id, num_turns, total_cost_usd, usage, modelUsage, permission_denials, terminal_reason (`completed`), stop_reason, api_error_status, result, structured_output, duration_ms. Usage keys: input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, server_tool_use, service_tier, cache_creation. `init` keys include model, tools, mcp_servers, skills, slash_commands, agents, plugins, apiKeySource (`none`), claude_code_version, permissionMode, memory_paths. Model id: `claude-haiku-5-5`. |
| c. Project hook, untrusted folder | CONFIRMED | SessionStart hook in `<tmp>/.claude/settings.json` | Without `--setting-sources user`: the hook ran (`hook-ran.txt` exists). With `--setting-sources user`: the hook did not run. User-scope hooks still run with the flag. |
| d. Project CLAUDE.md | CONFIRMED | CLAUDE.md with a canary word | Without the flag: the reply had the canary. With `--setting-sources user`: the reply had no canary. |
| d. Project skill | CONFIRMED | `<tmp>/.claude/skills/canary-skill/SKILL.md` | Without the flag: `canary-skill` is in `init.skills` and `init.slash_commands`. With `--setting-sources user`: absent from both. |
| d. User skills | CONFIRMED | `--setting-sources user` | 12 `ponytail:*` entries, including `ponytail:ponytail-review`, are in `init`. User agents, plugins, and MCP servers also load (seen in `init`). User CLAUDE.md is inferred to load: in check f the model delegated to a user-defined agent, as the user CLAUDE.md tells it to. |
| e. Project `.mcp.json` | CONFIRMED | `--setting-sources user --strict-mcp-config --mcp-config <app json>` | Without flags: the project server was in `mcp_servers` and its process started, with no approval prompt. With `--setting-sources user`: the project server did not start, but all user and claude.ai connector MCP servers loaded. With `--strict-mcp-config` added: `mcp_servers` held only the app server. |
| f. blockReadsOutsideWorkingDirectories | CONFIRMED | `--setting-sources user --tools Read --allowedTools Read --settings <file>` | With `permissions.blockReadsOutsideWorkingDirectories: true`: the Read `tool_result` has `is_error: true`, text "... is outside ...; the permissions.blockReadsOutsideWorkingDirectories setting blocks reads outside the working directories ...", and `permission_denials` has 1 entry. Without the setting: Read returned the sibling file content. |
| f. Tool limits (side result) | DIFFERENT FROM BRIEF | First run used `--allowedTools Read` without `--tools` | The model called the `Agent` tool and started a user-defined subagent to read the file. `--allowedTools` does not limit the tool set, and the BRIEF deny list does not name `Agent`. `--tools Read` removed the `Agent` tool. |
| g. Cancel with `proc.kill()` | CONFIRMED | `Bun.spawn(claude.exe ... --strict-mcp-config --mcp-config <stdio server>)`, then `proc.kill()` after the `init` event | `init` showed the server as `connected`, and no `result` came before the kill. The MCP server was a direct child of `claude.exe` and was alive before the kill. After the kill, both processes were gone. Control: the fixture server stays alive after stdin EOF and ignores stdout errors. The mechanism is not isolated. |
| g. Cancel with `taskkill /T /F /PID` | CONFIRMED | `taskkill /T /F /PID <claude pid>` | `claude.exe` and the MCP server were both gone. No leftover test process. |
| h. `git archive` override | CONFIRMED | `* -export-ignore -export-subst` in `.git/info/attributes`, then `git archive --format=tar HEAD` | Control without the override: the `export-ignore` file was missing and `$Format:%H$` was expanded. With the override: the file was present and `$Format:%H$` was unchanged. A symlink entry (made through the index) shows as tar typeflag `2`. Windows `tar.exe` (System32) extracted it as a real symlink. `lstat` detected it, and `rm` removed it. Git for Windows GNU `tar` fails on `C:` paths (exit 128). |

## Bitbucket

Steps to run again:

1. The user stores the URL and token in their own terminal: `bun scripts/gate0/set-token.ts`. Check with `bun scripts/gate0/set-token.ts --check`. Remove with `--clear`.
2. Read-only probe: `bun scripts/gate0/bitbucket-probe.ts --pr PROJECT/repo/1`. A personal repository uses `--pr ~USER/repo/1`. A full PR URL also works, but its origin must equal the stored URL origin.
3. Write probe on the designated test PR only: `bun scripts/gate0/bitbucket-probe.ts --pr ~USER/repo/1 --write`. It deletes every comment it creates.

The probe ran without changes, read-only first, then with `--write`. The write run deleted all 3 comments it created. A separate re-read of the PR activities found no probe comment. Sanitized payloads are in `fixtures/bitbucket/` (see its README).

| Item | Status | Evidence |
|---|---|---|
| Server version | CONFIRMED | `GET /rest/api/1.0/application-properties`: HTTP 200, `version` 9.4.26 (Data Center), `buildNumber` 9004026. Keys: version, buildNumber, buildDate, displayName. |
| Auth header | CONFIRMED | `Authorization: Bearer <HTTP access token>` works for all read and write calls. No redirect. |
| Current user header | CONFIRMED | `X-AUSERNAME` is present. Its value equals the user `slug` and `name` of the token owner. |
| Paging fields | CONFIRMED | Dashboard, activities, and changes return size, limit, start, isLastPage, values. Not last page: `nextPageStart` is a number (dashboard, `limit=1`). Last page: dashboard and activities omit `nextPageStart`, but changes returns `nextPageStart: null`. |
| Dashboard | CONFIRMED | `role=REVIEWER` and `role=AUTHOR` with `state=OPEN` return PR objects. The dashboard PR has a `properties` key that the single-PR GET does not have. |
| Activity `action` values | CONFIRMED | Seen: `OPENED`, `COMMENTED`. Activity keys: id, createdDate, user, action, plus commentAction, comment for COMMENTED, plus commentAnchor, diff for an inline comment. |
| Activity `commentAction` values | DIFFERENT FROM BRIEF | Only `ADDED` was seen. Post, edit, and reply produce no `EDITED`, `REPLIED`, or `DELETED` activity. |
| Nested reply shape | CONFIRMED | A reply (POST with `parent: {id}`) gets no own activity. It appears in the parent's `comment.comments[]` in the activity and in `GET .../comments/{id}`. The reply has the same keys as a root comment and no `parent` field. |
| Comment `version` on edit | CONFIRMED | Post returns `version: 0`. `PUT .../comments/{id}` with `version: 0` returns 200 and `version: 1`, and `updatedDate` changes. The existing activity changes in place: new text, `version: 1`, `commentAction` stays `ADDED`. A PUT with the stale version returns 409 `CommentOutOfDateException`. |
| Delete call and deleted-comment shape | DIFFERENT FROM BRIEF | `DELETE .../comments/{id}?version=<current>` returns 204 with an empty body. Replies were deleted before their parent. After the delete, `GET .../comments/{id}` returns 404 with `errors[].message` only, no `exceptionName`. The comment activity disappears from activities. No tombstone and no `DELETED` activity exist. |
| Inline anchor, diffType COMMIT | CONFIRMED | `POST .../comments` with anchor {path, line, lineType: ADDED, fileType: TO, diffType: COMMIT, fromHash, toHash}: HTTP 201. fromHash and toHash came from the PR diff endpoint: fromHash = target head (`toRef.latestCommit`), toHash = source head. The response anchor adds `orphaned: false`. The activity has `commentAnchor` and a `diff` (destination, hunks, truncated, properties). |
| Inline anchor, diffType EFFECTIVE | NOT TRIED | The probe tries EFFECTIVE only when COMMIT fails. COMMIT passed. |
| `srcPath` | NOT TRIED | The sandbox PR has one MODIFY change and no rename. The response anchor has no `srcPath` key. |
| PR changes and per-file diff | CONFIRMED | `GET .../changes`: fromHash, toHash, values with `type` (MODIFY seen). `GET .../diff/<path>?contextLines=0`: keys fromHash, toHash, contextLines, whitespace, diffs, truncated. Segment `type` ADDED. Line keys: source, destination, line, truncated. |
| `refs/pull-requests/<id>/*` via `git ls-remote` | CONFIRMED | Exit 0 with the token in `GIT_CONFIG_*` `http.extraHeader`. Only `refs/pull-requests/<id>/from` is listed. Its hash equals `fromRef.latestCommit`. No `merge` ref is listed. A fetch was not tried. |
| PR URL forms | CONFIRMED | Project repo: `/projects/<KEY>/repos/<slug>/pull-requests/<id>`. Personal repo: `/users/<user slug>/repos/<slug>/pull-requests/<id>`, REST project key `~<USER SLUG>` (upper case), `project.type` PERSONAL. A trailing `/overview` parses. `links.self` uses the `/users/<slug>/...` form without `/overview`. |
| Existing Bitbucket MCP tools (BRIEF 10.6) | CONFIRMED | Schemas read, tools not called. `browse_repository` (project_key, repository_slug, path, at, start, limit). `create_pull_request_comment` (project_key, repository_slug, pull_request_id, text, parent_id, anchor, is_blocker, state). `edit_pull_request_comment` (project_key, repository_slug, pull_request_id, comment_id, version, text, is_blocker, severity, state). `get_file_content` (project_key, repository_slug, path, at). `get_projects` (name, permission, start, limit). `get_pull_request_activity` (project_key, repository_slug, pull_request_id, start, limit). `get_pull_request_comments` (project_key, repository_slug, pull_request_id, path required, start, limit). `get_pull_request_diff` (project_key, repository_slug, pull_request_id, path, src_path, since_id, until_id, context_lines, whitespace, with_comments). `get_pull_request_tasks` (project_key, repository_slug, pull_request_id, start, limit). `get_pull_requests` (project_key, repository_slug, state, start, limit). `get_repositories` (project_key, start, limit). `get_repository_branches` (project_key, repository_slug, filter_text, start, limit). `list_repository_files` (project_key, repository_slug, path, at, start, limit). No delete-comment tool. Comment write tools exist, so the review deny list must name them. |

## Gate v3, local

Status: DONE on Claude Code 2.1.295. B1 to B3 and B5 to B7 pass. B4 fails: `--no-session-persistence` still writes files, so the runner deletes them. B8 records facts. B9 passes with the WP8 flag set below.

Run: `bun scripts/gate/claude-checks.ts`. One check only: `--only B3`. Several: `--only B1,B6`. Preflight with no `claude -p` call: `--dry-run`. Then sanitize: `bun scripts/gate/sanitize-claude.ts`. It writes `fixtures/claude/` and exits 1 when a real value remains. The last run printed `hits=0`.

Each `claude -p` call uses `--model haiku`, stream-json, the prompt on stdin, the scrubbed env, and a temp folder. B1 to B8 use `--max-turns` 4 or less. B9 uses 8. The script checks `claude auth status` first and logs only `authMethod`. It never uses `--bare`. Raw output goes to `.gate0/v3-local/raw/` (gitignored). A full run writes `.gate0/v3-local/results.json`. A partial run writes `results.<checks>.json`, for example `results.b9.json`.

Cost limit: 14 calls for B1 to B8, a separate 2 calls for B9, and 0.60 USD per script run (sum of the reported result costs). The script stops at either limit. B1 to B8 used 14 calls and 0.0659 USD. B9 used 2 calls (one run each) and 0.0083 USD.

| Check | Calls | Result | Evidence |
|---|---|---|---|
| B1. Review agent: shell, Write, Read of a sibling folder | 1 | PASS | The subagent has no shell and no Write tool. The Read of the sibling folder is refused by `blockReadsOutsideWorkingDirectories`. No canary file, no leak. |
| B2. Block `general-purpose` and a user agent: `Agent(...)` deny, `Task(...)` deny, `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1`, `--agent` main thread | 4 | PASS | `--disallowedTools Agent(name)` refuses both. A `Task(name)` rule shows up as `Agent(name)`; the model did not try `general-purpose` there, so that variant is inconclusive. The env variable removes only built-in agents: the user agent still runs. `--agent rl-main` with the tool `Agent(rl-reviewer)` refuses both with "not found. Available agents: rl-reviewer". `init.agents` still lists `general-purpose`. |
| B3. Agent events, `task_*` events, result events, `structured_output`; also with `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` | 2 | PASS | Default: the subagent runs in the background ("Async agent launched"), and the run sends 2 result events, both with `structured_output`. The second has `origin.kind: task-notification`. With the env variable: foreground, 1 result event. Both runs send `task_started`, `task_progress`, `task_updated`, `task_notification`. |
| B4. `--no-session-persistence`: project folder, subagent output files, memory folders | 1 | FAIL | The run still writes `<projects>/<cwd>/<session>/subagents/agent-*.meta.json` (metadata, no transcript) and `%TEMP%\claude\<cwd>\<session>\tasks\<agent>.output`. `init.memory_paths.auto` points into the per-cwd project folder. The subagent Read of a file in the work folder was refused as "a suspicious Windows path". The cwd was the 8.3 short temp path. |
| B5. Errors: max turns, auth with an empty `CLAUDE_CONFIG_DIR` | 2 | PASS | Max turns: exit 1, result `error_max_turns`, `is_error: true`. Auth: `auth status` gives `loggedIn: false`; `-p` exits 1 with result subtype `success`, `is_error: true`, `terminal_reason: api_error`, cost 0. Detect auth failure by `is_error`, not by subtype. |
| B6. Hostile repository after the WP6 sanitize steps | 1 | PASS | Sanitize removes the link, `.claude`, `.mcp.json` (also nested) and renames CLAUDE files. Run: no hook, no canary, only `rl-stub` connected, the project MCP server never starts. |
| B7. Stub stdio MCP server from the main agent and a subagent | 1 | PASS | The main agent and the subagent both get the stub result. The server logs 2 calls. |
| B7 rerun with the WP7 git MCP server `rl-git` | 1 | PASS | `rl-git` connected. The main agent and a subagent each called `git_log`. 1 Haiku call, 0.0038 USD. |
| B8. `--restricted` with stream-json, `--json-schema`, the stub MCP server, and `rl-reviewer`; second call adds `--setting-sources user` and `--settings` | 2 | INFO | `--restricted` accepts all flags. Without `--tools`, `init.tools` still has Edit, Write, NotebookEdit, WebSearch, and other tools, so the runner needs `--tools`. `init.tools` names the agent tool `Task`; the tool_use name is `Agent`. A Read outside the cwd is refused by `--restricted`. No hook runs, also with `--setting-sources user`. The 4-turn cap gave `error_max_turns` and then `success`. |
| B9. WP8 flag set with a long-path cwd (see below) | 2 | PASS | See the B9 notes. |
| Permission modes: `--permission-mode` choices in `claude --help`, and `init.permissionMode` per call | 0 | INFO | Choices: acceptEdits, auto, bypassPermissions, manual, dontAsk, plan. `init.permissionMode` is `default` in every call, except `auto` in the B5 auth failure run. |
| CLI version (runner minimum) | 0 | PASS | 2.1.295. |

B9 notes:

- First try: FAIL. `--allowedTools mcp__rl-*` does not allow the stub tool. Both agents got "Claude requested permissions to use mcp__rl-stub__get_fact, but you haven't granted it yet". The `rl-main` tool list had no `StructuredOutput`, so `init.tools` had none and no result event had `structured_output`.
- Second try: PASS, with `--allowedTools Read,Grep,Glob,mcp__rl-stub` and `StructuredOutput` in the `rl-main` tools.
- `init.tools`: `Task, Read, Grep, Glob, mcp__rl-stub__get_fact, StructuredOutput`. `init.agents`: `claude, Explore, general-purpose, Plan, rl-main, rl-reviewer, statusline-setup`. `init.permissionMode`: `default`.
- Read inside the work folder: ran for `rl-main` and `rl-reviewer`. The long-path cwd removes the B3/B4 refusal.
- Read outside the work folder: refused for both ("is outside ... --restricted"). The secret text did not leak.
- Edit, Write, shell, WebSearch: `rl-main` tried Edit and Write and got "No such tool available". `rl-reviewer` did not try. No canary file, no edit.
- `general-purpose` and the user agent: refused, "not found. Available agents: rl-reviewer".
- Stub MCP tool: ran for both.
- Exactly 1 result event, with `structured_output`.
- Per-cwd files: `<projects>/<cwd>/<session>/subagents/agent-*.meta.json` and `%TEMP%\claude\<cwd>\<session>\tasks\<agent>.output`. After the deletion of both folders, nothing is left. The global `.claude.json` does not name the cwd.

Recommended WP8 runner command:

- Flags: `-p --output-format stream-json --verbose --restricted --strict-mcp-config --mcp-config <app file> --tools Read,Grep,Glob,Agent --allowedTools Read,Grep,Glob,mcp__<app server> --agents <file> --agent rl-main --json-schema <schema> --max-turns N --no-session-persistence`.
- `--allowedTools` names each app MCP server (`mcp__<server>`) or each tool. A prefix wildcard such as `mcp__rl-*` does not work.
- Agents file: `rl-main` tools are `Agent(rl-reviewer)`, Read, Grep, Glob, the app MCP tools, and `StructuredOutput`. `rl-reviewer` tools are Read, Grep, Glob, and the app MCP tools.
- Env: `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`. Remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.
- cwd: `realpathSync.native` of the work folder (long path, not 8.3).
- After each run, delete `<projects>/<encoded cwd>` and `<TEMP>/claude/<encoded cwd>`. The encoded name replaces every non-alphanumeric character with "-".

## Gate v3, Bitbucket

Status: PENDING. The probe is ready. No check has run on the real server yet.

Run these commands in order, on the designated test PR only:

1. Check the stored URL and token: `bun scripts/gate0/set-token.ts --check`.
2. Phase 1, read only: `bun scripts/gate0/bitbucket-probe.ts --pr ~USER/repo/1 --v3`. If every fetch attempt fails, run it again with `--ca-file <CA PEM file>`.
3. Phase 1, write: `bun scripts/gate0/bitbucket-probe.ts --pr ~USER/repo/1 --v3 --write`. It posts 3 inline comments and 1 BLOCKER task, then resolves the task. The comments stay until step 7.
4. Open the 2 links that phase 1 prints: the file line and the comment. Record whether each opens the right place.
5. Manual step a: in the web UI, select two or more lines in the PR diff and add one comment on that range.
6. Manual step b: push one commit to the PR source branch that changes the line that phase 1 names.
7. Phase 2, read: `bun scripts/gate0/bitbucket-probe.ts --pr ~USER/repo/1 --v3 --phase 2`.
8. Phase 2, cleanup: `bun scripts/gate0/bitbucket-probe.ts --pr ~USER/repo/1 --v3 --phase 2 --write`. It deletes every probe comment.
9. Delete your range comment by hand. Phase 2 prints its link. Revert the step b commit if the test branch needs it.
10. Sanitize: `bun scripts/gate0/sanitize-fixtures.ts`. It writes the v3 fixtures to `fixtures/bitbucket/` and must print `hits=0 structure diffs=0`.

Raw responses go to `.gate0/raw/v3-p<phase>-<step>.json` (gitignored). The phase state is `.gate0/raw/v3-state.txt`. Phase 1 with `--write` refuses to run while probe comments from an earlier run exist. The fetch uses a temp bare repository with `GIT_CONFIG_NOSYSTEM=1`, an empty global config, no credential helper, and `GIT_TERMINAL_PROMPT=0`. The token goes only into `http.extraHeader` through `GIT_CONFIG_*`. The probe tries the TLS settings in order (`isolated`, `schannel`, `ca-file`, `schannel+ca-file`) and stops at the first that works.

| Item | Status | Evidence |
|---|---|---|
| U1. Jira integration endpoint `GET /rest/jira/1.0/projects/{p}/repos/{r}/pull-requests/{id}/issues`: status, shape (key, URL), answer when the integration is off | PENDING | |
| U2. Range comment (manual step a): the anchor field for the range start | PENDING | |
| U3. COMMIT anchor with fromHash = merge base, toHash = source head: accepted, shown in the PR diff | PENDING | |
| U4. Inline comment on a CONTEXT line 3 lines from a change | PENDING | |
| Inline comment on a REMOVED line (lineType REMOVED, fileType FROM) | PENDING | |
| U5. File link `<repo browse link>/<path>?at=<hash>#<line>` and comment link `<PR link>/overview?commentId=<id>` open the right place. Repository and PR `links` | PENDING | |
| U6. Fetch of `refs/pull-requests/<id>/from` and the target branch with the token env: exit code, head hash, merge base, TLS setting that worked | PENDING | |
| U12. Orphaned comment after manual step b: `orphaned: true`, the diff hunk kept, the RESCOPED activity | PENDING | |
| U14. BLOCKER task: severity and state in the comment and in the activities, before and after resolve | PENDING | |
| U15. PR commits endpoint: fields, paging, order | PENDING | |
| APPROVED and REVIEWED activities | PENDING | Needs a second reviewer. Otherwise NOT TRIED. |

## Impact on BRIEF.md

Lines that the results confirm:
- 3.5 "`--setting-sources user` stops the project settings files and `.mcp.json`": confirmed (checks c and e).
- 3.5 "`claude -p` ... in an untrusted folder ... still uses project hooks": confirmed (check c, no flag). Also, project `.mcp.json` servers start without approval.
- 3.5 and 7 `blockReadsOutsideWorkingDirectories`: confirmed on 2.1.295 (check f).
- 7 "--json-schema puts the result in structured_output ... Confirm it with stream-json": confirmed. Only the `result` event carries it.
- 7 "Put `* -export-ignore -export-subst` into the cache's info/attributes ... (verify in Gate 0)": confirmed (check h).
- 7 "Secrets: Bun.secrets (experimental; verify on Windows ...)": confirmed on Windows. Linux is not checked.
- 7 "A profile can say 'use skill X' ... confirm user skills load with --setting-sources user": confirmed (check d).
- 7 Windows checks "start claude.exe, send the prompt on stdin, cancel a run": confirmed. Bun passes, so no Node fallback is needed.

Lines that need an edit:
- 3.5 line 101 and 7 line 311 ("It is not verified that project CLAUDE.md and skills stop too"). Proposed: "`--setting-sources user` stops project settings files, hooks, `.mcp.json`, CLAUDE.md, and skills (Gate 0, CLI 2.1.295). The snapshot steps stay as defense in depth, because this behavior can change between CLI versions."
- 7 line 313 deny list. Proposed: "Deny list (also when user settings allow more): Bash, Edit, Write, NotebookEdit, WebFetch, WebSearch, Agent, and every code-host write tool. Also pass `--tools` with the read-only built-in list, because `--allowedTools` does not limit the tool set (Gate 0: the model started a user subagent with `--allowedTools Read`)."
- 7 line 308 flags. Proposed: add `--tools <read-only built-ins>` to the flag list.
- 7 line 318 "Cancel kills the whole process tree. On Windows use taskkill /T /F with the PID." Proposed: "Cancel kills the whole process tree. On Windows use taskkill /T /F with the PID. In Gate 0, `proc.kill()` also ended the MCP child on Windows. The app does not depend on that."
- 7 line 308 `--max-turns <cap>`. Proposed: add "The cap is at least 2, because the `--json-schema` answer uses one turn."
- 7 line 317 "Map usage limit, auth error, and max turns to job states (verify values in Gate 0)". Partly done: success gives `subtype: success`, `terminal_reason: completed`. The error values are still not recorded.
- New for 3.5: "`--setting-sources user` still loads the user's CLAUDE.md, agents, plugins, hooks, and MCP servers, including claude.ai connectors. `--strict-mcp-config` removes the MCP servers. User CLAUDE.md and user hooks still apply to reviews."
- New for 3.5: "`claude auth status` prints the account email and organization. Log only `authMethod`."
- New for 7 snapshot: "Each run folder gets a folder under the user's Claude projects folder (`~/.claude/projects/<encoded cwd>/`). It holds the session transcript (`<session id>.jsonl`) and a `memory/` folder. The transcript holds the reviewed code. Decide between `--no-session-persistence` (not tested in Gate 0, blocks later resume) and cleanup of these folders." Gate 0 saw one such folder per run folder.
- New for 7 extraction: "Windows `tar.exe` extracts symlinks as real links. Reject link entries (tar typeflag 1 or 2) before or during extraction. Do not use the Git for Windows GNU `tar`."

Bitbucket lines that need an edit (Gate 0, Bitbucket Data Center 9.4.26):
- 7 line 281 "Not verified: the commentAction values ...": replace. Proposed: "Only `commentAction: ADDED` occurs. An edit changes the existing activity in place (new text, higher `comment.version`). A reply has no own activity. It is in the parent's `comment.comments[]`. A delete removes the activity. No tombstone exists. GET of a deleted comment returns 404."
- 7 line 288 "Activity IDs form a seen-set": a seen-set alone misses edits, replies, and deletes, because they create no new activity ID. Proposed addition: "On each poll, also compare `comment.version` and the nested `comment.comments[]` IDs inside seen activities."
- 7 line 292 "A tombstone needs a confirmed delete from the server": proposed: "A confirmed delete is absence from a complete activities fetch (all pages, `isLastPage: true`) plus 404 from `GET .../comments/{id}`."
- 7 line 294 "Reconcile followed threads from time to time": proposed: "Reconcile on every poll of a followed PR. Edits, replies, and deletes are visible only as comment changes."
- 7 line 278 inline comment: "diffType COMMIT with fromHash = target head and toHash = source head from the PR diff endpoint works (HTTP 201). The response anchor adds `orphaned`. EFFECTIVE and `srcPath` are still not verified."
- 7 line 280 "Edits and deletes need it": confirmed. Proposed addition: "A stale version returns 409 `CommentOutOfDateException`. Delete with `?version=<current>` returns 204. Delete replies before their parent."
- 7 line 286 paging: proposed addition: "On the last page, `nextPageStart` is absent or `null`. Accept both."
- 7 line 302 snapshot: "`refs/pull-requests/{id}/from` is listed by `git ls-remote` with `http.extraHeader`. No `merge` ref was listed. A fetch is still not tested."
- 7 line 315 deny list: "every code-host write tool" includes the existing MCP tools `create_pull_request_comment` and `edit_pull_request_comment`.
