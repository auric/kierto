# Changelog

## 0.2.0

The first public version. Kierto is a local-first inbox for Bitbucket Server and Data Center pull requests, with AI reviews by your own Claude Code CLI.

### Inbox

- One inbox for every open pull request that needs you, with unread marks and a reason per row.
- Per-message tracking of new comments, edits, replies, and deletions. Read state survives restarts.
- One notification when someone replies to you or pushes new commits.
- Follow any pull request: paste its URL into the filter.
- Full keyboard control. Press `?` for the list. Below 760 px, one pane shows at a time.

### Reviews

- Claude Code reviews a sanitized snapshot of the pull request and reads the whole repository, not only the diff.
- The review brief holds the task, your note, the profile, and the run setup. A review starts only from the brief.
- Review profiles set the prompt, model, effort, reviewer agents, skills, and MCP servers. General, Over-engineering, Security, and Explain ship with the app. "Improve prompt" shows its changes before you apply them.
- Each run can read the CLAUDE.md files of your clone, extra text from Settings, and your global CLAUDE.md. Settings shows the full text a run gets.
- The review record counts findings per severity and lists what was not checked. The run log shows each tool call of the review and its subagents.
- Review only the commits since the last review.

### Drafts and posting

- Each finding becomes a draft with its code, severity, and evidence. Accept, edit, or discard each one.
- Post the accepted drafts as inline comments after a confirm. Only you see drafts until you post them.

### Replies

- Draft replies judges each thread where it is your turn: valid, partly valid, not valid, or a question. You edit each reply and post it.

### Fix

- On your own pull request, the Fix list holds the open threads and the review findings.
- A read-only run proposes exact edits for the ticked points. You review each edit. Apply commits the edits into your clone. You push.

### Ask and sessions

- Ask a question about a pull request. The answer stays in Kierto.
- Consult the Claude Code session that wrote the code. Kierto resumes a forked, read-only copy of it on your own pull request.
- "Judge and propose fixes": your session judges each item and proposes edits for the ones it accepts. Kierto checks the edits and shows them as fix cards marked "from your session".
- "Copy for your session" gives the same review points as text.

### Settings

- Bitbucket URL and token, with a connection test before save.
- Optional Jira connection, so the review brief can fetch the task text.
- Clones, review profiles, project instructions, and the session switch.
- About shows the version, the license, and the third-party notices.

### Safety

- The server listens on 127.0.0.1 only. It checks Host and Origin, and each change needs a session token.
- Tokens go into the OS secret store, never into the database, logs, URLs, or prompts. `REVIEW_LOOP_SECRETS=memory` keeps them in memory only.
- Reviews use your claude.ai login. Kierto removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the child process.
- Claude never runs in your clone and never posts. Nothing goes to Bitbucket until you click. Kierto never pushes.
