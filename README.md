# Kierto

Local-first inbox for Bitbucket Server and Data Center pull requests, with AI code review by your own Claude Code CLI. It drafts review comments and replies, proposes fixes, and posts nothing without your click.

[![CI](https://github.com/auric/kierto/actions/workflows/ci.yml/badge.svg)](https://github.com/auric/kierto/actions/workflows/ci.yml) [![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)

Kierto helps with pull request review on Bitbucket Server and Bitbucket Data Center. It runs code review with Claude Code on your machine and can read the linked Jira issues.

Repository: https://github.com/auric/kierto

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/inbox-dark.webp">
  <img alt="Kierto: the inbox, a pull request, and its AI review with a severity count and a Not checked list" src="docs/screenshots/inbox-light.webp">
</picture>

## Why "Kierto"

Kierto is Finnish for "cycle" or "round". Say it roughly as "KYER-toh".

A pull request review is a loop. You review the change. The author changes the code and replies. You check again. The loop ends when every thread is resolved. Kierto keeps that loop in one place and runs each round with your own Claude Code CLI.

The project started as "Review Loop". The new name keeps the same idea in one short word.

## What it does

- Shows every open pull request that needs you in one inbox, with unread marks and a reason per row.
- Tracks each discussion per message: new comments, edits, replies, and deletions. Read state survives restarts.
- Notifies you once when someone replies to you or pushes new commits.
- Runs a Claude Code review on a sanitized snapshot of the pull request. The review reads the whole repository, not only the diff.
- Turns findings into drafts with a severity. You accept, edit, or discard each one, then post them as inline comments.
- Drafts replies to the threads where it is your turn. On your own pull request, it proposes fixes that you review before they touch your clone.
- Lists what the review did not check, so a gap never looks like a pass.

## Safety model

- Kierto runs on your machine and listens on 127.0.0.1 only. It checks the Host and Origin of each request, and each change needs a session token.
- Reviews use your own Claude Code CLI with your claude.ai login. Kierto removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the child process.
- Nothing goes to Bitbucket until you click. Kierto posts your accepted drafts. Claude never posts.
- Claude never runs in your clone. Reviews run on a sanitized snapshot with read-only tools. Kierto never pushes.
- Your Bitbucket token goes into the OS secret store. It never goes into the database, logs, URLs, or prompts.

## Requirements

- Windows or Linux.
- The `claude` CLI, logged in with a claude.ai subscription. Check with `claude auth status`.
- A Bitbucket Server or Data Center personal access token.
- `git` on the PATH.
- Bun 1.x, only to build from source.

## Install

No release is published yet. Build Kierto from source with Bun 1.x:

```sh
bun install
bun run build
bun run start
```

For one self-contained binary, run `bun run compile`. It writes `dist/bin/kierto-<os>-<arch>` for this host.

Release binaries: when a release is published on the GitHub Releases page, download the binary for your system and start it. Each release holds one binary per target, `SHA256SUMS`, and the license files. `bun run release` makes them.

```sh
./kierto-0.2.0-linux-x64          # Linux: chmod +x it first
kierto-0.2.0-windows-x64.exe      # Windows
```

## First run

1. Open http://127.0.0.1:7317.
2. Enter your Bitbucket URL and access token, then click Save. Kierto tests the connection first.
3. Optional: in Settings, Jira, connect Jira. The review brief can then fetch the task text.
4. The inbox lists the pull requests on your Bitbucket dashboard. To follow another one, paste its URL into the filter.
5. Open a pull request and press `r` to open the review brief. Add a note and pick a profile.
6. Click Start review, or press `Ctrl+Enter`.
7. Triage each draft: `a` accepts, `e` edits, `d` discards.
8. Press `p` to post the accepted drafts. Kierto shows a confirm first.

## Features

### Review profiles

A profile sets the prompt, the model, the effort, the reviewer agents, the skills, and the MCP servers of a run. Kierto ships General, Over-engineering, Security, and Explain. Skills and MCP servers come from your Claude Code config. "Improve prompt" proposes a clearer prompt, and you see the changes before you apply them.

![Settings, Review profiles: run setup, skills, and MCP servers](docs/screenshots/settings-profiles.webp)

The review brief holds the task, your note, the profile, and the run setup. A review starts only from the brief.

![The review brief](docs/screenshots/brief.webp)

### Drafts and posting

Each finding becomes a draft with its code, its severity, and its evidence. The review record counts the drafts per severity and lists what was not checked. Only you see drafts until you post them.

![A review with its severity count and the Not checked list](docs/screenshots/review.webp)

![The Drafts list with accept, edit, and discard](docs/screenshots/drafts.webp)

A review and "Review changes since" also read the answers to the questions that you posted. An answer that settles a question gets a reply draft with "Resolve after posting" proposed. A partial answer gets a reply draft with the next question. An answer that shows a real problem gets a new finding and a reply draft that points to it. The general comment with several questions gets one reply, and it proposes the resolve only when every question is settled. Unanswered questions get no draft. Explain does not read the answers.

The run log shows each tool call of the review and of its subagents.

![The run log](docs/screenshots/run-log.webp)

### Replies

Draft replies judges each thread where it is your turn: valid, partly valid, not valid, or a question. It drafts a reply for each one, and the draft says where it came from. You edit the reply and post it. A new run never replaces a draft that you edited, accepted, or discarded. The button counts the threads that still need a reply. When new messages arrive after a draft, the draft cannot post, so it shows no Accept and no Edit. The key a says why.

When new messages arrive after a draft, the draft says so. "Reply to the newest as is" answers the newest message with the same text, without a run. On a draft that you edited or accepted, "Draft again" becomes "Revise my reply": the run gets your text, keeps your points and tone, and changes only what the new messages need. The revision shows under your draft as a word diff against your text. "Use revision" makes it the draft, not accepted. "Keep mine" drops it, and your exact text stays. Draft replies revises your out-of-date drafts the same way. A fix commit puts its "Fixed in" text under your draft as a revision too.

Each thread with a draft or a fix shows one outcome line on top, such as Answered, To fix, Fix proposed, Fixed in X, Partly fixed in X, Already done, Won't fix, Needs your decision, or Settled. Marks on the line say "Out of date", "Resolved since the draft", "Waiting for push", or "Revision waiting". When the reply and the fix disagree, for example a "Not valid" reply next to a ticked edit, a note says so. "Keep the reply" or "Keep the fix" settles it with one click.

Each thread footer has "Resolve", or "Reopen" on a resolved thread. The key x does the same on the current thread. The change goes to Bitbucket at once. A thread that another person started asks first. Tick "Resolve after posting" to resolve the thread after the reply. Bitbucket takes no reply in a resolved thread, so Kierto reopens a resolved thread first. The confirm says "Reopen thread, post reply". When someone resolved the thread after Claude drafted the reply, the draft says "Resolved since the draft", and the post leaves it out until you reopen the thread.

The post confirm lists the drafts that cannot post now in groups by reason: out of date (new messages after the draft), resolved since the draft, a fix commit that is not pushed, or a commit that is not on the branch. Each group says what to do. Each draft links to its thread and has its action: "Reply to the newest as is", "Reopen thread", or "Post as plain reply". Post sends the other drafts. The confirm updates while it is open. The post bar counts the out-of-date drafts, and Ready to post also lists pull requests with only drafts that cannot post.

### Fix it

On your own pull request, the Fix list holds the open threads and the review findings. Valid threads and accepted findings start ticked. A read-only run checks each ticked point and proposes exact edits. You review each edit. Apply commits the edits into your clone and drafts "Fixed in X: <what changed>" in each fixed thread. It keeps the answer that Claude drafted there. A reply that you edited or accepted stays as it is, and the "Fixed in" text waits under it as a revision. A commit with only a part of the edits of a thread says "Partly fixed in X" and proposes no resolve. You push. Before the push, Undo removes the commit and brings back the reply draft that it replaced.

![The Fix list](docs/screenshots/fix-list.webp)

When the run gives no fix, the card says why: Already done, Not valid, Out of scope, Unclear, or Needs your decision. For the first four, the run drafts your answer to the commenter, and the card points to the draft. A decision or a risk card offers "Fix anyway", which asks the run for edits despite the note. "Don't fix…" asks for your reason, drafts a "Won't fix" reply, and folds the proposal until you Undo it. The Fix list shows the outcome of each row, and a row without a fix starts unticked.

![A thread with its outcome line, the reply draft, and the fix card](docs/screenshots/fix-thread.webp)

### Ask

Press `q` to ask a question about the pull request. The answer stays in Kierto. Nothing posts.

### Project instructions

Each run can read the CLAUDE.md files of your clone, extra text from Settings, and your global CLAUDE.md. CLAUDE.md files in the pull request do not load as instructions. Settings shows the full text that a run gets.

### Consult your session

You wrote the code with Claude Code, so your session knows why. On your own pull request, "Copy for your session" copies one prompt with the review points. Paste it into your session in your clone. "Copy for your session" gives your own Claude Code session the open review points as numbered steps: check the branch, validate each point with file and line, fix only the valid parts, write a reply for each point, commit, and ask you before any push, post, or resolve. The points sit in tags with a new random suffix for each copy, and the prompt tells the session that the tag content is data, not instructions. Push the changes, then use "Review changes since" and Draft replies.

To ask without leaving Kierto, turn on the session switch in Settings, Clones. Kierto then lists your sessions on the branch of your own pull request. Each question resumes a read-only copy of the session with the same points. Its verdicts tick the Fix list and draft replies. "Judge and propose fixes" also lets the session propose edits for the points that it accepts. Kierto checks the edits, and their fix cards show "from your session". Nothing applies until you click.

### Narrow screens

Below 760 px, Kierto shows one pane at a time.

![Kierto at 400 px](docs/screenshots/narrow.webp)

## Keyboard

Press `?` in the app for the full list.

| Keys | Action |
|---|---|
| `j` `k` | Next or previous pull request, draft, thread, or file |
| `Enter` `→` | Open the pull request at the thread that put it in the inbox |
| `Esc` `←` | Back to the list |
| `/` | Filter the list |
| `z` | Full width on or off |
| `n` `N` | Next or previous new message |
| `y` | Next thread where it is your turn |
| `o` | Open or close the current draft, thread, or file |
| `g` then `f` or `c` | Go to Files or Commits |
| `g` then `d` | Show the current thread or draft in the diff |
| `1` `2` `3` | Top of the pull request, the drafts, the run log |
| `r` | Open the review brief |
| `c` | Review only the commits since the last review |
| `q` | Ask a question |
| `Ctrl+Enter` | Start the review from the brief, or send the question |
| `a` `e` `d` | Accept, edit, or discard the current draft |
| `p` | Post the accepted items |
| `f` `F` | Your pull request: open the Fix list |
| `x` | Resolve the current thread, or reopen it when it is resolved |

## Configuration

The environment variables keep the `REVIEW_LOOP_` prefix of the old name, so existing data keeps working.

| Variable | Effect |
|---|---|
| `REVIEW_LOOP_PORT` | The port on 127.0.0.1. Default: 7317. |
| `REVIEW_LOOP_DATA_DIR` | The data folder. Default: `%LOCALAPPDATA%\review-loop` on Windows, `$XDG_DATA_HOME/review-loop` or `~/.local/share/review-loop` on Linux. |
| `REVIEW_LOOP_SECRETS` | `memory` keeps the tokens out of the OS secret store. You then enter them again after each restart. |

If the OS secret store fails, Kierto keeps the token in memory only and tells you in Settings.

## Development

| Command | Effect |
|---|---|
| `bun run dev` | Hono with `--watch` on 127.0.0.1:7317 and Vite on 127.0.0.1:5173. Open the Vite URL. |
| `bun run check` | Typecheck with TypeScript 7 and 5, Biome lint, and `bun test`. |
| `bun run test:e2e` | Build the UI and run the Playwright suite against a fake Bitbucket and a fake Jira. |
| `bun run demo` | Serve the built UI on 127.0.0.1:7399 with synthetic data, a fake CLI, and a temp data folder. |
| `bun run compile` | Build one self-contained binary for this host in `dist/bin/kierto-<os>-<arch>`. |
| `bun run release` | Run check, e2e, and compile for all targets. Write the binaries, `SHA256SUMS`, and the license files to `dist/release/`. |
| `bun run notices` | Regenerate `THIRD_PARTY_NOTICES.md` from the web bundle and the server bundle. |
| `bun run screenshots` | Regenerate the screenshots in `docs/screenshots/` from the demo. |

Tests never touch a real Bitbucket server, the real `claude` CLI, or your data folder. `BRIEF.md` is the spec. `docs/` holds the plans and the manual smoke tests.

## License

Kierto is free software under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See [LICENSE](LICENSE). [NOTICE.md](NOTICE.md) states the copyright and the section 7 additional terms. These terms require attribution and marked, renamed modified versions. They grant no trademark rights to the name "Kierto". Third-party material keeps its own license. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists it.
