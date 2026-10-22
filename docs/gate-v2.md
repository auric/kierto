# Gate v2: CLI and Bitbucket facts for review v2 and task building

This gate records facts that review v2 and the task builder need (docs/plans/review-v2/tasks.md, WP-G0). You run each check on your own machine. B17 to B20 use your Claude Code login. G1 to G7 write to a Bitbucket test repository.

| Checks | Run before | Script |
|---|---|---|
| B18, B20 | WP-R3 | `scripts/gate/claude-checks.ts` |
| B17 | WP-B3 | `scripts/gate/claude-checks.ts` |
| B19 | No fixed point. The part budgets of spec.md section 6.7 use it. | `scripts/gate/claude-checks.ts` |
| G1 to G3 | WP-B1 | `scripts/gate/bitbucket-write.ts` |
| G4 to G6 | WP-B8 | `scripts/gate/bitbucket-write.ts` |
| G7 | No fixed point. INFO only. | `scripts/gate/bitbucket-write.ts` |

## Record the results

Record each result in the "Review v2 (not run)" rows of integration-check.md. Replace "not run" with the status, the date, and the CLI version. Paste the evidence line of the check. Never paste a host, a user name, a project key, or a path.

## Part B: Claude checks B17 to B20

### Before you run

1. Run `claude auth status`. The script stops when `authMethod` is not `claude.ai`.
2. Run the dry run: `bun scripts/gate/claude-checks.ts --dry-run --only B17,B18,B19,B20`. It builds the fixtures and prints the planned argv. It starts no model call.

### Run

- All four: `bun scripts/gate/claude-checks.ts --only B17,B18,B19,B20`.
- One check: `bun scripts/gate/claude-checks.ts --only B18`. Bare IDs also work: `bun scripts/gate/claude-checks.ts B18 B20`.
- Then sanitize: `bun scripts/gate/sanitize-claude.ts`. It must print `hits=0`. It lists the new raw files as "Not mapped to a check".

### Cost caps

- Every call uses `--model haiku` and at most 4 turns. B19 uses 1 turn.
- Own call caps: B17 1, B18 1, B19 1, B20 5. They do not count against the cap of 14 calls of B1 to B8.
- The run stops before the next call when the result events report 0.60 USD or more in total.
- Each call has a time limit of 180 s. The script kills the process tree at the limit.
- The script removes every temp folder and its per-folder Claude Code project data at the end.

### Output

- The console shows one line per check. `.gate0/v3-local/results.<checks>.json` holds the same lines.
- `.gate0/v3-local/raw/` holds the raw stream of each call. Raw files hold local paths and account data. Do not commit them. The console and the results file show the home folder as `~`.

### What PASS means

| Check | What it runs | PASS |
|---|---|---|
| B17 | An implement run: `--tools Read,Grep,Glob,Edit,Write`, the same `--allowedTools`, `--restricted`, `--strict-mcp-config`, the implement schema, no `--permission-mode`. The prompt asks for three writes: `./repo/a.txt`, `../outside.txt`, and an absolute temp path. | `repo/a.txt` exists. The other two files do not exist, and the run tried to write both. init lists only the five tools and StructuredOutput. |
| B18 | A verify run: `--effort medium`, an agents file with `rl-verifier` at effort high, and the verify schema. The main agent gives one candidate to `rl-verifier`. | The run exits 0, the CLI accepts both effort values, `rl-verifier` runs, and `structured_output` parses with the verify schema. |
| B19 | One short run on your subscription login. | INFO only. Record whether the result event has `total_cost_usd`, and record the `usage` keys and the `modelUsage` fields. Task part budgets use cost only when it is present (spec.md section 6.7). |
| B20 | One run each with the explain, discuss, interview, spec, and implement schemas, under the runner flag set of B11. | Each `structured_output` parses with its zod schema. |

A FAIL of B17 with "not tried" for a write means that the model skipped it. Run B17 again. Any other B17 FAIL blocks WP-B3: write runs need another confinement.

The script holds its own draft-07 copies of the five new schemas and the verify schema, from spec.md sections 1.6, 2.4, 3.3, and 6.5. WP-R1 and WP-B0 move them to `src/shared`.

## Part G: Bitbucket checks G1 to G7

These checks write to the server. Run them only on a test repository that you may change. This is a separate authorization: the script refuses to write without `--authorize-writes` and a repository URL on the command line. It has no default host.

