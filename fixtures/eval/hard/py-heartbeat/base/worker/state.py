"""The state of a worker that more than one thread reads."""

import threading


class JobState:
    """The ID of the running job. The runner sets it; the status thread reads it. Each access takes the lock."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._job_id: int | None = None

    @property
    def job_id(self) -> int | None:
        with self._lock:
            return self._job_id

    @job_id.setter
    def job_id(self, value: int | None) -> None:
        with self._lock:
            self._job_id = value
