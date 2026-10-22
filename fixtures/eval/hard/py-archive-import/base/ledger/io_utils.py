"""Readers of the batch file format, version 2 (docs/batch-format.md)."""

import re
from dataclasses import dataclass

from ledger.schema import TABLE_BY_CURRENCY

BATCH_NAME = re.compile(r"[A-Za-z0-9_-]{1,40}")
HEADER = re.compile(r"#batch=(?P<batch>\S+) rows=(?P<rows>\d{1,9}) currency=(?P<currency>[A-Z]{3})")


class BadHeader(ValueError):
    """The first line is not a valid header."""


@dataclass(frozen=True)
class Header:
    batch: str
    rows: int
    currency: str


def read_header(f) -> Header | None:
    """Reads the header line of a batch file.

    Returns None when the file is empty: the upload API creates the file before the body arrives, so an aborted upload
    leaves an empty file. Raises BadHeader for a malformed line, a batch name outside BATCH_NAME, or a currency without a
    ledger table.
    """
    line = f.readline()
    if line == "":
        return None
    m = HEADER.fullmatch(line.rstrip("\r\n"))
    if not m or not BATCH_NAME.fullmatch(m["batch"]) or m["currency"] not in TABLE_BY_CURRENCY:
        raise BadHeader(f"bad header line: {line[:80]!r}")
    return Header(m["batch"], int(m["rows"]), m["currency"])