### Before you run

1. Pick a test repository and a base branch, for example `main`. Copy the repository URL from the browser: `https://<host>/projects/<KEY>/repos/<slug>` or `https://<host>/users/<you>/repos/<slug>`.
2. Give the script a token with Repository write on the test repository. Use one of these:
   - `bun scripts/gate0/set-token.ts`. The script sends this token only to the stored URL origin.
   - The environment variable `GATE_BITBUCKET_TOKEN`. Set it in your own terminal only.
3. For G2, pick one reviewer user slug. For G3, pick a commit with build statuses. For G7, pick a Jira key that the app links.
4. Optional, for G1: put a read-only token into an environment variable, for example `GATE_READONLY_TOKEN`.
5. Run the dry run: `bun scripts/gate/bitbucket-write.ts --dry-run`. It runs all steps against a loopback fake server and a local bare repository. It reads no secret, and nothing leaves the machine. It must print `dry run: PASS`.
6. If every request fails on TLS, set `NODE_EXTRA_CA_CERTS` to your CA PEM file.

### Run

- Before WP-B1: `bun scripts/gate/bitbucket-write.ts --repo <URL> --target main --authorize-writes --only G1,G2,G3 --reviewer <slug> --build-commit <commit> [--readonly-token-env GATE_READONLY_TOKEN]`
- Before WP-B8: `bun scripts/gate/bitbucket-write.ts --repo <URL> --target main --authorize-writes --only G4,G5,G6`
- G7: `bun scripts/gate/bitbucket-write.ts --repo <URL> --target main --authorize-writes --only G7 --jira-key <KEY-123>`. Then sync the app, open the PR that the script names, and record whether the PR row and the PR view show the task chip.
- Remove what G7 left, or what a stopped run left: `bun scripts/gate/bitbucket-write.ts --repo <URL> --authorize-writes --cleanup`.
- `--keep` leaves all gate branches and PRs in place for a look on Bitbucket. Remove them with `--cleanup`.

### Safety rules of the script

- Every branch that the script pushes or deletes starts with `rl-gate-`. The script never pushes the target branch.
- Every push uses `--force-with-lease`. A new branch uses an empty lease.
- The token goes only to the origin of `--repo`. The script refuses a clone link with another origin before it pushes.
- git runs with an empty global config, no system config, no credential helper, and no prompt. The token goes in the `http.extraHeader` config of the child process only.
- At the end, the script declines its PRs and deletes its branches, except the G7 branch and PR.
- The console and `.gate0/bitbucket-write/result*.json` hold only status codes, booleans, key names, enum-like strings, counts, and gate branch names. git messages pass as markers, such as `[rejected]` and `(stale info)`.

### What each check does

| Check | What it does | PASS |
|---|---|---|
| G1 | Reads the repository clone links. Pushes a new branch with an empty lease. With `--readonly-token-env`, pushes one more new branch with the read-only token. | An http clone link with the server origin, the push exits 0, and the remote branch is at the pushed commit. The read-only push line is INFO: record its exit code, markers, and HTTP status. |
| G2 | Creates a PR from the G1 branch to the target with one reviewer. | HTTP 201 with an ID, a version, and 1 reviewer. |
| G3 | Reads the build stats of the new commit (no builds) and of `--build-commit`. | Both HTTP 200 with the numbers `successful`, `inProgress`, and `failed`, and the build commit has at least one build. Without `--build-commit`, the result is INFO. |
| G4 | Creates a stacked PR (upper branch to lower branch). Sends a PUT with the version and a new `toRef` (the target), then a PUT back. | The PUT gives HTTP 200 and the PR targets the target branch. Record "title unchanged" and the reviewer counts: they show whether a PUT without these fields keeps them. |
| G5 | Deletes the lower branch, which is the target of the stacked PR. Reads the PR for up to 30 s. | The delete exits 0 and the PR read gives HTTP 200. Record the outcome: the state (DECLINED or OPEN) and the toRef (lower branch, target branch, or other). |
| G6 | Moves the remote upper branch, then pushes another commit with the old lease. | The move exits 0, the second push fails with `(stale info)`, and the remote keeps the moved commit. |
| G7 | Creates a PR with the Jira key in its title and keeps it. | INFO. Record whether the app shows the task chip after a sync. |
