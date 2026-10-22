"""Database access for the reports. Development and the tests use SQLite."""

import sqlite3
from contextlib import closing

DB_PATH = "sales.db"


def connect(path: str = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def query(sql: str, params: tuple = (), path: str = DB_PATH) -> list[dict]:
    with closing(connect(path)) as conn:
        return [dict(row) for row in conn.execute(sql, params)]
