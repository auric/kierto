# M1 manual smoke test on the real server

This test checks M1 against a real Bitbucket Server. The user runs it. The automated suites use fixtures only.

## Rules

- Run this test only when the user gives explicit authorization for it.
- Use only the designated test pull request. Do not touch other pull requests.
- Use a new, empty data folder. Never use the data folder of your daily instance.
- Do not copy the token, host names, or pull request data into files, issues, or chat.
- In this document, `<BITBUCKET_URL>` is the base URL of the server and `<TEST_PR_URL>` is the URL of the test pull request.

## Preparation

1. Run `bun install` and `bun run build`.
2. Make a new temp folder. PowerShell: `$env:REVIEW_LOOP_DATA_DIR = Join-Path $env:TEMP "review-loop-smoke-$(Get-Random)"`. Bash: `export REVIEW_LOOP_DATA_DIR="$(mktemp -d)"`.
3. Run `bun run start` in the same terminal. Open `http://127.0.0.1:7317/`.

## Steps

1. Enter `<BITBUCKET_URL>` and your access token in the settings screen. Click Save. Expect "Signed in as" with your user name. Expect "Token kept in the system credential store on this machine."
2. Click "Check now". Expect your open pull requests in the list. Expect no unread badge and no notification after this first check.
3. If the test pull request is not in the list, paste `<TEST_PR_URL>` into the filter and click "Follow this pull request".
4. Open the test pull request. Expect its description and its threads.
5. Open Settings and turn on notifications. Allow them in the browser.
6. In Bitbucket, add a comment on the test pull request. Click "Check now". Expect the comment in the Activity tab.
7. In Bitbucket, edit that comment. Click "Check now". Expect the new text.
8. In Bitbucket, delete that comment. Click "Check now". Expect "Deleted on Bitbucket" in place of the text. If the text stays for one check, click "Check now" again.
9. If possible, ask a colleague to reply to your comment on the test pull request. Expect one unread message, one notification, and the "Reply to you" badge. Click the notification. Expect the test pull request to open.
10. Push one commit to the branch of the test pull request. Record the RESCOPED activity shape for decision D3 and assumption U1. Remove all company data before you save the record.
11. Disconnect the VPN or the network. Wait for two checks, or click "Check now" two times. Expect "Offline. Last checked HH:MM." and expect no message to show as deleted.
12. Connect the VPN again. Click "Check now". Expect "Checked HH:MM" and the same messages as before.
13. Stop the app with Ctrl+C. Run `bun run start` again in the same terminal. Reload the page. Expect the same unread state as before the restart.
14. Search the data folder for the token. PowerShell: `Select-String -Path "$env:REVIEW_LOOP_DATA_DIR\*" -Pattern "<first 8 characters of the token>"`. Expect no hit.
15. Search the terminal output and the browser console for the same text. Expect no hit.

## Cleanup

1. Stop the app with Ctrl+C.
2. Delete the folder in `REVIEW_LOOP_DATA_DIR`.
3. Delete the test comments in Bitbucket if they are no longer necessary.
4. Record the result of each step, the date, the operating system, and the app commit. Do not record company data.
