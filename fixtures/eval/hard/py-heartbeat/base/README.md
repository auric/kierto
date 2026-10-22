# job-worker

Runs the background jobs of the reporting service from the `jobs` table.

- A worker claims one job at a time. The claim gives it a lease: `worker` and `heartbeat_at` on the job row.
- A handler is a generator. Each `yield` ends one step, and the runner moves `heartbeat_at` after each step.
- `worker/supervisor.py` runs each minute on the scheduler host. It puts a running job back into the queue when its `heartbeat_at` is older than `STALE_AFTER_S`.
- A worker that lost its lease cannot complete the job: `complete()` raises `LostOwnership`.
- `GET /status` on port 9102 shows the job that the worker runs.
