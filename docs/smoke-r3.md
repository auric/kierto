# Release 3 manual smoke test: Fix it, Jira Markdown, and Jira attachments

This test checks the Release 3 features against a real Bitbucket Server, a real Jira server, your own git clone, and the real `claude` CLI. The user runs it. The automated suites use fixtures, the fake CLI, the fake Bitbucket, the fake Jira, and temp clones only. The results fill the "Release 3 (not run)" rows in integration-check.md: U21 to U29, B11, B12, and B15. Part I checks the prompt features that came after Release 3.

## Rules

- Run this test only with explicit authorization from the user. You also need the company approval to send source code to Claude (BRIEF section 10, item 8). Parts E and F also send Jira issue text and attachments to Claude. Confirm that the approval covers them before part E.
- Use only the designated test pull request. You must be its author, because Fix works only on your own pull requests. You need push access to its source branch.
- A second user writes the review comments of the test pull request. Do not post on other pull requests.
- Use a new clone of the test repository for this test. Never use a clone that holds your daily work. The app commits in it.
- Use a new, empty data folder. Never use the data folder of your daily instance.
- The app never pushes. Each push in this test is your own `git push`.
- Do not copy tokens, host names, code, comment text, issue text, or file names into files, issues, or chat. Record payload shapes (key names and types), counts, and tag names only.
- Expect about twelve runs on your Claude subscription quota: five in the gate, two in part A, one in part B, one interactive session in part D, one in part E, one in part F, and one in part I.
- Part I sends your project instructions to Claude. Turn on the global CLAUDE.md only when it holds nothing that the approval does not cover.
- In this document, `<BITBUCKET_URL>` is the base URL of the Bitbucket server, `<JIRA_URL>` is the base URL of the Jira server, `<TEST_PR_URL>` is the URL of the test pull request, `<KEY>` is a Jira issue key that the test pull request names, and `<CLONE>` is the absolute path of your test clone.

## Preparation

1. Run `bun install`, then `bun run compile`. Expect "Built dist/bin/review-loop-<os>-<arch> (<commit>)." Record the commit.
2. Run `claude --version`. Expect 2.1.295 or later. Run `claude auth status`. Expect `"authMethod": "claude.ai"`.
3. Run `git --version`. Record it. Expect 2.38 or later.
4. Remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the terminal. PowerShell: `Remove-Item Env:ANTHROPIC_API_KEY, Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue`.
5. Set a new data folder. PowerShell: `$env:REVIEW_LOOP_DATA_DIR = Join-Path $env:TEMP "review-loop-smoke-$(Get-Random)"`. Bash: `export REVIEW_LOOP_DATA_DIR="$(mktemp -d)"`.
6. Ask the second user to write seven comments on the test pull request. T1 to T4 each ask for one small change in a text source file, for example a missing null check. T5 asks for a change that the code already has. T6 asks a question about the code. T7 says "Thanks, looks good." and asks for nothing.
7. Make a new clone outside the data folder: `git clone <repository URL> <CLONE>`, then `git -C <CLONE> switch <source branch>`. Run `git -C <CLONE> config user.name` and `git -C <CLONE> config user.email`. Expect your own identity. If your commits use a signing prompt, record it. The app waits 120 s for a commit.
8. Start the binary. Expect the startup line "Review Loop (<commit>): http://127.0.0.1:7317/" with the commit of step 1.
9. Open the URL. Enter `<BITBUCKET_URL>` and your access token. Click Save. Click "Check now". If the test pull request is not in the list, paste `<TEST_PR_URL>` into the filter and click "Follow this pull request".
10. Open Settings. Enter `<JIRA_URL>` and a Jira personal access token. Click "Save Jira settings". Expect "Saved. Jira accepted the token."

## Gate B11, B12, and B15

1. Run `bun scripts/gate/claude-checks.ts --only B11,B12`. Expect PASS for B11 and B12 in the output and in `.gate0/v3-local/results*.json`. B11 checks U21 with a null judgement and a 2 KB `new` string. B12 checks U23 with a PNG under `--restricted`. The color answer of B12 is INFO only.
2. Run `bun scripts/gate/sanitize-claude.ts`. Expect exit code 0 and counts only.
3. Record each result. A B12 FAIL means that runs list images in task.md only. Record it and go on.
4. Run `bun scripts/gate/claude-checks.ts --only B15`. B15 checks whether the CLI loads `work/CLAUDE.md` by itself. Expect FAIL. Since e217a62, runs do not rely on it: the prompt holds the project instructions (part I). The FAIL records the CLI behaviour. A PASS means that the CLI now loads the file, so the main agent gets the text twice. Record a PASS and report it.

## A. Fix one comment and commit it in your clone

