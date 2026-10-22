"""Ledger writes of the API."""

from ledger import db, settings


def correct_booking(conn, table: str, booking_id: int, amount) -> None:
    """Changes the amount of one booking. Postgres waits at most LEDGER_LOCK_TIMEOUT for the row and the advisory lock."""
    with conn.cursor() as cur:
        cur.execute(f"SET LOCAL lock_timeout = {int(settings.LEDGER_LOCK_TIMEOUT)}")
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (db.LEDGER_LOCK,))
        cur.execute(f"UPDATE {table} SET amount = %s WHERE id = %s", (amount, booking_id))
    conn.commit()
