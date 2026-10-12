# Bitbucket fixtures (Gate 0)

Source: Gate 0 probe (`scripts/gate0/bitbucket-probe.ts`) on a sandbox PR, Bitbucket Data Center 9.4.26. Each file is `{ "status": <HTTP status>, "body": <response body> }`.

Sanitizing: user names, slugs, display names, emails, host, project key, repository slug, PR title, description, branch names, file paths, comment text, and diff line text are fictional. Commit hashes are fake 40-hex values. Numeric IDs (`id`, `repositoryId`, `commentIds`, IDs in URLs and error messages) are fake values with the same digit count. Each mapping is consistent across all files, so equal values stay equal. The ssh clone port is 7999. Field names, types, enum values, nesting, timestamps, and versions are unchanged.

Regenerate: run the probe (`bun scripts/gate0/bitbucket-probe.ts --pr <PR> --write`) to fill `.gate0/raw/`. Then run `bun scripts/gate0/sanitize-fixtures.ts`. It rewrites the JSON files here, compares their structure with the raw files, and scans `fixtures/bitbucket/` and `integration-check.md` for every real value from `.gate0/raw/`. It prints counts only and exits with code 1 on a hit or a structure difference. The raw step numbers below depend on the probe's request order.

| File | Raw probe step | Request |
|---|---|---|
| `pull-request.json` | 01 pull-request | `GET .../pull-requests/{id}` of a personal-repository PR. Project key `~JDOE`, `links.self` in the `/users/<slug>/...` form. No `description` and no `properties` key. |
| `application-properties.json` | 02 application-properties | `GET /rest/api/1.0/application-properties` |
| `dashboard-reviewer-page.json` | 03 dashboard-REVIEWER | `GET /rest/api/1.0/dashboard/pull-requests?state=OPEN&role=REVIEWER&limit=1`. Last page: `nextPageStart` is absent. Another user is the author. The reviewer entry has `lastReviewedCommit`. |
| `dashboard-pull-requests-page.json` | 04 dashboard-AUTHOR | `GET /rest/api/1.0/dashboard/pull-requests?state=OPEN&role=AUTHOR&limit=1`. Not the last page: `isLastPage: false`, `nextPageStart: 1`. |
| `activities-opened-only.json` | 05 activities-p0 | `GET .../pull-requests/{id}/activities`. Last page: `nextPageStart` is absent. |
| `pull-request-changes.json` | 06 changes | `GET .../pull-requests/{id}/changes`. Last page: `nextPageStart` is `null`. |
| `comment-edit-response.json` | 11 edit-general | `PUT .../comments/{id}` with `version: 0`. The response has `version: 1`. |
| `activities-after-edit.json` | 12 trace-edit | Activities after the edit. The same activity keeps `commentAction: ADDED` and shows the new text and `version: 1`. |
| `comment-edit-stale-version-409.json` | 13 edit-stale-version | `PUT .../comments/{id}` with the old version. 409 `CommentOutOfDateException`. |
| `activities-nested-reply.json` | 15 trace-reply | Activities after a reply. The reply has no own activity. It is in the parent's `comment.comments`. |
| `comment-with-nested-reply.json` | 16 get-parent-with-reply | `GET .../comments/{id}` of the parent. The reply is in `comments`. |
| `comment-inline-commit-response.json` | 17 post-inline-COMMIT | `POST .../comments` with `anchor.diffType: COMMIT`. The response anchor adds `orphaned`. |
| `activities-inline-anchored.json` | 18 trace-inline-COMMIT | Activities with the inline comment (`commentAnchor` and `diff` keys) and the general comment with its nested reply. |
| `comment-delete-204.json` | 26 delete-0 | `DELETE .../comments/{id}?version=1`. 204, empty body. |
| `comment-get-after-delete-404.json` | 27 post-delete-0 | `GET .../comments/{id}` after the delete. 404 with `errors[].message` only, no `exceptionName`. |
| `activities-after-delete.json` | 28 trace-delete | Activities after all deletes. The comment activities are gone. The server shows no deleted-comment shape in activities. |

## Gate v3 fixtures (Gate A, 2026-10-11)

The v3 probe (`bitbucket-probe.ts --v3`) writes these files. `sanitize-fixtures.ts` skips a v3 file whose raw source is missing.

| File | Raw probe step | Status |
|---|---|---|
| `pull-request-commits-page.json` | v3-p1-commits-p0 | Written |
| `jira-issues.json` | v3-p1-jira-issues | Written |
| `repository.json` | v3-p1-repository | Written |
| `comment-inline-removed-response.json` | v3-p1-post-removed | Not written. The test diff has no REMOVED line. |
| `comment-inline-context-response.json` | v3-p1-post-context | Written |
| `comment-inline-reply-response.json` | v3-p1-post-inline-reply | Written |
| `comment-inline-merge-base-response.json` | v3-p1-post-merge-base | Written |
| `comment-blocker-task-response.json` | v3-p1-post-blocker | Written |
| `comment-blocker-resolved-response.json` | v3-p1-resolve-blocker | Written |
| `activities-v3-after-write.json` | v3-p1-activities-after-write-p0 | Written |
| `activities-rescoped-orphaned-range.json` | v3-p2-activities-p0 | Written. No push and no range comment occurred. The file holds no RESCOPED activity, no orphaned anchor, and no range comment. |
| `pull-request-commits-after-push.json` | v3-p2-commits-p0 | Written. No push occurred. The file shows the same single commit. |

## Gate A capture fixtures (U2, U12)

`scripts/gate0/capture-a.ts` writes `real-u2-*.json` (after manual step a) and `real-u12-*.json` (after manual step b). It reads the PR, all activity pages, the comments of each commented file (`comments?path=<path>&anchorState=ALL`, all pages), the diff of each commented file (`withComments=true`), and for U12 all commit pages. Raw files go to `.gate0/a-capture/raw/`. The script then runs `sanitize-fixtures.ts --raw .gate0/a-capture/raw --prefix real-`. This mode has its own value mapping, so fake IDs and hashes do not match the files above. See docs/smoke-r3.md, "Capture U2 and U12".

## Synthetic scenarios

`tests/support/scenarios.ts` derives synthetic states from these files at test time: page splits, both last-page forms, a missing cursor, duplicates, reordering, a version-0 state before the recorded edit, comments by a second user, new nested replies, a higher comment version, a merged PR, and a new source head. The server did not send these states. The second user comes from `dashboard-reviewer-page.json`, because every recorded comment is by the token owner.

Gate v3 synthetic states (plan v3 WP4) live in `tests/bitbucket/provider.test.ts` and `tests/sync/engine.test.ts`: a REMOVED segment with a FROM anchor, an orphaned anchor that keeps its diff, a diff in another shape, a merge commit DAG in server order over two pages, a commit author without a forge account, a MOVE change with `srcPath`, a partial commits fetch, and the BLOCKER task at version 0 before the recorded resolve. The server did not send these states.

Synthetic username case: `asUsername` in `tests/support/scenarios.ts` gives the token owner the username `JDoe` with the slug `jdoe`. The fake server then sends `X-AUSERNAME: JDoe`. The recorded server sent a username equal to the slug. No recorded file has this case.

`fixtures/tls/` holds a test-only CA (`ca.pem`) and a server certificate for `127.0.0.1` (`server.pem`, `server.key`). The fake server uses them for the https test. The CA key was deleted after signing.
