"""Client of the people directory API."""

import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

RETRY_STATUS = {429, 502, 503, 504}


class DirectoryClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        retries: int = 5,
        timeout: float = 10.0,
        backoff: float = 0.5,
        opener=urlopen,
    ):
        self.base_url = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        self.retries = retries
        self.timeout = timeout
        self.backoff = backoff
        self._open = opener

    def fetch_page(self, page: int, per_page: int = 100) -> dict:
        """One page of users. page counts from 1. Returns {"items": [...], "total_pages": n}."""
        if page < 1:
            raise ValueError("page counts from 1")
        body = self._get("/api/v1/users", {"page": page, "per_page": per_page})
        return {"items": body["users"], "total_pages": body["total_pages"]}

    def _get(self, path: str, params: dict) -> dict:
        url = f"{self.base_url}{path}?{urlencode(params)}"
        last: Exception | None = None
        for attempt in range(self.retries):
            try:
                with self._open(Request(url, headers=self._headers), timeout=self.timeout) as r:
                    return json.load(r)
            except HTTPError as e:
                if e.code not in RETRY_STATUS:
                    raise
                last = e
            except URLError as e:
                last = e
            time.sleep(self.backoff * 2**attempt)
        raise RuntimeError(f"GET {path} failed after {self.retries} attempts") from last
