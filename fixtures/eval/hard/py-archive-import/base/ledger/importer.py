"""Imports one claimed batch file into the ledger table."""

import csv
import logging
from decimal import Decimal, InvalidOperation
from pathlib import Path

from ledger import settings

log = logging.getLogger(__name__)


class ImportRejected(Exception):
    """The file breaks a rule. The scheduler moves it to the rejected folder."""


def _row(fields: list[str], line: int) -> tuple[str, Decimal, str]:
    if len(fields) != 3:
        raise ImportRejected(f"line {line}: expected 3 fields")
    account, amount, booked_on = fields
    try:
        value = Decimal(amount)
    except InvalidOperation:
        raise ImportRejected(f"line {line}: bad amount {amount!r}") from None
    return account, value, booked_on


def import_file(path: Path, conn) -> int:
    """Inserts the rows of a claimed file of format version 1 (no header, EUR only) and moves it to the done folder."""
    batch = path.name.split(".")[0]
    with path.open(newline="", encoding="utf-8") as f:
        rows = [_row(fields, n) for n, fields in enumerate(csv.reader(f), start=1)]
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO ledger_eur (batch, account, amount, booked_on) VALUES (%s, %s, %s, %s)",
            [(batch, *r) for r in rows],
        )
    conn.commit()
    path.rename(settings.DONE_DIR / f"{batch}.csv")
    log.info("imported %s: %d rows", batch, len(rows))
    return len(rows)
