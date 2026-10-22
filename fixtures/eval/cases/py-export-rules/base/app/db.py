import sqlite3
from contextlib import closing

from app.config import get_setting


def query(sql: str, params: tuple = ()) -> list[dict]:
    with closing(sqlite3.connect(get_setting("DB_PATH", "accounts.db"))) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute(sql, params)]
