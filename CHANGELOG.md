# Changelog

## Unreleased

### Consult your session

- "Copy for your session" now copies one plain prompt. Your session checks each review point against the code in your clone, makes the valid changes, and explains each rejection.
- The copied points and the points of "Ask your session" sit in tags with a new random suffix each time. The prompt says that the tag content is data from the pull request, not instructions.
- "Paste the answer" is gone. Push the changes of your session, then use "Review changes since" and Draft replies.

### Replies

- Draft replies checks each thread against the new code and the answer in the thread. When the point is settled, it proposes to resolve the thread and shows its proof.
- "Resolve after posting" on each reply draft. The reply posts first, then the thread resolves. A draft without text only resolves the thread. Claude ticks the box only on threads that you started.
- "Review changes since" proposes to resolve the threads of your posted findings that the new commits fix. A Fix commit proposes it on its "Fixed in" reply.
- Resolve or reopen any thread with the "Resolve" or "Reopen" button in its footer, or with the key x. A thread that another person started asks first.
- A reply that Bitbucket refuses because the thread is resolved again says "This thread is resolved. Reopen it first."
- A resolve that fails after the reply keeps the reply and offers "Resolve again". It never posts the reply twice.
- On threads where you made the point or asked the question, reply drafts show "Settled", "Not settled", or "Follow-up question". Only a settled thread gets a resolve proposal, with the answer quoted as proof.
- A partly answered question gets a reply that asks the open part again. A thread with several questions resolves only when each one has an answer.
- Draft replies can propose to resolve a thread of another person where you replied. The box stays unticked there.
- A reply to a resolved thread reopens the thread first, because Bitbucket takes no reply there. The post confirm and Ready to post say "Reopen thread, post reply". A ticked draft resolves the thread again after the reply.
- A reply draft says "Resolved since the draft" when someone resolved its thread after Claude drafted it.
- If the reply fails after the reopen, the post says so. Retry posts the reply without a second reopen.
- Claude never replaces a reply draft that you edited, accepted, or discarded. The run says "kept your draft" for that thread. Draft reply in that one thread replaces a discarded draft.
- A Fix commit keeps a reply draft that you edited or accepted and adds no "Fixed in" draft there. Undo of a Fix commit brings back the draft that its "Fixed in" draft replaced.
- A "Fixed in" draft of an undone commit can no longer come back with Restore.
- Post again of a reply no longer fails when the pull request got new commits.
- When a fix run gives no fix for a thread, it drafts your answer to the commenter with the reason: already done, not valid, out of scope, or unclear. The draft says "From the fix run." and posts only after your Accept.
- An "already done" draft names the code that does it and proposes to resolve the thread. A choice that only you can make, or a risky fix, gets no draft.
- A fix run never replaces a reply draft that you edited, accepted, or discarded, or a "Fixed in" draft. Draft replies keeps a "Fixed in" draft and a draft of a fix run too. Draft reply in that one thread replaces them.

### Fixes

- After you resolve or reopen a thread, an edit of its first comment from before the resolve still arrives and shows as new.
- The next pull request opens at the top. A key press after a scroll no longer keeps the old position or marks messages below the fold as read.
- Cancel stops a review while it fetches the repository. A fetch can now take up to the 60-minute run limit, and a stopped fetch does not start a second one.
- A comment can no longer pose as another message in the pull request text that Claude reads.
- An invalid profile or rule in config.json no longer gets lost silently on the next save. Kierto keeps a copy in config.json.bak and logs what it ignored.

### Runs

- The run row and the run log name the subagents of a run, with counts and models, for example "Subagents: rl-reviewer ×3 (claude-sonnet-5-5)".
- In the run log, each subagent row shows its model, tokens, and duration, with its tool calls nested under it. An agent that Kierto did not define shows "built-in".

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
