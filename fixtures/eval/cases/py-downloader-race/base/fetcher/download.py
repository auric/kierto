import logging
import shutil
from pathlib import Path
from urllib.request import urlopen

from fetcher.naming import safe_name

log = logging.getLogger(__name__)
CHUNK = 64 * 1024


def download_all(urls: list[str], dest: Path, timeout: float = 30.0) -> list[Path]:
    """Downloads each URL into dest, one after the other. A failed URL is logged and skipped."""
    saved = []
    for url in urls:
        target = dest / safe_name(url)
        try:
            with urlopen(url, timeout=timeout) as response, open(target, "wb") as out:
                shutil.copyfileobj(response, out, CHUNK)
        except OSError as e:
            log.warning("download of %s failed: %s", url, e)
            continue
        saved.append(target)
    return saved