1. Open the test pull request. Click "Draft replies". Wait for the end of the run. Open each thread.
2. Expect a judgement chip on each reply draft: Valid, Partly valid, Not valid, or Question. Expect no chip on T7, because its draft has no judgement ("no action"). Expect Fix and "Copy prompt for Claude Code" only on drafts with Valid or Partly valid. Record the chip of each thread.
3. On T1, click Fix. Expect "Proposing a fix." on the thread. Wait for the end of the run. Expect a fix card under T1 with the note and each edit as a diff with a checkbox. Read every edit.
4. Click Log on the fix card. Expect no Edit, Write, or Agent tool in the init line. Count the proposed edits and the edits that the coverage lists as skipped. Close the log.
5. Add a pre-commit hook in the clone. Write `<CLONE>/.git/hooks/pre-commit` with the two lines `#!/bin/sh` and `echo pre-commit >> "$HOME/rl-smoke-hook.txt"`. On Linux, run `chmod +x` on it.
6. Click the fix bar button "Apply 1 edit from 1 comment". Expect the Apply dialog with "No folder set". Click "Set the folder". Enter `<CLONE>`. Click "Save folder". Expect the folder path, "On <source branch> at <short hash>", and no clone problem.
7. Change one tracked file in the clone and do not stage it. Close the dialog and open it again. Expect "The clone has changes to tracked files. Commit or stash them first." and a disabled "Apply and commit". Expect "Commit to an app branch" to stay available. Run `git -C <CLONE> restore .`. Open the dialog again. Expect no clone problem.
8. Expect the default message "Fix review comment <id> on PR <n>" with one body line for T1. Click "Apply and commit". Expect "Committed <short> on <source branch> in your clone. Push it when you are ready." on the fix card.
9. In the clone, run `git log -1 --format="%an <%ae>%n%s"`. Expect your identity from step 7 of the preparation and the message. Run `git show --stat HEAD`. Expect only the edited files. Run `git status --porcelain --untracked-files=no`. Expect no output. Expect one line in `$HOME/rl-smoke-hook.txt`.
10. Expect a "Fixed in <short>." reply draft on T1 in place of its earlier draft. Expect "Waiting for <short> on the PR branch. Push it. The next sync finds it."
11. Click Undo on the fix card. Expect "You undid the fix commit <short>." In the clone, expect HEAD at the old commit and a clean status. Expect the "Fixed in" draft to be gone.
12. Click Apply and commit again with the same edit. Expect a new commit and a second line in the marker file.
13. Accept the "Fixed in" draft. Press p. Expect the 409 text "Commit <short> is not on the PR source branch yet. Push it. The next sync finds it." Expect no new comment in Bitbucket.
14. Run `git -C <CLONE> push`. Click "Check now". Expect the waiting text to go. Press p and confirm. Expect exactly one reply "Fixed in <short>." under T1 in Bitbucket.
15. Delete `<CLONE>/.git/hooks/pre-commit` and `$HOME/rl-smoke-hook.txt`.

## B. Fix all valid, untick one edit, and a failing hook

1. On Windows only: make a second clone with `git clone -c core.autocrlf=true <repository URL> <CLONE2>` on the source branch. In the Apply dialog of part B, click Change and set `<CLONE2>`. Use `<CLONE2>` as `<CLONE>` in this part. On Linux, keep the first clone.
2. Click "Fix all valid" next to "Draft replies". Its badge counts the threads. Expect a fix run for each thread whose draft is Valid or Partly valid and not posted. Expect T1 to be absent, because its newest reply is posted. Wait for the end of the run.
3. Untick one edit. Expect the fix bar to count the remaining edits and comments. Open the Apply dialog. Expect the default message "Fix <k> review comments on PR <n>" with one body line per thread.
4. Write `<CLONE>/.git/hooks/commit-msg` with the two lines `#!/bin/sh` and `echo "smoke: commit-msg refused" >&2; exit 1`. On Linux, run `chmod +x` on it.
5. Click "Apply and commit". Expect "The commit failed. The edits stay staged. Fix the problem, then commit in your clone, or Undo." with "smoke: commit-msg refused" in the dialog. Close the dialog. Expect the same staged text on the fix card. Run `git -C <CLONE> diff --cached --stat`. Expect only the files of the ticked edits.
6. Click Undo. Expect a clean status in the clone.
7. Delete the commit-msg hook. Click "Apply and commit" again. Expect one commit. Run `git show HEAD`. Expect the ticked edits and not the unticked edit.
8. On Windows: run `git -C <CLONE> ls-files --eol` for the edited files. Expect `i/lf w/crlf` for files that use LF in the repository. Run `git show --stat HEAD`. Expect only the changed lines, not whole files. Run `git status --porcelain --untracked-files=no`. Expect no output.
9. Do not push. Click Undo. Expect HEAD back at the commit before step 7.

