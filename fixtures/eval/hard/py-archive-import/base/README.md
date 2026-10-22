# ledger-import

Imports the booking batches that the branch offices upload into the ledger tables.

- `api/upload.py` writes each upload to `/srv/ledger/inbox`.
- `ledger/scheduler.py` runs `WORKERS` import processes. Each one claims an inbox file by renaming it and calls `import_file()`.
- A rejected file goes to `/srv/ledger/rejected`. Any other failure puts the file back into the inbox for the next round.

The branch offices pick the batch names. Two offices can upload a batch of the same name at the same time.
