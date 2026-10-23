# Build a Jira task manual smoke test

This test checks "Build a Jira task" (review v2 part 6) against a real Bitbucket Server, a real Jira server, a personal test repository, and the real `claude` CLI. The user runs it. The automated suites use the fake Bitbucket, the fake Jira, the fake CLI, and a local git remote only (`tests/e2e/task-small.e2e.ts`). Part S is Gate US of docs/plans/review-v2/tasks.md: a small task from the Jira key to the pull request. Parts M (medium task) and L (large task) come with the later work packages.

## Rules

- Run this test only with explicit authorization from the user. You also need the company approval to send source code and Jira task text to Claude (BRIEF section 10, item 8).
- Use only a personal test repository. You own it, it holds no work of other people, and you have push access. The inbox must know it: it shows under Repositories in the sidebar after the first check of a pull request in it.
- Use small Jira tasks that you write for this test. Each task changes one source file and adds or changes one test.
- Use a new, empty data folder. Never use the data folder of your daily instance.
- Nothing goes to Bitbucket before "Push and open PR". Check Bitbucket after each part.
- Do not copy tokens, host names, code, task text, or file names into files, issues, or chat. Record counts, times, states, and the shape of the sentences only.
- Expect about twenty runs on your Claude subscription quota: about six in part S, five in part P, seven in part R, and four in part D. A run is one interview, one plan, one tests step, one code step, one fix, or one own review.
- In this document, `<BITBUCKET_URL>` is the base URL of the Bitbucket server, `<JIRA_URL>` is the base URL of the Jira server, `<REPO>` is the test repository as `<project>/<repo>`, `<TARGET>` is its default branch, and `<KEY1>` to `<KEY4>` are the keys of the four Jira tasks.

## Preparation

1. Run `bun install`, then `bun run build`. Run `git rev-parse --short HEAD`. Record the commit.
2. Run `claude --version`. Record it. Run `claude auth status`. Expect `"authMethod": "claude.ai"`.
3. Run `git --version`. Record it. Run `git config --global user.name` and `git config --global user.email`. Expect your own identity. The commits of a task use the identity of the clone that the app has for the repository, else this global identity.
4. Remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the terminal. PowerShell: `Remove-Item Env:ANTHROPIC_API_KEY, Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue`.
5. Set a new data folder. PowerShell: `$env:REVIEW_LOOP_DATA_DIR = Join-Path $env:TEMP "review-loop-task-smoke-$(Get-Random)"`. Bash: `export REVIEW_LOOP_DATA_DIR="$(mktemp -d)"`.
6. Run `bun run start`. Expect "PR Review Inbox (source): http://127.0.0.1:7317/".
7. Open the URL. Enter `<BITBUCKET_URL>` and your access token. Click Save. Click "Check now". Expect `<REPO>` under Repositories in the sidebar. If it is missing, open a pull request in `<REPO>` and click "Check now" again.
8. Open Settings and go to the section "Jira". Enter `<JIRA_URL>` in "Jira URL" and your token in "Personal access token". Click "Save Jira settings". Expect "Saved. Jira accepted the token."
9. Write four small Jira tasks for `<REPO>`: `<KEY1>` to `<KEY4>`. Each one names one source file and the behavior to change. `<REPO>` has its own test command, for example `bun test`, `npm test`, or `pytest`.

## S. A small task from the key to the pull request (Gate US)

