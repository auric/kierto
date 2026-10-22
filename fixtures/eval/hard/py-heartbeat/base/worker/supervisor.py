"""Requeues the running jobs whose lease ran out. Cron runs it each minute on the scheduler host."""

import logging

from worker import settings
from worker.db import Pool

log = logging.getLogger(__name__)


def requeue_stale(pool: Pool) -> int:
    with pool.connection() as conn:
        cur = conn.execute(
            """UPDATE jobs SET state = 'queued', worker = NULL
               WHERE state = 'running' AND heartbeat_at < now() - make_interval(secs => %s)""",
            (settings.STALE_AFTER_S,),
        )
    if cur.rowcount:
        log.warning("requeued %d jobs with a stale heartbeat", cur.rowcount)
    return cur.rowcount


if __name__ == "__main__":
    requeue_stale(Pool())
