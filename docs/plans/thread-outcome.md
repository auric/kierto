# Thread outcome plan: one outcome per thread

Status: in progress, 2026-10-20. WP-D, WP-C, and WP-S1 are done. Line references point to the code at HEAD 0db727e.

## 1. Goal

- Each thread shows one outcome line. The line comes from the reply draft, the fix note, the fix commit, and the thread state.
- The app derives the outcome in the UI. No migration: the new facts are JSON fields of the fix note and the reply payload.
- A user choice always wins over an AI writer.

## 2. Problems

Already landed: 0fe5659 keeps drafts that the user edited or accepted on AI runs and fix commits, restores the replaced draft on Undo (fix.replaced), refuses Restore for a draft of an undone commit, reopens a resolved thread before a reply, and marks "Resolved since the draft" (threadOpen). 0db727e removes Paste the answer.

| ID | Problem | Status |
|---|---|---|
| P1 | A note with fixed false shows only the card "No fix proposed" (FixCard.tsx:219). It makes no reply draft. The reason is written for the user, not for the reviewer (review.ts fixThread, catalog.ts:344-359). | Partly: WP-S1 makes the nofix draft from the note reply (jobs.ts judgeFix). The fix card is WP-U1b. |
| P2 | A note with fixed true loses all its edits in validateFix, so validateFix removes the note (fix.ts:108). The reason shows only in the coverage. The pending card lives only while the page is open (fix/model.ts:297-301, FixBar.tsx:123). | Partly: WP-S1 keeps the note with why dropped and drops (fix.ts validateFix). Until WP-U1b, the fix card shows it as "No fix proposed". |
| P3 | The fix card has no Discard. An untick lives only in memory (FixBar.tsx:124). A reload ticks the newest run again (fix/model.ts:210-213). | Open |
| P4 | A commit discarded edited or accepted drafts, and Undo did not restore them. | Landed in 0fe5659 (fix-routes.ts:203-206, 366-370, items.ts:51-53) |
| P5 | A commit replaces an untouched AI answer with "Fixed in X." (fix-routes.ts:207-210). A commit with only a part of the edits of a thread still says fixed and proposes resolve (fix-routes.ts:222). | Open |
| P6 | Draft replies discarded edited, accepted, and "Fixed in" drafts. | Landed: 0fe5659 protects edited and accepted drafts. WP-S1 keeps an untouched "Fixed in" or nofix draft on Draft replies (jobs.ts writerRank, end). |
| P7 | The reply card and the fix card show side by side and can disagree (useReview.tsx:505-519). | Open |
| P8 | A session accept without a reply gives "No reply needed" with the chip "Valid" (consult.ts:517, ReplyDraft.tsx:196-210, review/model.ts:520). The outcome must be "To fix". | Open |
| P9 | Confirm is all or nothing. The first stale reply or unpushed fix stops all posts with one message and no thread (publish/routes.ts:99-105, outbox.ts:449-468). Accept stays on a stale card. | Open |
| P10 | A draft goes into a thread that another person resolved after the draft. | Partly: 0fe5659 reopens the thread and shows the marker. The draft must stay out of the plan until the user confirms it. |
| P11 | A rebased or squashed fix commit never reaches the PR, so the "Fixed in" draft waits forever (outbox.ts:460-468). An edit keeps the commit link (items.ts:81-85). | Open |
| P12 | The Fix list ignores fix notes (fix/model.ts:28-37, 150). | Open |
| P13 | A reply run does not see the fix state of a thread (catalog.ts:312-341). | Open |
| P14 | A thread has no history of its drafts and fixes. | Later |
| P15 | A BLOCKER task has no actions (Thread.tsx:150). | Later |
| P16 | No signal tells the user that a draft is out of date (notify.ts:15-19). | Later |

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

## 4. Writer priority

1. The user: edit, accept, or decline ("Don't fix…").
2. "Fixed in" from a fix commit.
3. The no-fix draft of a fix run (origin nofix).
4. A reply run (origin reply).
5. A resolve-only proposal (origin resolve).

- A writer never replaces a draft of a higher writer. It records "kept your draft" in the coverage.
- A reply run for threads that the user named (Draft again, Draft reply) is the user's choice. It replaces an untouched AI draft of any writer.
- A draft stored before origin existed ranks by its fix field: with fix it is "Fixed in", else a reply run.
- A writer that replaces a lower draft stores its ID in replaced. Undo restores the newest replaced draft. Only a fix commit has an Undo.

## 5. Transitions

- Open or To fix to Fix proposed: a fix run gives a note with fixed true and valid edits.
- Fix proposed to Fixed in X or Partly fixed in X: Apply commits the ticked edits.
- Fixed in X to Fix proposed: Undo of the commit. The replaced draft comes back.
- Fix proposed to Won't fix: the user picks "Don't fix…" and types a reason. The app stores a user draft with declined {run} and folds the proposal.
- A fix run to Already done, Won't fix, Follow-up asked, or Needs your decision: a thread note with fixed false and why already, invalid, scope, or unclear makes a draft with origin nofix and the note reply as its body, not accepted. already also proposes resolve, ticked only on a thread that the user started. why decision and risk make no draft. A finding note makes no draft. A note without a reply makes no draft.
- A fix run to Needs your decision: validateFix drops every edit of a fixed note. The app keeps the note with why dropped and the reasons in drops. It offers Fix again and Copy prompt, never a reply.
- Any outcome to Out of date: new messages arrive. Confirm leaves the draft out of the plan.
- Waiting for push to Fixed in X: the next sync finds the commit. A rebased commit offers "Post as plain reply".

## 6. Work packages

| WP | Scope | Agent |
|---|---|---|
| WP-D | This plan, BRIEF.md "Thread outcome", CLAUDE.md status. | Done |
| WP-C | review.ts: fix note why (already, invalid, scope, decision, risk, unclear; dropped app-only) and reply, with defaults; parseFixNotes; reply payload origin and declined. dto.ts: fixDeclineInput, BlockedDraft on the post plan. | Done |
| WP-S1 | Fix outcomes: the fix agent writes why and reply. A note with fixed false makes a nofix draft by the writer priority. validateFix keeps a dropped note with why dropped. Every writer sets origin. | Done |
| WP-S4 | The reply run context shows the fix state of each thread: proposal, commit, decline. | implementer |
| WP-S2 | Commit: "Partly fixed in X" without resolve; "Fixed in X: <what>" keeps any answer. Decline route "Don't fix…" (fixDeclineInput). "Post as plain reply" for a rebased fix. | implementer |
| WP-S3 | Partial confirm: the plan lists blocked drafts per item and thread. Confirm posts the rest. | implementer-xhigh |
| WP-U1b | Fix UI: Don't fix…, the persistent fold, the dropped note with Fix again and Copy prompt, the Fix list with fix notes. | implementer-xhigh |
| WP-U1a | The outcome line per thread, the markers, and a note when the reply and the fix disagree. | implementer-xhigh |
| WP-U2 | Post UI: the blocked list in the confirm dialog, no Accept on a stale card. | implementer |
| Later | Per-thread history (P14), the stale-draft notice (P16), BLOCKER task done (P15). | - |
