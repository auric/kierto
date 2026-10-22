"""Database access."""

import os
from contextlib import contextmanager

from psycopg_pool import ConnectionPool


class Pool:
    """A thread-safe connection pool. Each connection() block leases its own connection, so threads never share one.

    Each statement gets a 5 s timeout, so no caller waits longer on the database.
    """

    def __init__(self, dsn: str | None = None, size: int = 4) -> None:
        self._pool = ConnectionPool(
            dsn or os.environ["WORKER_DSN"],
            min_size=1,
            max_size=size,
            kwargs={"options": "-c statement_timeout=5000", "connect_timeout": 5},
        )

    @contextmanager
    def connection(self):
        """Leases a connection. The block commits on success and rolls back on an exception."""
        with self._pool.connection() as conn:
            yield conn

    def close(self) -> None:
        self._pool.close()
