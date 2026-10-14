# Fix UX plan: Fix on every open thread of my own PR

Status: approved by the user, 2026-10-14. WP-D and WP1 are done. WP2 to WP4 are open. Line references point to the code at HEAD efd8f8c.

## 1. Root cause

- Fix shows only after a reply draft judges a comment valid or partly valid (FixBar.tsx:105-106, fix/model.ts:19-25, useReview.tsx:458, ReplyDraft.tsx:116-126).
- Draft replies covers only threads where it is my turn (turn.ts:20-26). My own comments and posted findings make a thread "wait". Draft replies then counts 0, and "Fix all valid" stays disabled with the tooltip "Draft replies first".
- Findings have no Fix path: `fix_edit.thread` is NOT NULL (015_fix.sql:18).
- The server already accepts any live thread in an explicit list (jobs.ts:1393-1394, the fix.test.ts refusal test).
- The rule came from BRIEF.md and r3.md risk 8. The user dropped it on 2026-10-14.

## 2. Design (Option A)

- Header button "Fix · N" is never disabled. It opens a picker dialog with one checkbox per source.
- Sources: open, unresolved threads with a live message, including my own comments and posted findings. Phase 2 adds open findings that are not posted (new or accepted, with an anchor).
- A reply draft verdict only sets the default tick. Valid and partly are ticked. Invalid, question, null, and already fixed are not.
- The dialog button reads "Propose fixes for K".
- Each thread gets Fix and "Copy prompt for Claude Code" next to Draft reply. Phase 2 gives each finding a Fix button.
- The fix agent judges first. It reads the whole thread and sets fixed to false, with the reason, when the code is already right or the thread asks for no change.
- The picker shows each reason in text: the count of resolved threads, the count of deleted threads, lost code, a busy run, the Explain profile, more than 25 picks, not synced, and nothing to fix.
- Keys: f fixes the focused thread or finding. F opens the picker.
- A reviewer gets no Fix. f shows the toast "Fix works only on your own pull requests."
- Draft replies with 0 threads shows the hint "Your message is the newest in each open thread. They wait for the other person."
- A fix commit that covers an accepted finding that is not posted marks it "Fixed in <short hash>". The finding leaves Ready to post. The user can restore it.

## 3. Phases

1. Phase 1: threads only. WP-D, WP1, WP2.
2. Phase 2: findings that are not posted. WP3, WP4.

## 4. Work packages

- WP-D docs: BRIEF.md (Fix it, Judgement, Fix run, Fixed finding), r3.md risk 8 replaced, this plan, docs/smoke-r3.md part J.
- WP1 server, judge first: catalog.ts fixAgent rule, prompt.ts buildFixPrompt line "Read the whole thread of each entry, not only its newest message.". Tests: prompt.test.ts and a fix.test.ts case for a thread with only the author's message.
- WP2 UI phase 1, threads: fix/model.ts targets and button state, a new FixPicker.tsx, FixBar split, a Thread.tsx aside prop (a boolean, replies.md R14), PrDetail ref wiring, useReview reveal, FixActs removed, keys f and F, the zero hint. E2e: an own-comment scenario (thread 5000003), a picker test, and updates to fix.e2e.ts:89 and 117-118.
- WP3 server phase 2, findings: migration 022 makes `fix_edit.thread` nullable and adds `item`, with a CHECK for exactly one. Changes in review.ts and dto findings, jobs.ts fix() with findings and context/findings.md, validateFix, and the fix-routes finish step that skips rows without a thread. The fake CLI gets findings.
- WP4 UI phase 2, findings: Drafts.tsx Fix and its card, fix state by thread or finding, picker entries, f on a finding.

## 5. User decisions (2026-10-14)

1. Option A. The valid-only rule is dropped.
2. A reviewer gets no Fix, and the app says why.
3. A fixed accepted finding shows "Fixed in <commit>", leaves Ready to post, and can be restored.
4. No "Draft replies for all open threads" menu item.

## 6. Known limits

- The server does not refuse a resolved thread in an explicit list (replyThreads, jobs.ts). WP2 leaves resolved threads out of the picker. WP2 decides whether the server refuses them too.
