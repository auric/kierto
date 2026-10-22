from worker.queue import Job, LostOwnership
from worker.runner import run_job
from worker.state import JobState


class FakeQueue:
    def __init__(self, jobs, lose=False):
        self.jobs = list(jobs)
        self.lose = lose
        self.calls = []

    def claim(self, worker_id):
        return self.jobs.pop(0) if self.jobs else None

    def beat(self, job_id, worker_id):
        self.calls.append(("beat", job_id))

    def complete(self, job_id, worker_id, result):
        if self.lose:
            raise LostOwnership(str(job_id))
        self.calls.append(("complete", job_id, result))

    def fail(self, job_id, worker_id, error):
        self.calls.append(("fail", job_id, error))


def two_steps(payload):
    yield 1
    yield {"done": payload["n"]}


def broken(payload):
    raise ValueError("bad payload")
    yield


HANDLERS = {"two": two_steps, "broken": broken}


def test_runs_a_job_and_stores_the_last_value():
    q = FakeQueue([Job(1, "two", {"n": 3})])
    assert run_job(q, HANDLERS, JobState(), "w1")
    assert q.calls == [("beat", 1), ("beat", 1), ("complete", 1, {"done": 3})]


def test_an_empty_queue_returns_false():
    assert not run_job(FakeQueue([]), HANDLERS, JobState(), "w1")


def test_a_failed_handler_marks_the_job_failed():
    q = FakeQueue([Job(2, "broken", {})])
    run_job(q, HANDLERS, JobState(), "w1")
    assert q.calls == [("fail", 2, "ValueError: bad payload")]


def test_a_lost_lease_drops_the_result():
    q = FakeQueue([Job(3, "two", {"n": 1})], lose=True)
    state = JobState()
    run_job(q, HANDLERS, state, "w1")
    assert ("complete", 3, {"done": 1}) not in q.calls
    assert state.job_id is None
