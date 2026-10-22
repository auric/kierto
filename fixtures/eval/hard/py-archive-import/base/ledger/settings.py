"""Settings of the importer and the ledger API. Each value names its unit."""

from pathlib import Path

ROOT = Path("/srv/ledger")
INBOX = ROOT / "inbox"
REJECTED = ROOT / "rejected"
DONE_DIR = ROOT / "done"
ARCHIVE_ROOT = ROOT / "archive"

# Import worker processes. They run at the same time, and each one claims inbox files by renaming them.
WORKERS = 4

# Rows per batch file.
MAX_ROWS = 50_000

# How long a writer waits for the ledger lock, in milliseconds. api/locks.py passes it to SET lock_timeout.
LEDGER_LOCK_TIMEOUT = 30_000
