# Thread outcome plan: one outcome per thread

Status: code complete, 2026-10-20. Every WP is done. Section 7 lists the later items. Section 8 adds the revisions and Reply to the newest as is (user decision C+D, 2026-10-20). Section 9 adds the answers to your posted questions in a review run (user decision, 2026-10-20). Sections 10 (thread history) and 11 (out-of-date draft alerts) are done, 2026-10-21. Line references point to the code at HEAD 0db727e.

## 1. Goal

- Each thread shows one outcome line. The line comes from the reply draft, the fix note, the fix commit, and the thread state.
- The app derives the outcome in the UI. No migration: the new facts are JSON fields of the fix note and the reply payload.
- A user choice always wins over an AI writer.

## 2. Problems

Already landed: 0fe5659 keeps drafts that the user edited or accepted on AI runs and fix commits, restores the replaced draft on Undo (fix.replaced), refuses Restore for a draft of an undone commit, reopens a resolved thread before a reply, and marks "Resolved since the draft" (threadOpen). 0db727e removes Paste the answer.

| ID | Problem | Status |
|---|---|---|
| P1 | A note with fixed false shows only the card "No fix proposed" (FixCard.tsx:219). It makes no reply draft. The reason is written for the user, not for the reviewer (review.ts fixThread, catalog.ts:344-359). | Landed: WP-S1 makes the nofix draft from the note reply (jobs.ts judgeFix). WP-U1b labels the fix card with the why and points to the draft (FixCard.tsx). |
| P2 | A note with fixed true loses all its edits in validateFix, so validateFix removes the note (fix.ts:108). The reason shows only in the coverage. The pending card lives only while the page is open (fix/model.ts:297-301, FixBar.tsx:123). | Landed: WP-S1 keeps the note with why dropped and drops (fix.ts validateFix). WP-U1b shows "Edits could not be applied" with the drops, Fix again, and Copy prompt. |
| P3 | The fix card has no Discard. An untick lives only in memory (FixBar.tsx:124). A reload ticks the newest run again (fix/model.ts:210-213). | Landed: WP-S2 stores a decline on the note (declined) and Apply refuses its edits. WP-U1b adds "Don't fix…" with a reason, the stored fold, and Undo. An untick still lives only in memory. |
| P4 | A commit discarded edited or accepted drafts, and Undo did not restore them. | Landed in 0fe5659 (fix-routes.ts:203-206, 366-370, items.ts:51-53) |
| P5 | A commit replaces an untouched AI answer with "Fixed in X." (fix-routes.ts:207-210). A commit with only a part of the edits of a thread still says fixed and proposes resolve (fix-routes.ts:222). | Landed: WP-S2 keeps the answer, adds "Fixed in X: <what>", and gives "Partly fixed in X" without resolve. |
| P6 | Draft replies discarded edited, accepted, and "Fixed in" drafts. | Landed: 0fe5659 protects edited and accepted drafts. WP-S1 keeps an untouched "Fixed in" or nofix draft on Draft replies (jobs.ts writerRank, end). |
| P7 | The reply card and the fix card show side by side and can disagree (useReview.tsx:505-519). | Landed: WP-U1a adds the outcome line on top of the AI area and the conflict note with "Keep the reply" and "Keep the fix" (review/outcome.ts). |
| P8 | A session accept without a reply gives "No reply needed" with the chip "Valid" (consult.ts:517, ReplyDraft.tsx:196-210, review/model.ts:520). The outcome must be "To fix". | Landed: WP-U1a. The outcome line and the card say "To fix". |
| P9 | Confirm is all or nothing. The first stale reply or unpushed fix stops all posts with one message and no thread (publish/routes.ts:99-105, outbox.ts:449-468). Accept stays on a stale card. | Done: WP-S3 and WP-U2 list the blocked drafts in groups with their actions, and confirm posts the rest. An out-of-date reply draft shows no Accept or Edit, and the server refuses both with 409. |
| P10 | A draft goes into a thread that another person resolved after the draft. | Landed: WP-S3 leaves a resolved-since draft out of the plan. The user reopens the thread to post it. A draft written while the thread was resolved keeps reopen-first. |
| P11 | A rebased or squashed fix commit never reaches the PR, so the "Fixed in" draft waits forever (outbox.ts:460-468). An edit keeps the commit link (items.ts:81-85). | Partly: WP-S2 adds the item action plain. WP-S3 marks commit-gone when the clone branch no longer holds the commit. The confirm and the draft card offer "Post as plain reply" (WP-U2, WP-U1a). Only an accepted draft gets the commit-gone check. An edit still keeps the link. |
| P12 | The Fix list ignores fix notes (fix/model.ts:28-37, 150). | Landed: WP-U1b shows the fix outcome of each row, and a no-fix note or a decline starts unticked (fix/model.ts fixOutcome). |
| P13 | A reply run does not see the fix state of a thread (catalog.ts:312-341). | Landed: WP-S4 adds context/fix-state.md (jobs.ts fixStateFile). |
| P14 | A thread has no history of its drafts and fixes. | Done: section 10. GET /api/prs/:id/threads/:thread/history (review/history.ts) and the "Thread history" section (web/pr/history.ts, ThreadHistory.tsx). |
| P15 | A BLOCKER task has no actions (Thread.tsx:150). | Later |
| P16 | No signal tells the user that a draft is out of date (notify.ts:15-19). | Done: section 11. Shared staleReasons, the Code changed marker, the inbox badge, and the draft_stale notification. |

