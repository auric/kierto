"""Starts one worker process."""

import logging
import os
import socket

from worker import settings
from worker.db import Pool
from worker.handlers import HANDLERS
from worker.queue import Queue
from worker.runner import run_forever
from worker.state import JobState
from worker.status import serve_status


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    worker_id = f"{socket.gethostname()}-{os.getpid()}"
    pool = Pool()
    state = JobState()
    serve_status(state, worker_id, settings.STATUS_PORT)
    run_forever(Queue(pool), HANDLERS, state, worker_id)


if __name__ == "__main__":
    main()
