"""Worker settings. Each name gives its unit."""

# Wait between two claims when the queue is empty.
POLL_INTERVAL_S = 1.0

# A worker moves heartbeat_at of its running job at least this often.
HEARTBEAT_INTERVAL_S = 10.0

# The supervisor requeues a running job whose heartbeat_at is older than this: six missed heartbeats.
STALE_AFTER_S = 60

STATUS_PORT = 9102