## 3. Outcomes

| Outcome | Source |
|---|---|
| Open | No draft, no fix note, thread unresolved. |
| Answered | A reply draft with a body, origin review, reply, or session, not a fix. |
| To fix | Judgement valid or partly, or a session accept, and no fix run yet. |
| Fix proposed | The newest fix note has fixed true and free edits. |
| Fixed in X | A "Fixed in" draft. The commit holds every edit of the thread. The body keeps any answer and adds "Fixed in X: <what>". |
| Partly fixed in X | The commit holds only a part of the edits of the thread. No resolve proposal. |
| Already done | A fix note with why already. |
| Won't fix: reason | A fix note with why invalid or scope, or a user decline (declined set). |
| Needs your decision | A fix note with why decision or risk, or why dropped. |
| Follow-up asked | Judgement unsettled or followup, or a fix note with why unclear. |
| Settled | Judgement settled, with or without a resolve proposal. |
| Waiting on them | My message is the newest, and no draft is open. |
| Resolved | The thread is resolved and no draft is open. |

Markers on the outcome line:
- Out of date: newer messages arrived after the draft, or its parent is deleted.
- Resolved since the draft: threadOpen true, and the thread is resolved now.
- Waiting for push: the "Fixed in" commit is not on the PR yet.
- Revision waiting: a revision of the open draft waits for Use revision or Keep mine (section 8).

## 4. Writer priority

1. The user: edit, accept, or decline ("Don't fix…").
2. "Fixed in" from a fix commit.
3. The no-fix draft of a fix run (origin nofix).
4. A reply run (origin reply), or the answer draft of a review run (origin review, section 9).
5. A resolve-only proposal (origin resolve).

- A writer never replaces a draft of a higher writer. It records "kept your draft" in the coverage. A reply run or a fix commit stores a revision of a draft that the user edited or accepted instead (section 8).
- A reply run for threads that the user named (Draft again, Draft reply) is the user's choice. It replaces an untouched AI draft of any writer.
- A draft stored before origin existed ranks by its fix field: with fix it is "Fixed in", else a reply run.
- A writer that replaces a lower draft stores its ID in replaced. Undo restores the newest replaced draft. Only a fix commit has an Undo.

## 5. Transitions

