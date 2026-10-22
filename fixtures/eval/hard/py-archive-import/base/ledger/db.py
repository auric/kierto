"""Database access of the importer."""

import os

import psycopg

# The advisory lock that each ledger writer holds: the importer and the API.
LEDGER_LOCK = 7_301


def connect():
    return psycopg.connect(os.environ["LEDGER_DSN"], autocommit=False)


def try_lock(conn, key: int) -> bool:
    """Takes a session advisory lock without waiting. Returns False when another session holds it."""
    with conn.cursor() as cur:
        cur.execute("SELECT pg_try_advisory_lock(%s)", (key,))
        return bool(cur.fetchone()[0])


def unlock(conn, key: int) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_unlock(%s)", (key,))
