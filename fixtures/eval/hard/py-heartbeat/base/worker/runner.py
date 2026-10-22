"""The claim, run, and complete loop of one worker."""

import logging
import time
from collections.abc import Callable, Iterator

from worker import settings
from worker.queue import LostOwnership, Queue
from worker.state import JobState

log = logging.getLogger(__name__)

# A handler takes the job payload and yields once per step. The last yielded value is the result.
Handler = Callable[[dict], Iterator[object]]


def run_job(queue: Queue, handlers: dict[str, Handler], state: JobState, worker_id: str) -> bool:
    """Claims and runs one job. Returns False when the queue was empty."""
    job = queue.claim(worker_id)
    if job is None:
        return False
    state.job_id = job.id
    try:
        result = None
        for result in handlers[job.kind](job.payload):
            queue.beat(job.id, worker_id)
        queue.complete(job.id, worker_id, result)
    except LostOwnership:
        log.warning("job %s went to another worker; its result is dropped", job.id)
    except Exception as e:
        log.exception("job %s failed", job.id)
        queue.fail(job.id, worker_id, f"{type(e).__name__}: {e}")
    finally:
        state.job_id = None
    return True


def run_forever(queue: Queue, handlers: dict[str, Handler], state: JobState, worker_id: str) -> None:
    while True:
        if not run_job(queue, handlers, state, worker_id):
            time.sleep(settings.POLL_INTERVAL_S)