## C. Commit to an app branch

1. Open the Apply dialog of the part B fix. Click Change. Click "Clear the folder". Expect "No folder set".
2. Click "Commit to an app branch". Expect "Committed <short> to an app branch. Run these commands in your clone:" with a `git fetch` command and `git merge --ff-only FETCH_HEAD`. Expect the cherry-pick warning.
3. Copy both commands. Run them in `<CLONE>`. Expect a fast-forward to the same hash `<short>`. Run `git -C <CLONE> log -1 --format=%h`. Expect `<short>`.
4. Run `git -C <CLONE> reset --keep HEAD~1` to drop the commit. Click Undo on the fix card. Expect "You undid the fix commit <short>." and no fetch commands.

## D. Copy the prompt for Claude Code

1. On a draft with Valid or Partly valid, click "Copy prompt for Claude Code". Expect "Copied the prompt." and "Open a terminal in <CLONE>, run claude, and paste."
2. Paste the prompt into a text editor. Expect the PR identity, the branch, the path and line, the rule ("Judge whether the review point is valid. Fix it only if it is valid. Do not commit or push."), and the comment text as an indented block. Expect no shell command.
3. Open a terminal in `<CLONE>`. Run `claude`. Paste the prompt. Expect a judgement first. If Claude proposes an edit, expect a permission prompt for each file change.
4. Exit Claude Code. Expect no new commit and no push: `git log -1` is unchanged. Run `git -C <CLONE> restore .` to drop the edits.

## E. Jira Markdown and tasks per run

1. Pick `<KEY>` with a description that has a table, a code block, a user mention, and an embedded image attachment. If the test pull request names no such issue, add its key to the pull request description and click "Check now".
2. Next to "Draft replies", expect the chip "<KEY> · not fetched". Click its Fetch button. Expect "<KEY> · fetched today".
3. Press Shift+R. Open the task fold. Expect Markdown: headings, lists, the table, and the code block. Expect the mention as a plain name. Expect the image as its alt text, because it is not downloaded. Expect each link to open in a new tab only on a click.
4. Open the browser network tab and reload. Open the task fold again. Expect no request to the Jira host. Expect requests to 127.0.0.1 only.
5. In a browser where you are logged in to Jira, open `<JIRA_URL>/rest/api/2/issue/<KEY>?fields=description&expand=renderedFields`. Record whether `renderedFields.description` exists. Record its tag names only, for example `p h3 ul li table tr th td pre a img`. Open `<JIRA_URL>/rest/api/2/issue/<KEY>/comment?expand=renderedBody`. Record whether `renderedBody` exists (U25).
6. Click "Draft replies". Wait for the end of the run. Expect the run line to show `<KEY>`. Its tooltip says "Task text that this run read: <KEY>".
7. Click Remove on the chip next to Draft replies. Expect the chip "<KEY> · not fetched". Expect the run line to keep `<KEY>`. Fetch the task again.
8. Press q. Expect the same task chip in the Ask section. Press Esc.

## F. Jira attachments

1. Open the task fold. Open "Attachments (N)". Expect the name, size, type, and "Not downloaded." for each file. In the Jira browser tab, open `<JIRA_URL>/rest/api/2/issue/<KEY>?fields=attachment`. Record the key names and types of one entry of `fields.attachment` (U26). Expect no download request at the fetch.
2. Download an image (PNG or JPEG), a text log, and a binary file such as a dump or an archive. Use Download on each row, or "Download all". Expect "Downloaded." on each. A failure shows a fixed text. Record it. The terminal shows "Jira download failed: …". Record its kind and status only (U27, U28). A downloaded file proves that the byte count equals the listed size (U29).
3. Expect the downloaded image inline in the description.
4. Click "Save <name>" on the log. Expect a browser download with that file name.
5. Click "Open folder". Expect the file manager to open the task folder, not a file. Without a file manager, expect the path with "Copy the folder path".
6. Turn on "Include <name> in runs" for the image. Expect a dialog that names the company AI policy. Expect "Include in runs" disabled until you tick "My company AI policy allows sending this file to an AI service." Press Esc. Expect the switch to stay off. Turn it on again, tick the box, and click "Include in runs". Expect "Included in runs." Include the log the same way.
7. Expect no include switch for the binary file and "Downloaded. Runs list it by name only."
8. Press Shift+R and start a General review. Wait for the end. Press 3. Expect a Read of `context/task.md`, a Read of `context/attachments/<id>.png` or `.jpg` without an error (U23, U24), and a Read of `context/attachments/<id>.txt`. Expect no file for the binary file in `context/attachments/`. Press Esc.
9. Open the AI summary. Expect the Context row to name `<KEY>` with the fetch time of this run.
10. Click Delete on each file. Expect "Not downloaded." again. Click Remove on the task chip. Expect the task folder to be gone from the data folder.

