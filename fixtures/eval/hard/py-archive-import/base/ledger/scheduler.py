"""Runs the import workers.

Each worker claims one inbox file at a time by renaming it, so two workers never import the same file. They do import
files of the same batch name at the same time when two offices upload them.
"""

import logging
import multiprocessing
import os
import time
from pathlib import Path

from ledger import db, settings
from ledger.importer import ImportRejected, import_file

log = logging.getLogger(__name__)


def _claim(path: Path) -> Path | None:
    claimed = path.with_name(f"{path.name}.{os.getpid()}.part")
    try:
        os.rename(path, claimed)
    except FileNotFoundError:
        return None  # another worker was first
    return claimed


def _work() -> None:
    conn = db.connect()
    while True:
        for path in sorted(settings.INBOX.glob("*.csv")):
            claimed = _claim(path)
            if claimed is None:
                continue
            try:
                import_file(claimed, conn)
            except ImportRejected as e:
                log.warning("rejected %s: %s", path.name, e)
                os.rename(claimed, settings.REJECTED / path.name)
            except Exception:
                log.exception("import of %s failed; the file goes back to the inbox", path.name)
                os.rename(claimed, path)
        time.sleep(5)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    procs = [multiprocessing.Process(target=_work, name=f"import-{i}") for i in range(settings.WORKERS)]
    for p in procs:
        p.start()
    for p in procs:
        p.join()


if __name__ == "__main__":
    main()
