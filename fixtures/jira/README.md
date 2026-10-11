# Jira fixtures

Synthetic payloads for the fake Jira (`tests/support/fake-jira.ts`). No real server recorded them. Each file is a raw response body.

The shapes follow the response examples of the Jira Server platform REST API 9.12.0 docs (checked 2026-10-11): https://docs.atlassian.com/software/jira/docs/api/REST/9.12.0/

| File | Endpoint | Doc anchor |
|---|---|---|
| `myself.json` | `GET /rest/api/2/myself` | `#api/2/myself-getUser` |
| `issue.json` | `GET /rest/api/2/issue/{key}?fields=summary,description,status` | `#api/2/issue-getIssue`; the status object follows `#api/2/status-getStatuses` |
| `comments-p0.json` | `GET /rest/api/2/issue/{key}/comment?startAt=0` | `#api/2/issue-getComments` |
| `comments-p1.json` | `GET /rest/api/2/issue/{key}/comment?startAt=2` | `#api/2/issue-getComments` |

- The two comment pages hold `maxResults: 2`, so one issue needs two pages. The app asks for 100 per page. The server cap on `maxResults` is not documented.
- Host names use `example.test`. Names and texts are invented.
- Replace these files with sanitized real payloads after the Release 2 smoke test (docs/smoke-r2.md).