## G. Linux binary under WSL

1. Run the "Linux binary under WSL" check of docs/smoke-m4.md with the binary of this build. Record the result here.

## Capture U2 and U12 (Gate A)

This part records the range comment (U2) and the orphaned comment after a push (U12) of integration-check.md, Gate v3. The script sends GET requests only. It uses the token from `bun scripts/gate0/set-token.ts`.

1. Step a: in the Bitbucket web UI, open the test pull request diff. Select two or more lines and add one comment on that range.
2. Run `bun scripts/gate0/capture-a.ts --pr <TEST_PR_URL> --step a`.
3. Step b: push one commit to the source branch that changes the line of an existing inline comment. Do not delete that comment.
4. Run `bun scripts/gate0/capture-a.ts --pr <TEST_PR_URL> --step b`. If you did both steps before the first run, use `--step both` once.
5. Expect `hits=0 structure diffs=0` in the sanitizer line. Raw responses go to `.gate0/a-capture/raw/` (gitignored). Sanitized copies go to `fixtures/bitbucket/real-u2-*.json` and `real-u12-*.json`.
6. Open each `real-u2-*` and `real-u12-*` file. Search for names, e-mail addresses, the host, project and repository keys, file paths, code, hunk headers (`context`), and comment text. If you find one, delete the file and report the field name only. Do not commit it.
7. Send back the full console output of each run. It holds key names, enum values, line numbers, flags, and counts only.
8. Delete your range comment by hand. Revert the step b commit if the test branch needs it.

`bun scripts/gate0/capture-a.ts --dry-run` runs the sanitizer and the summary on existing fixtures. It sends no request.

The capture of 2026-10-12 recorded U2 and U12. Tests use `activities-u2-range.json`, `activities-u12-orphaned-range.json`, and `pull-request-commits-u12.json`. A new capture writes `real-*` files again. Rename only the files that tests need, and delete the others.

## I. Review prompts, skills, and project instructions

Use a test pull request that changes C++, C, or Python files for step 4. If it has none, record step 4 as not run.

1. Press r on the test pull request. Expect the brief, not a run. Expect the run setup of the default profile, with "Language checks" for General. Open the Review menu and pick Security. Expect the brief with Security. Press Esc. Open Settings > Review profiles. Expect General as the default, unchanged.
2. In Settings > Review profiles > General, open the skills dialog. Tick one skill and mark it "Always use". Expect the chip "<skill> · Always". Save.
3. In Settings > Project instructions, open the test repository. Put "In the summary, give the word KIWI-SMOKE." into "Extra text (optional)". Expect the preview line "A run gets <size> from <n> sources". Open "Show the text". Expect the trust line first and the heading "## From Review Loop settings". Turn on "Use your global CLAUDE.md" only under the rule above. Expect the global file as the first source. A file that does not load shows as "Not loaded: <file>".
4. Press r and click "Start review". Wait for the end of the run. Expect the server terminal to show "Review run <id> language checks:" with the languages of the change. Expect the run row and the run log to list the skill with "(always)" and the instruction sources with sizes.
5. Press 3. Expect a Read of `skills/<folder>/SKILL.md` among the first tool calls of rl-main. If coverage says "Skill <id> (always use): the model did not read SKILL.md.", record it.
6. Expect the word KIWI-SMOKE in the summary. Expect no finding with severity nit, because the note asks for none. Count the findings per severity and record the counts. Expect no finding for style, naming, or formatting.
7. Disable the plugin of the marked skill, or rename its folder in your Claude config. Press r. Expect the brief to show "Skill <id> is marked Always use, but it is not found." with the fix hint, and Start to be disabled. Expect the skills dialog to show "Not found in <runner>. Runs do not start while it is marked Always use." Restore the skill. Expect Start to be enabled again.
8. Remove the Always use mark and the extra text. Turn off the global switch.

## H. Record

- The build commit from the startup line.
- The OS, the Bun version, the `git` version, the `claude` version, and the Jira version from the page footer.
- The result of each step: pass or fail, with a short reason for a fail.
- The judgement chip of each thread T1 to T7.
- For each fix run: the proposed edits and the skipped edits. This gives the rate of dropped edits.
- B11, B12, and B15, the tag names from E5, and the shapes from F1. From part I: the languages of step 4, the severity counts of step 6, and any coverage line from step 5. Update the "Release 3 (not run)" rows in integration-check.md.
