# Changelog

## Unreleased

- The app is now named PR Review Inbox. Its old name was Kierto. The repository is now github.com/auric/pr-review-inbox. Your data, settings, and stored tokens stay.
- An Ask answer now shows Mermaid flowchart, sequence, and class diagrams as pictures, with "Show code" and "Copy code". A diagram that does not render shows its code and the first error line. Other diagram types show as code.
- The app now builds and runs on Bun 1.4.4. The third-party notices in Settings show the Bun 1.4.4 license. A database upgrade step that fails now stops the upgrade and keeps all data.
- "Include in runs" on a Jira attachment asks about your company AI policy only the first time. The new switch "Ask before Claude reads a Jira attachment" in Settings, Jira, brings the question back.

### Consult your session

- The copied points and the points of "Ask your session" sit in tags with a new random suffix each time. The prompt says that the tag content is data from the pull request, not instructions.
- "Paste the answer" is gone. Push the changes of your session, then use "Review changes since" and Draft replies.
- "Copy for your session" gives your own Claude Code session the open review points as numbered steps: check the branch, validate each point with file and line, fix only the valid parts, write a reply for each point, commit, and ask you before any push, post, or resolve.
- Cancel now stops an "Ask your session" run while it fetches the pull request. Before, the fetch could hold the run slot for minutes.

### Reviews

- After you discard a finding, its card offers the optional reasons "Not a bug", "Not worth fixing", "Duplicate", "Intended", and "Wrong place".
- Settings has a new "Review quality" table for the last 30 days. Each row shows one profile and prompt version: runs, shown findings per run, check results, accepted, discarded by reason, posted, addressed, outdated, median time, and cost per run.
- The "General" profile is now named "Review". It has a new prompt and runs at high effort. Its reviewer agents also run at high effort.
- A review now reports each problem with a title, a concrete case, a severity, and a confidence. It reports only what the change adds, and it skips style, linter output, and behavior that the pull request or the task asks for.
- "Review" checks security, threads and races, compatibility, the project rules, and the task goal. Each finding names the check that found it.
- Reviewer agents with "Auto" now join only a large change: 1,200 changed lines or 30 changed files. "Always" uses them on every change.
- Reviewer agents now read the pull request text, the task, and the earlier findings, as the main review does. They do not raise a finding that you discarded again.
- A CLAUDE.md in a folder of a changed file on the target branch now joins the project instructions. It applies only to the files in its folder.
- Improve prompt now knows the review checks and the new review rules, so the proposal does not repeat them.
- An update removes the shipped Security and Over-engineering profiles only when you never edited them. An edited one stays as your own profile.
- A review and "Review changes since" now read the answers to the questions that you posted. Each answered question gets one outcome.
- An answer that settles the question gets a reply draft, such as "Thanks, clear.", with "Resolve after posting" proposed. The box is ticked on threads that you started.
- A partial or unclear answer gets a reply draft with the next question. An answer that shows a real problem gets a new finding and a reply draft that points to it.
- The general comment with several questions gets one reply. It proposes the resolve only when every question is settled. Else the reply names the open questions.
- Unanswered questions get no draft. Every draft waits for your Accept. A draft that you edited, accepted, or discarded stays. When new messages came after your edited or accepted draft, the new reply waits under it as a revision.
- The run line counts the answered threads. Explain does not read the answers.
- An answered question about a finding counts as settled only when the head commit fixes the finding or the answer proves it wrong. A promise to fix it later gets a follow-up draft.

### Replies

