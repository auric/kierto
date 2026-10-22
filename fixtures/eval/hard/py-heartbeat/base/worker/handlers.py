"""The job handlers. Each one yields once per step."""

import time
import urllib.request


def export_report(payload: dict):
    """Renders a report by month. A month can take minutes in one render call."""
    rendered = []
    for month in payload["months"]:
        rendered.append(_render(payload["report"], month))
        yield len(rendered)
    yield {"months": len(rendered)}


def warm_cache(payload: dict):
    """Fetches each URL once, so the CDN caches it."""
    for url in payload["urls"]:
        with urllib.request.urlopen(url, timeout=30) as r:
            r.read()
        yield url
    yield {"urls": len(payload["urls"])}


def _render(report: str, month: str) -> str:
    time.sleep(0.01)
    return f"{report}-{month}.pdf"


HANDLERS = {"export_report": export_report, "warm_cache": warm_cache}