- Open or To fix to Fix proposed: a fix run gives a note with fixed true and valid edits.
- Fix proposed to Fixed in X or Partly fixed in X: Apply commits the ticked edits.
- Fixed in X to Fix proposed: Undo of the commit. The replaced draft comes back.
- Fix proposed to Won't fix: the user picks "Don't fix…" and types a reason. The app stores an unaccepted "Won't fix: <reason>" draft with origin nofix and declined {run}, and folds the proposal. No writer replaces it.
- A fix run to Already done, Won't fix, Follow-up asked, or Needs your decision: a thread note with fixed false and why already, invalid, scope, or unclear makes a draft with origin nofix and the note reply as its body, not accepted. already also proposes resolve, ticked only on a thread that the user started. why decision and risk make no draft. A finding note makes no draft. A note without a reply makes no draft.
- A fix run to Needs your decision: validateFix drops every edit of a fixed note. The app keeps the note with why dropped and the reasons in drops. It offers Fix again and Copy prompt, never a reply.
- Any outcome to Out of date: new messages arrive. Confirm leaves the draft out of the plan. Reply to the newest as is ends Out of date with the same text (section 8).
- Any outcome to Resolved since the draft: the thread is resolved after the draft. Confirm leaves the draft out of the plan until the user reopens the thread.
- Waiting for push to Fixed in X: the next sync finds the commit. A commit that the clone branch no longer holds (rebase, squash, reset) offers "Post as plain reply". A cache commit or a clone that git cannot read stays Waiting for push.

## 6. Work packages

| WP | Scope | Agent |
|---|---|---|
| WP-D | This plan, BRIEF.md "Thread outcome", CLAUDE.md status. | Done |
| WP-C | review.ts: fix note why (already, invalid, scope, decision, risk, unclear; dropped app-only) and reply, with defaults; parseFixNotes; reply payload origin and declined. dto.ts: fixDeclineInput, BlockedDraft on the post plan. | Done |
| WP-S1 | Fix outcomes: the fix agent writes why and reply. A note with fixed false makes a nofix draft by the writer priority. validateFix keeps a dropped note with why dropped. Every writer sets origin. | Done |
| WP-S4 | The reply run context shows the fix state of each thread: proposal, commit, decline. | Done |
| WP-S2 | Commit: "Partly fixed in X" without resolve; "Fixed in X: <what>" keeps any answer. Decline route "Don't fix…" (fixDeclineInput). "Post as plain reply" for a rebased fix. | Done |
| WP-S3 | Partial confirm: the plan lists blocked drafts per item and thread. Confirm posts the rest. | Done |
| WP-U1b | Fix UI: Don't fix…, the persistent fold, the dropped note with Fix again and Copy prompt, the Fix list with fix notes. | Done |
| WP-U2 | Post UI: the blocked list in the confirm dialog, grouped by reason with the actions. | Done |
| WP-U1a | The outcome line per thread, the markers, the conflict note, the origin label, the Draft replies count, "Post as plain reply" on the card, and Fix anyway with `anyway`. | Done |

## 7. As built (WP-U1a) and later items

- review/outcome.ts derives the line. First match wins: Resolved without an open draft, your decline, a fix commit, your open draft (accepted, edited, or origin user), the newest fix result, an AI draft, then Waiting on them or Open. A draft with no text and no resolve reads "No reply needed", or "To fix" when it asks for a fix (P8).
- An untick of every free edit is your choice: an open draft then states the outcome, not "Fix proposed".
- Conflict "no": an open reply judges the comment not valid, and edits of the thread are ticked. Keep the reply unticks them. Keep the fix discards the reply.
- Conflict "yes": an untouched open reply asks for a fix, and the newest fix note says already, invalid, or scope. Keep the reply accepts the reply, or runs Fix anyway when it has no text. Keep the fix discards the reply and restores the nofix draft of that fix run.
- A finding that your session rejected, with ticked edits, gets the note with Keep the reject (untick) and Keep the fix (restore the finding).
- The Draft replies count: your-turn threads with no current draft, or with an out-of-date draft that a reply run for all threads replaces. The run still takes every your-turn thread.
- Per-thread history (P14) and out-of-date draft alerts (P16) are done (sections 10 and 11).
- Later: BLOCKER task done (P15), the commit-gone check for an unaccepted "Fixed in" draft (P11), and an untick that survives a reload (P3).

## 8. Revisions and Reply to the newest as is (decisions C and D)

