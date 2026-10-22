import hashlib
import re
from pathlib import PurePosixPath
from urllib.parse import urlparse


def safe_name(url: str) -> str:
    """A file name for a URL: a short hash of the URL, then the last path part with unsafe characters replaced."""
    base = PurePosixPath(urlparse(url).path).name or "index"
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)[:100]
    return f"{hashlib.sha1(url.encode()).hexdigest()[:8]}-{base}"
