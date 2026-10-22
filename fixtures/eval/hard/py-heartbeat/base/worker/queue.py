"""The job queue on the jobs table. Each call leases its own pooled connection."""

import json
from dataclasses import dataclass

from worker.db import Pool


class LostOwnership(Exception):
    """The supervisor gave the job to another worker. The result of this worker must not count."""


@dataclass(frozen=True)
class Job:
    id: int
    kind: str
    payload: dict


class Queue:
    def __init__(self, pool: Pool) -> None:
        self._pool = pool

    def claim(self, worker_id: str) -> Job | None:
        """Takes the oldest queued job and starts its lease: worker, state running, and heartbeat_at = now()."""
        with self._pool.connection() as conn:
            row = conn.execute(
                """UPDATE jobs SET state = 'running', worker = %s, heartbeat_at = now()
                   WHERE id = (SELECT id FROM jobs WHERE state = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
                   RETURNING id, kind, payload""",
                (worker_id,),
            ).fetchone()
        return Job(row[0], row[1], row[2]) if row else None

    def beat(self, job_id: int, worker_id: str) -> None:
        """Moves heartbeat_at. Does nothing when the job ended or another worker owns it."""
        with self._pool.connection() as conn:
            conn.execute(
                "UPDATE jobs SET heartbeat_at = now() WHERE id = %s AND worker = %s AND state = 'running'",
                (job_id, worker_id),
            )

    def complete(self, job_id: int, worker_id: str, result) -> None:
        """Stores the result. Raises LostOwnership when this worker no longer owns the running job."""
        with self._pool.connection() as conn:
            cur = conn.execute(
                "UPDATE jobs SET state = 'done', result = %s WHERE id = %s AND worker = %s AND state = 'running'",
                (json.dumps(result), job_id, worker_id),
            )
            if cur.rowcount != 1:
                raise LostOwnership(f"job {job_id}")

    def fail(self, job_id: int, worker_id: str, error: str) -> None:
        """Marks the job failed. Does nothing when this worker no longer owns it."""
        with self._pool.connection() as conn:
            conn.execute(
                "UPDATE jobs SET state = 'failed', error = %s WHERE id = %s AND worker = %s AND state = 'running'",
                (error[:2000], job_id, worker_id),
            )
