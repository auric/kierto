# Bitbucket fixtures (Gate 0)

Source: Gate 0 probe (`scripts/gate0/bitbucket-probe.ts`) on a sandbox PR, Bitbucket Data Center 9.4.26. Each file is `{ "status": <HTTP status>, "body": <response body> }`.

Sanitizing: user names, slugs, display names, emails, host, project key, repository slug, PR title, description, branch names, file paths, comment text, and diff line text are fictional. Commit hashes are fake 40-hex values. Numeric IDs (`id`, `repositoryId`, `commentIds`, IDs in URLs and error messages) are fake values with the same digit count. Each mapping is consistent across all files, so equal values stay equal. The ssh clone port is 7999. Field names, types, enum values, nesting, timestamps, and versions are unchanged.

Regenerate: run the probe (`bun scripts/gate0/bitbucket-probe.ts --pr <PR> --write`) to fill `.gate0/raw/`. Then run `bun scripts/gate0/sanitize-fixtures.ts`. It rewrites the JSON files here, compares their structure with the raw files, and scans `fixtures/bitbucket/` and `integration-check.md` for every real value from `.gate0/raw/`. It prints counts only and exits with code 1 on a hit or a structure difference. The raw step numbers below depend on the probe's request order.

| File | Raw probe step | Request |
|---|---|---|
| `application-properties.json` | 02 application-properties | `GET /rest/api/1.0/application-properties` |
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