1. Click "Tasks" in the sidebar. Click "Build a Jira task". Type `<KEY1>` in "Jira key". Pick `<REPO>` in "Repository". Click "Build this task". Expect the Task view with the steps "Questions › Plan › Build › Done" and the Tasks row "Reading the task". A pull request that names `<KEY1>` has a "Build" button on its task chip ("Build this task: `<KEY1>`"). That button opens the same task, not a second one.
2. Expect "Claude is reading the task and the code." Then expect "Claude has `<n>` questions before it writes the plan." with the button "Answer `<n>` questions" and the row "Needs you: answer the questions". When Claude asks nothing, go to step 4.
3. Expect each question to say "Why it matters: …". The recommended option starts selected and has the mark "Recommended". Click "Answer `<n>` questions". Expect the focus on the first question. Click "Send answers". Record the count of questions.
4. Expect "Claude is writing the plan." and the row "Writing the plan". Then expect "The plan is ready: small, 1 PR, about `<n>` changed lines." with the button "Approve the plan" and the row "Needs you: approve the plan". Expect "Claude proposes: small." and the option "Small: one PR with a short plan and the code." selected. The Spec tab shows `specs/<KEY1>/plan.md`. The Plan tab says "The build has not started. The plan has these tasks:". Record the line estimate and the count of tasks. If Claude proposes medium or large, record the size and the rule lines, and stop part S.
5. In the section "Branch", expect "The change goes to `feature/<KEY1>-<slug>`". The slug is the Jira summary in lowercase ASCII letters, digits, and hyphens, at most 40 characters. Expect "If a branch with this name exists, the app adds -2, -3, and so on."
6. Click "Change the prefix". Expect the focus in "Branch prefix". Type `bad..` and press Enter. Expect "Invalid branch prefix." Type `smoke/`. Expect the name `smoke/<KEY1>-<slug>` at once. Press Enter. Expect the field to close, the focus on "Change the prefix", and no approval. The prefix applies to this task only. If `<REPO>` has a branch named `smoke`, git cannot make `smoke/…`: use another prefix.
7. In "Commands that the app runs after each step", expect the commands of the plan. Untick every command with the mark "Test". Click "Approve the plan". Expect "Pick at least one test command. The build runs it to see failing and passing tests." Tick only the test command of `<REPO>`.
8. Expect the box "Before the first build in this repository" with the picked command and "I understand". Click "Approve the plan". Expect "Read the warning and tick “I understand” first." Tick "I understand". Click "Approve the plan".
9. Expect the step "Build" and the row "Building part 1 of 1". Expect sentences such as "Claude is writing the tests.", "Running the tests.", "Claude is writing the code of task T1.1.", and "Claude checks its own change." The box shows "Your change", "Tasks: `<done>` of `<n>` done", and "Lines: `<n>` of 400". Check Bitbucket: no new branch exists yet.
10. Open the Log tab. The newest step is at the top. Expect, from the bottom: "Commit plan", "Tests P1", "Checks P1" with "Red as expected", "Commit P1", "Code T1.1", "Checks T1.1" with "Done", "Commit T1.1", "Checks checks" with "Done", and "Own review". "Checks T1.1" can say "Skipped" with a note when the app cannot narrow the test command to the tests of the task. "Red as expected" means that the new tests failed before the code existed. Each command shows its arguments, "exit `<code>`", and its time. Click a command to see its output. Record the count of "Fix" steps.
11. Expect "Your change is ready and checked by Claude." with the button "Open the PR" and the row "Needs you: open the PR". When the own review left small points, they show with "Fix the small points too". Open the Diff tab. Expect only the plan file, the test file, and the source file of the task.
12. Open the same task in a second browser tab. In the first tab, click "Open the PR". Expect the dialog "Push `<branch>` and open a PR into `<TARGET>`?" with "The app pushes only this branch, and only now. It never pushes to `<TARGET>`.", "Title: `<KEY1>`: `<summary>`", the file and line counts, and "Reviewers". Add no reviewer. Click "Push and open PR".
13. Expect "Pushing the branch." and "Opening the PR." They can pass quickly. Then expect "Waiting for the review of your PR. Nothing to do." with the button "Go to the PR", the box "PR #`<n>` from `<branch>` into `<TARGET>`.", and the row "Waiting for review". Expect the second tab to show the same state and the same PR number without a click. The app answers each later "Open the PR" request of this part with the same PR.
14. Open Bitbucket and check these facts:
    - The task branch is `smoke/<KEY1>-<slug>`, or that name with `-2` when the name existed before.
    - Exactly one new pull request exists. It goes from the task branch into `<TARGET>`.
    - The title is "`<KEY1>`: `<summary>`". The description has the goal, "Acceptance:", "Tests:", and "The plan: specs/`<KEY1>`/plan.md". It starts with 🤖 when Settings, Posts, has "Mark Claude-drafted comments with 🤖" on.
    - The commits are "`<KEY1>`: Add the plan", "`<KEY1>` P1: Add the failing tests of part 1", and "`<KEY1>` T1.1: `<task title>`", and a fix commit for each fix that changed files, all with your name and email.
    - `<TARGET>` has no new commit. No other branch is new.