User decision, 2026-10-20. Rule: an action that would replace a draft that the user edited or accepted stores a revision. The user uses it or keeps the draft. No writer overwrites it in silence.

- Revision: a review_item with kind reply, status discarded, and payload revises <draft ID>. CURRENT_DRAFTS never picks it. GET reply-drafts and the item action response carry the newest waiting revision on its open draft as revised. A newer revision of a thread, or a new draft of the thread, sets dropped true on the older ones. The row stays, because SQLite gives the ID of a deleted last row again, and a stale page could then use a revision it never saw.
- Revise mode: draftReplies marks a thread with ReplyThread.revise <draft ID> when its current draft is touched (accepted, or new and edited). A named thread (Draft again, Draft reply) always gets it. Draft replies marks only an out-of-date touched draft. The prompt gets a Revise line that points to the "Draft text" of context/fix-state.md: keep the user's points and tone, change only what the new messages require, else give the text unchanged. At the run end, a result for a marked thread whose current draft is still that draft becomes a revision. The same text stores nothing (sameText). The coverage says revisedText.
- Use revision (item action use-revision {revision, draft}): one transaction discards the user's draft (discardedBy user) and makes the revision the draft: revises removed, status new, edited 0, not accepted. The user's resolveTick stays. A revision with fix adds the user's draft to fix.replaced, so Undo of the commit brings it back. A revision without text and without a resolve stays discarded as the user's choice.
- Keep mine (keep-mine {revision}): sets dropped on the revision. The user's draft keeps its exact text and its accepted state.
- A waiting revision takes no other item action. A dropped revision gets 409. A revision of an undone commit is hidden, and Use revision of it gets 409.
- Reply to the newest as is (reply-to-newest {revision}): no AI run. It sets replyTo of an open draft with text to the newest live message (newestLive). The status, the text, edited, and threadOpen stay. threadOpen true in a thread that is resolved now gets 409 (resolved-since). threadOpen false keeps reopen-first. The draft card offers it on an out-of-date draft. The post confirm offers it as the action of the out-of-date group, in place of Draft again, which discarded the accepted draft first.
- AI discard: validateReplies stores a "No reply needed" draft with discardedBy ai. userDraft counts a discarded current draft as a decline only without discardedBy ai. The item action discard sets discardedBy user. Drafts stored before the field read as the user's.
- Draft replies count (outcome.ts needsReply): also an out-of-date AI-discarded draft, and an out-of-date touched draft without a waiting revision for the newest message.

Writers:

| Writer | Choice |
|---|---|
| Reply run for named threads | Revision of a touched draft. A declined "Won't fix" draft stays kept, as before. |
| Draft replies | Revision of an out-of-date touched draft. A current touched draft stays kept. An AI-discarded draft is replaced. |
| Fix commit | Revision of a touched draft: its text plus the "Fixed in" line. A "Won't fix" draft stays kept. |
| Fix run, no-fix draft | Kept, as before. The note reply does not revise the user's text. |
| Session Apply | Unchanged: the user's own click replaces open drafts and its Undo brings them back (consult.ts). |
| Don't fix | Unchanged: the user's own click with Undo. |
| Re-review resolve proposal | Unchanged: it skips every thread with an unposted draft. An answer draft of the same run goes in first (section 9). |
| Review run answer draft | As Draft replies: revision of an out-of-date touched draft. A current touched draft and a declined draft stay kept (section 9). |

## 9. Answered questions in a review run

User decision, 2026-10-20. A review run and a "Review changes since" run judge the answers to the questions that the user posted from earlier runs. Explain does not.

