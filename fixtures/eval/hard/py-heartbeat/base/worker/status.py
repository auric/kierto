"""GET /status: the job that this worker runs."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from worker.state import JobState


def serve_status(state: JobState, worker_id: str, port: int) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/status":
                self.send_error(404)
                return
            body = json.dumps({"worker": worker_id, "job": state.job_id}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, name="status", daemon=True).start()
    return server