- A reply that you posted from a reply draft now shows "Posted from a reply draft". "Posted from a Claude Code review" stays on posted review findings and questions.
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
- A reply draft says "Resolved since the draft" when someone resolved its thread after Claude drafted it. The post leaves that reply out until you reopen the thread.
- The post confirm lists the drafts that cannot post now, with the thread and the reason: new messages after the draft, a thread resolved since the draft, or a "Fixed in" commit that is not on the pull request yet. Post sends the other drafts. Before, one such draft stopped the whole post.
- An out-of-date reply draft no longer shows Accept or Edit, because it cannot post. The key a says why.
- A "Fixed in" draft whose commit left your branch, for example after a rebase or a squash, offers "Post as plain reply" in the post confirm.
- The post confirm groups the drafts that cannot post by reason. Each group says what to do. Each draft links to its thread and has its action: "Reply to the newest as is", "Reopen thread", or "Post as plain reply". Your accepted draft is never discarded there.
- The post confirm updates its lists when the drafts change while it is open. When the list to post changes, it asks you to read it again before you post.
- The post bar counts the out-of-date drafts. Ready to post also lists pull requests with only drafts that cannot post, with "N cannot post". Screen readers announce count changes.
- If the reply fails after the reopen, the post says so. Retry posts the reply without a second reopen.
- Claude never replaces a reply draft that you edited, accepted, or discarded. The run says "kept your draft" for that thread. Draft reply in that one thread replaces a discarded draft.
- "Draft again" on a draft that you edited or accepted is now "Revise my reply". Claude gets your text, keeps your points and tone, and changes only what the new messages need. The revision shows under your draft as a word diff against your text. "Use revision" makes it the draft, not accepted, and keeps your resolve tick. "Keep mine" drops it, and your exact text stays.
- Draft replies revises your out-of-date drafts the same way. Your current drafts stay as they are. The outcome line says "Revision waiting".
- "Reply to the newest as is" on an out-of-date draft answers the newest message with the same text. It runs no AI and keeps your accept. A thread resolved after the draft must open again first.
- A "No reply needed" draft of a reply run no longer counts as your decline. Draft replies now writes a new draft there when new messages arrive.
- A Fix commit keeps a reply draft that you edited or accepted. Its "Fixed in" text waits under your draft as a revision. Undo of a Fix commit brings back the draft that its "Fixed in" draft replaced.
- A "Fixed in" draft of an undone commit can no longer come back with Restore.
- Post again of a reply no longer fails when the pull request got new commits.
- When a fix run gives no fix for a thread, it drafts your answer to the commenter with the reason: already done, not valid, out of scope, or unclear. The draft says "from the fix run" and posts only after your Accept.
- An "already done" draft names the code that does it and proposes to resolve the thread. A choice that only you can make, or a risky fix, gets no draft.
- A fix run never replaces a reply draft that you edited, accepted, or discarded, or a "Fixed in" draft. Draft replies keeps a "Fixed in" draft and a draft of a fix run too. Draft reply in that one thread replaces them.
- A "Fixed in" draft keeps the answer that Claude drafted in the thread and adds "Fixed in X: <what the commit changes>".
- A Fix commit with only a part of the edits of a thread drafts "Partly fixed in X" and proposes no resolve.
- Draft replies sees the fix note, the fix commit, and the current draft of each thread. It no longer claims a fix without a commit.
- Each thread with a reply draft or a fix card shows one outcome line on top: Open, Answered, To fix, Fix proposed, Fixed in X, Partly fixed in X, Already done, Won't fix, Needs your decision, Follow-up asked, Settled, Waiting on them, or Resolved. Marks say "Out of date", "Resolved since the draft", "Waiting for push", or "Revision waiting".
- When the reply draft and the fix disagree, a note says so, for example a "Not valid" reply next to a ticked edit, or a valid reply next to "Already done". "Keep the reply" and "Keep the fix" settle it with one click.
- A session accept without a reply now says "To fix", not "No reply needed".
- Each reply draft names where it came from: the review, the reply run, your fix commit, the fix run, the re-review, or you.
- The Draft replies button counts only the threads that still need a reply: no draft yet, or a draft that is out of date and has no revision for the newest message.
- A "Fixed in" draft whose commit left your branch offers "Post as plain reply" on its card too.
- The inbox row says "N reply drafts out of date" when new messages or a resolve after the draft keep your reply drafts from posting. Groups and sort stay the same.
- A reply draft that you accepted or edited gives one notification, "1 reply draft out of date", when another person's message or resolve does that. It joins the new comments of the same check.
- A reply draft says "The code at this comment changed after this draft." when a push outdated the comment later. The outcome line says "Code changed". An untouched draft offers "Draft again". A draft that you accepted or edited offers "Show in diff". It never blocks the post.
- A reply draft in a thread whose messages are all deleted now says "Out of date".
- "Show history" in the More menu of a thread lists the thread in time order: the messages, the drafts of each writer, your changes to a draft with "Show changes", the revisions, the fix results and commits, the posts that did not finish, and the current resolve. Each line from Claude links to its run log. "Hide history" or Esc closes it.