- Questions: each confirmed general or inline post of review items (post.run set) whose root comment is live and unresolved. A general comment holds the questions and the outside findings of its run. An inline comment holds one finding. Each posted item is one question, numbered from 1 in post order. A thread joins only when another person wrote its newest live message. Without a configured user, no thread joins.
- Context: context/questions.md (jobs.ts questionsFile). Per thread: the place, the start and newest message, each question marked "Asked by the user", every later message with "by the user" or "by another person", and the user's draft when the run revises it. Free text is in indented blocks. The file stops at 60 KB or at MAX_ANSWERED questions. A notChecked line counts the threads left out.
- Prompt: a Tools line and the heading rule in the task. The main agent gets ANSWERED_RULES (catalog.ts) only when the run has questions.md. The reviewer agent gets none.
- Result: answered [{thread, question, outcome, evidence, reply, finding}]. outcome is settled, followup, or issue. question is null only for a thread with one question. finding is the index of the new finding in findings, for issue only. Results without answered parse with an empty list. An Explain run gets a JSON schema without the key.
- validateAnswered (validate.ts) drops an entry for a thread that is not in questions.md, a missing or unknown question number, a second entry of one question, and an issue whose finding is absent or did not anchor (validate().kept). Every drop goes to coverage.skipped.
- One unaccepted draft per thread, origin review, evidenceStatus unverified, replyTo the newest message at the run start. The replies of the thread join in question order. settled for every question of the thread: judgement settled and resolve, ticked only on a thread that the user started. Else judgement followup when an entry asks a follow-up, or unsettled, and no resolve. A draft with no text and no resolve is dropped to skipped.
- issue: the finding is a normal finding of the run. The draft text points to it. The app stores no link between them.
- Unanswered questions get no entry and no draft.
- Writers: the run end applies the writer priority (section 4) and the revisions (section 8). An out-of-date draft that the user edited or accepted gets a revision (ReplyThread.revise). Other touched, declined, or higher drafts stay, with "kept your draft" in the coverage.
- Run line: "N answered threads" counts the answer drafts of a review or re-review run.
- Outcome line: settled reads Settled, followup and issue read Follow-up asked.
- Not verified: that the real CLI fills answered as the rules ask. The tests use the fake CLI.

## 10. Thread history (P14)

User decision, 2026-10-21: v1 derives the history from the existing tables. No new table (Q1). No key (Q2).

- Sources: comment, review_item with review_run, fix_json, fix_edit, fix_commit, and post. Bitbucket activity adds nothing: resolve and reopen add no activity, edits change the comment in place, and replies have no activity. Run logs are not a source.
- Lost facts: earlier resolve and reopen cycles (a reopen clears the resolver and the date) and the times of triage actions (review_item has no time column). v1 shows the current resolve only. The reply payload gets touchedAt, the time of the last user action, with no migration.
- Payload: touchedAt is set by accept, edit, plain, reply-to-newest, and use-revision. revisionOf names the draft that a used revision revised (takeRevision). Old payloads parse without them.
- ReviewItemDto.drafted {kind, startedAt, finishedAt, head} on reply items gives the run of the draft. "Moved to newest" means that replyTo is newer than the run start. Every SQL that builds a reply DTO selects the run columns, because putItem replaces the client cache with the response DTO.
- Route: GET /api/prs/:id/threads/:thread/history with zod params. 404 when the PR has no comment row with that thread. A deleted root still returns.
- ThreadHistoryDto {thread, drafts[{at, exact, item, replacedBy}], fixes[{at, run, note}], commits[{at, id, run, short, state, edits, of, pushed, undoneAt}], posts[{at, id, run, kind, state, error, remoteId, updatedAt, resolve}]}.
- at: a "Fixed in" draft takes the fix commit time. A "Won't fix" draft from a decline takes the fix run time with exact false. Other drafts take the run finish, else the run start.
- replacedBy: the explicit lists first (fix.replaced, declined.replaced, session.replaced). Else a draft discarded without discardedBy takes the next newer draft of the thread that is not a revision.
- Thread posts: replies with a parent in the thread, rows with resolve_root equal to the thread, and rows with remote_id equal to the root.
- UI: the thread More menu item "Show history" opens "Thread history" under the thread footer. "Hide history" closes it. One time-ordered list in the prototype timeline style. Lines: messages (started, replied, edited, deleted; a Kierto post names its run or "from a Kierto draft"), drafts by writer, answer judgements, draft fate (edited with Show changes, accepted, moved to newest, discarded, no reply needed, replaced by a newer draft or a named writer), revisions (waiting, not used, used), fix results, fix commits ("N of M edits of this thread", waiting for push, undone at), posts that are not confirmed (posting, failed with the error, unknown), and "Resolved by X". AI lines link to the run log.
- Footnote: "Bitbucket keeps no record of reopens or earlier text. Kierto keeps only the time of your last change to a draft."
- Edges: a deleted comment keeps its line without text. A rebased commit that pr_commit does not list reads "not on the PR". Failures of a manual Resolve are not stored. Merged and archived PRs work. Data from before the new fields gets neutral words. Clock skew can change the order.
- As built (WP4): historyLines (web/pr/history.ts) merges the DTO with the thread messages. The section is ThreadHistory.tsx, because history.ts and History.tsx clash on a case-insensitive file system. A fact without a stored time is a tag on its line, not a line with a guessed time: a deleted message, a draft fate (Replaced by X, Discarded by you, Decline undone, Posted), and a revision state (Revision waiting, Not used, You kept your draft). Your decline, the "Won't fix" draft, and your changes to a draft stored before touchedAt show "time not kept". A committed fix that the PR commits do not list reads "Not on the pull request", because no git call can tell an unpushed commit from a rebased one. A message line counts as edited when updatedAt is later than createdAt: a task resolve keeps updatedDate (fixtures/bitbucket comment-blocker-*.json). The menu item says "Hide history" while the section is open. Esc in the section closes it, and the focus goes back to More. The demo seeds thread 3000 of "Replace the polling timer" with a draft, your edit, a fix commit, a used revision, the post, and the resolve.

