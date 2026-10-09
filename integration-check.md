# Gate 0 integration check

Status: local checks done on 2026-10-09 (Windows 11). Bitbucket checks are pending. Raw evidence is in `.gate0/local/` and `.gate0/raw/`. Both folders are gitignored.

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

All items are PENDING. Run these steps in order:

1. The user stores the URL and token in their own terminal: `bun scripts/gate0/set-token.ts`. Check with `bun scripts/gate0/set-token.ts --check`. Remove with `--clear`.
2. Read-only probe: `bun scripts/gate0/bitbucket-probe.ts --pr PROJECT/repo/1`. A personal repository uses `--pr ~USER/repo/1`. A full PR URL also works, but its origin must equal the stored URL origin.
3. Write probe on the designated test PR only: `bun scripts/gate0/bitbucket-probe.ts --pr ~USER/repo/1 --write`. It deletes every comment it creates.

| Item | Status | Source |
|---|---|---|
| Bitbucket version (application-properties) | PENDING | read probe |
| Current user from the `X-AUSERNAME` header | PENDING | read probe |
| Dashboard paging fields (isLastPage, nextPageStart, size, limit, start) | PENDING | read probe |
| Activity `action` and `commentAction` values, nested replies in `comment.comments`, comment `version` type | PENDING | read probe |
| PR changes and per-file diff shape, one ADDED line | PENDING | read probe |
| `git ls-remote` of `refs/pull-requests/<id>/*` (BRIEF 10.2) | PENDING | read probe |
| General comment post, edit with version, stale-version edit | PENDING | write probe |
| Reply with parent id, nested reply shape | PENDING | write probe |
| Inline anchor with `diffType: COMMIT`, fallback `EFFECTIVE` | PENDING | write probe |
| Delete with version, deleted-comment shape, commentAction after each step | PENDING | write probe |
| Existing Bitbucket MCP tool names (BRIEF 10.6) | PENDING | not in the probe |

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