### Fix

- When a fix run gives no fix, its card names the reason: Already done, Not valid, Out of scope, Unclear, Needs your decision, or Risky. When the fix run drafted your answer, the card says "Reply drafted" and takes you to the draft.
- "Needs your decision" shows the options of the fix run, with "Fix anyway" and "Don't fix…".
- When PR Review Inbox cannot apply any edit of a proposed fix, the card says "Edits could not be applied" with the reasons, and offers "Fix again" and "Copy prompt". It drafts no reply.
- "Don't fix…" on a proposed fix asks for your reason. It drafts a "Won't fix" reply and folds the proposal, also after a reload. Undo brings the proposal and the earlier reply draft back until the reply posts.
- The Fix list shows the fix outcome of each row: Fix proposed, Fixed in, Partly fixed in, Already done, Won't fix, Follow-up asked, Needs your decision, or Declined. A row without a fix or with a declined fix starts unticked.
- "Fix anyway" tells the fix run that you chose the fix, so it proposes edits despite the decision or risk note.
- A finding that your session rejected, with its fix edits still ticked, gets a note with "Keep the reject" and "Keep the fix".
- A fix run and an "Ask your session" fix change only the lines that the fix needs. They do not reformat or refactor other code.
- Commit refuses an edit that another fix commit of the same run already holds. Undo that commit first.

### Fixes

- After you resolve or reopen a thread, an edit of its first comment from before the resolve still arrives and shows as new.
- The next pull request opens at the top. A key press after a scroll no longer keeps the old position or marks messages below the fold as read.
- Cancel stops a review while it fetches the repository. A fetch can now take up to the 60-minute run limit, and a stopped fetch does not start a second one.
- A comment can no longer pose as another message in the pull request text that Claude reads.
- An invalid profile or rule in config.json no longer gets lost silently on the next save. PR Review Inbox keeps a copy in config.json.bak and logs what it ignored.
- A key that you press right after a dialog opens no longer acts on the page behind the dialog.
- Keyboard and screen reader fixes. When a sync puts a reply draft out of date, the focus moves from Accept or Edit to "Draft again", and the change is read out once. The "drafting a reply" line takes the focus from the button that started it. Small text buttons have a 24 px target. A discarded reply draft shows its full line on hover. A blocked clipboard shows the runner prompt in a field, selected for Ctrl+C. Failure messages name the next step. The post confirm says why Post is off.
- More small text buttons and links have a 24 px target, such as Restore, Move, the quote above a reply, "Go to the draft", Log, and the jumps under the pull request title. The layout does not move. More failure messages name the next step, such as a review or a question that did not start.
- Many open tabs no longer block each other. All tabs share one live connection, so a seventh tab loads and actions stay fast. When the tab with the connection closes, another tab takes it over.
- Slow actions no longer fail after 30 seconds with a lost connection. Examples are a Jira fetch, an attachment download, a settings save, Post, and Post again.
- When Bitbucket answers "too many requests" or "unavailable", the sync stops for this round and shows "The last check failed: Bitbucket asks to slow down." The next sync waits as long as Bitbucket asks. The check time stays at the last full sync.
- A followed pull request that was deleted on Bitbucket moves to the archive with its messages. The app no longer checks it each round.
- Merged and declined pull requests get a check for new messages at most once per hour.

### Runs

- The run row and the run log name the subagents of a run, with counts and models, for example "Subagents: rl-reviewer ×3 (claude-sonnet-5-5)".
- In the run log, each subagent row shows its model, tokens, and duration, with its tool calls nested under it. An agent that PR Review Inbox did not define shows "built-in".

### Safety

- A user-added MCP server that redirects to another host or port no longer connects. Give its final URL in Settings.

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