## 11. Out-of-date draft alerts (P16)

User decision, 2026-10-21: badge only, no Needs you (Q3). Only touched drafts notify, with no own setting (Q4). Revise my reply does not handle code changes (Q5). Enter on a row does not open a stale draft (Q6).

- staleReasons (src/shared/stale.ts) holds the rules for the post plan, the outcome markers, the badge, and the notification.
- out-of-date: the newest live message of the thread is not the draft replyTo. A thread where every message is deleted counts.
- resolved-since: the draft has text, threadOpen is true, and the thread is resolved now.
- code-changed: the draft is not from a fix run, the root anchor has orphaned_at, orphaned_at is later than both the run start and touchedAt, and the PR head is not the run head.
- The post plan keeps its four block reasons. Code changed never blocks.
- comment.orphaned_at: sync sets it to the sync time when a stored anchor that was not orphaned becomes orphaned. Sync clears it when the anchor is not orphaned. An anchor that is orphaned at first sight keeps NULL.
- PR view: the marker "Code changed" and the card line "The code at this comment changed after this draft." An untouched draft offers Draft again. A touched draft offers Show in diff only. The other markers stay.
- Inbox: PrRow.staleDrafts. The meta line shows a muted History icon and the count, for example "2 reply drafts out of date". The tooltip says to open the PR. Groups, views, and sort do not change.
- Badge count: only the current open draft per thread that would post (text or a resolve tick). Never revisions, discarded drafts, posted drafts, or drafts of an undone fix.
- Event: kind draft_stale (ClaimedEvent.kind). The migration rebuilds event for the new CHECK. A sync adds an event only when a draft becomes stale in that sync: it reads the stale set before and after the comment writes in one transaction. The ref is `<item>:out-of-date:<newest id>` or `<item>:resolved-since:<resolved at>`.
- Notification rules: only accepted or edited drafts, and only out-of-date and resolved-since. No event when I wrote the newest message or resolved the thread, on the first sync, or for a merged, declined, archived, or unfollowed PR. A draft created or accepted while it is stale never notifies. The note per PR says "1 reply draft out of date" and joins the comment events of the same sync. One tab claims it. The notifications setting applies.
- Edges: a deleted parent gives out-of-date. A thread with every message deleted hides "Reply to the newest as is" (409). A force push can orphan anchors and mark drafts, but not fix-run drafts. A forbidden reopen shows the error, and Discard clears the badge. A merged PR keeps the badge and gets no notification.
- Not verified: that orphaned flips back, replies on merged or declined PRs, and the resolver on Bitbucket 9.4. The poll window of about 60 s can show Code changed after an accept.