15. In the Task view, open "More actions" and click "Close the task". Expect "Closed. The branches and PRs stay as they are." and no main button. Expect the row "Closed" in the group "Done". Check Bitbucket: the branch and the pull request still exist.

## P. Pause, Stop, and Resume

1. Start `<KEY2>` as in S1. Click "Use the recommended answers". Approve the plan with the test command. The warning of the first build does not show again.
2. While a sentence says "Claude is writing …", open "More actions" and click "Pause after this step". Expect, after the step ends: "Building is paused after the step. Continue?" with the button "Continue" and the row "Needs you: a question". Click "Continue". Expect the build to go on with the changes of the done step.
3. While Claude writes in a later step, open "More actions" and click "Stop". Expect "Stopped at: task T1.1, writing the code." or the words of that step, the button "Resume", and the row "Stopped". The Log shows the stopped step as "Cancelled".
4. Click "Resume". Expect the stopped step to start again from the last commit. The changes that the stop left are in `<data folder>/tasks/<database name>/<task ID>/patches/<step ID>.patch`. Record whether that file exists and is not empty.
5. Click "Stop" again. Open "More actions" and click "Close the task". Check Bitbucket: no branch `smoke/<KEY2>-…` and no pull request exist.

## R. Tests that stay red, and the line limit

1. Start `<KEY3>`. Make a test that the code cannot pass. For example, before the approval, click Edit on the Spec tab and add a test to task T1.1 that expects a result that the task forbids. Approve the plan.
2. Expect "Needs you: the tests of part 1 stay red after 3 tries." with the button "See why" and the row "Needs you: tests stay red". The Log shows three "Fix" steps, each one with a "Checks" step after it with "Failed". Click "See why". Expect the focus on the last red "Checks" step. Check Bitbucket: nothing is new.
3. The line limit is 400 changed lines by default. When a change goes over it, expect "Needs you: this PR would have `<n>` changed lines, over your 400 limit." with the button "Keep one PR". "More actions" then has "Change the limit", with the field "New line limit for this task" and "Save the limit". A one-file task stays under the limit. Record "not reached" in that case.
4. Click "Stop", then "Close the task" in "More actions".

## D. A file that the app does not commit

1. Start `<KEY4>`. In the note of a question, write: "Also add the line smoke to CLAUDE.md in the repository root." When Claude asks nothing, click Edit on the Spec tab and add the same line to task T1.1. Approve the plan.
2. Expect "Needs you: the step changed CLAUDE.md, which Claude may not change. The app undid the step and saved a patch." with the button "Resume" and the row "Needs you: a file the app does not commit".
3. Expect the box to show "Files that the app does not commit: CLAUDE.md" and "The worktree went back to the last commit. The changes are saved in `<step ID>`.patch. Resume starts the step again." The Log shows the step as "Failed" with "CLAUDE.md: A step may not change this path."
4. When Claude does not write the file, record "not written" and the reason from the notes of the step in the Log.
5. Click "Stop", then "Close the task" in "More actions". Check Bitbucket: nothing is new.

## Record

- The commit of preparation step 1, the OS, the Bun version, the `git` version, and the `claude` version.
- The result of each step: pass or fail, with a short reason for a fail.
- From part S: the count of questions, the line estimate and the real changed lines, the count of tasks, the count of "Fix" steps, and the count of own-review points by severity.
- From part S: the time and the turns that the Plan tab shows for the part, and the time from "Build this task" to "Open the PR".
- Every stop for a file that the app does not commit, with the path type only (for example "a CLAUDE.md file").
- From parts P, R, and D: each expected stop as seen, not seen, or not reached.
- Clean up: delete the `smoke/` branches and the pull request on Bitbucket, close the Jira tasks, and delete the data folder.
