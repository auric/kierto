# Review eval cases

These cases measure how well a review finds real bugs and how much noise it adds. docs/plans/review-v2/spec.md section 4.3 is the spec. The code is in `scripts/eval/`. All code in the cases is synthetic. It holds no real names, hosts, or paths.

## Baseline run (gate G-EVAL-0)

Run this once on the current prompts (prompt version 1), before any review v2 prompt change lands:

```
bun run eval -- --real --cases all --repeat 2
```

- Profile: the shipped `general` profile, unedited. The harness never reads your own config or profiles. Model and effort stay unset, so your CLI default applies. The result file records the model and the effort of each run.
- Runs: 12 cases x 2 repeats = 24 review runs, one after the other in the one run slot.
- Time and cost: not measured yet. This run measures them. design.md section 5.1 estimates 5 to 12 minutes for one finder pass on a 500-line change. Plan for 2 to 4 hours and a large part of a daily plan quota.
- Before the run: `claude` is on PATH (the native `claude.exe` on Windows), and `claude auth status` shows `authMethod` `claude.ai`. The harness checks this and stops on a mismatch.
- Ctrl+C stops after the current case. A second Ctrl+C quits at once and stops the CLI. The result file gets each case as it ends, so a stopped run keeps its finished cases.
- PASS: a result file with all 12 cases. The run prints its path.

Each run uses the review pipeline of the app: a sanitized snapshot of a temp git repository, the auth route check, the scrubbed env, and no `--bare`. The harness serves the repository through the `gitRemote` option and keeps its data in a temp folder with memory secrets. No run reaches Bitbucket or your data folder.

## Compare a later run

Run the same command on the new head, then compare the two files:

```
bun run eval:compare eval-results/<baseline>.json eval-results/<new>.json
```

It prints one table per metric with the delta, for all cases and for each case. It warns when a case changed between the two files; the numbers of such a case do not compare. Use the same CLI default model for both runs.

## Options

- `--real`: run the `claude` CLI on PATH. Without `--real` or `--runner`, the harness prints the plan and exits with code 2.
- `--cases all` or `--cases id,id`: the cases to run. Default: all.
- `--profile <id>`: a shipped review profile. Default: `general`.
- `--modules a,b` and `--volume quiet|balanced|thorough`: profile fields of prompt version 2. Prompt version 1 refuses them.
- `--repeat N`: runs of each case, 1 to 10. Default: 1.
- `--out <folder>`: the folder for the result file. Default: `eval-results/` in the repository, which git ignores.
- `--keep`: keep the temp folders of each case for a look at the run.
- `--runner <command> <args...>`: run another CLI, such as the fake CLI of the tests. It must come last. Give absolute paths, because the CLI starts in the run folder. On Windows the command must end in `.exe`. Example: `--runner C:/path/to/bun.exe D:/path/to/tests/support/fake-claude.ts D:/path/to/scenario.json`.

## Metrics

- An item matches a bug or a trap when the path and the side are the same and the line ranges overlap, both ends included.
- Shown items: the main list of the run. Prompt version 1 has no verify phase, so it shows each finding. Version 2 uses the volume rules of spec.md section 1.4.
- recall: bugs with a shown match, over all bugs.
- precision: shown items that match a bug, over shown items.
- trap rate: shown items on a trap that match no bug, over all traps.
- noise: shown items that match no bug and no trap, per case.
- severity ok: found bugs whose best shown match has at least the minimum severity, over found bugs.
- candidate recall: bugs that any item matched, refuted and duplicate items included. It shows what a verify phase lost.
- Each number is the mean over the repeats, with the min and the max.

## Cases

| Case | Seeds |
|---|---|
| `ts-cache-race` | A race: a missed lookup caches a row after an update deleted the key. An off-by-one in the cache size limit. Traps: a caught fire-and-forget refresh with a guard, and staleness that the PR text names. |
| `ts-orders-search` | SQL injection through the sort direction. A missed caller: the daily report still passes page numbers to `listOrders`, which now takes an offset. Traps: status values that an allowlist guards, and an API change that the PR text names. |
| `ts-upload-audit` | A temp file leak on the early 415 return. A task requirement that the code misses: no audit event. Traps: short names (style only), and a Content-Length check that the stream limit backs. |
| `ts-settings-api` | About 500 changed lines, for timing. A renamed field in the `/v1` response. A rule of the scoped `src/api/CLAUDE.md` broken: a body read by hand. An unchecked error: a missing overrides file. Traps: the removal of `/v0` that the PR text names, and a route parameter that the route pattern guards. |
| `cpp-job-queue` | Two races: a wait without a predicate loop, and a stop flag read without the mutex. Traps: a helper whose contract says the caller holds the lock, and dropped jobs that the PR text names. |
| `cpp-packet-parser` | An off-by-one: a 32-byte label writes its NUL past the field. An unchecked error: the checksum read. Traps: a subtraction that an earlier size check guards, and noisy casts (style only). |
| `cpp-log-rotate` | A `FILE*` leak on an early return. A missed caller: `main()` still expects `openLog` to throw, but it now returns null. Traps: 5 archives instead of 10, as the PR text says, and a lint suppression with a reason. |
| `cpp-engine-abi` | A struct field inserted in the middle of a public C ABI struct. A rule of the scoped `include/CLAUDE.md` broken: an exception leaves a C ABI function. A task requirement that the code misses: the version query needs an engine. Trap: a worker limit that the PR text names. |
| `py-report-sql` | SQL injection through the region. An unchecked error: the exit code of `wkhtmltopdf`. Traps: an `int()`-guarded limit, and rounding to whole euros that the PR text names. |
| `py-downloader-race` | A race: a counter updated outside the lock, so `run()` can wait forever. A response leak on an early return. Traps: a helper whose contract says the caller holds the lock, and a content type filter that the PR text names. |
| `py-pager-client` | An off-by-one in the retry loop, so the last failure never raises. A missed caller: the sync job still starts at page 1 after pages moved to count from 0. Traps: fewer retries, as the PR text says, and one-letter names (style only). |
| `py-export-rules` | A rule of the scoped `app/handlers/CLAUDE.md` broken: the handler reads `os.environ`. A task requirement that the code misses: soft-deleted accounts are exported. A CLI flag renamed with no alias, so the nightly script fails. Trap: new columns that the task names. |

## Case format

Each case folder holds:

- `case.json`: the PR title and text, the optional task text (it becomes `context/task.md`), the optional project rules text (it becomes the extra instructions of the repository), the bugs, and the traps. Each bug and trap names a path, a side, and a line range on that side. `scripts/eval/cases.ts` has the schema.
- `base/`: the files of the base commit, which is also the target branch. A `CLAUDE.md`, `CLAUDE.local.md`, or `AGENTS.md` file is stored with the suffix `.fixture`, so Claude Code sessions in this repository never load it as instructions. The harness writes it under its real name into the temp repository. The loader refuses such a file without the suffix.
- `head.patch`: a unified diff that `git apply` applies to `base/`. Make it with `git diff --no-renames` in a scratch repository.

To add a case, keep 150 to 500 changed lines, 1 to 3 bugs, and 1 or 2 traps. Then run `bun test tests/eval`. It applies each patch, checks the changed-line count, and checks that each bug and trap range holds text on its side.
