"""The upload endpoint of the batch API."""

from pathlib import Path

from ledger import settings
from ledger.io_utils import BATCH_NAME

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
CHUNK = 64 * 1024


class UploadRefused(Exception):
    pass


def save_upload(name: str, stream, length: int | None) -> Path:
    """Streams an upload into INBOX/<name>.csv and refuses a body above MAX_UPLOAD_BYTES.

    The file exists from the first byte on, so an aborted upload leaves an empty or a partial file. The importer rejects both.
    """
    if not BATCH_NAME.fullmatch(name):
        raise UploadRefused("bad file name")
    if length is not None and length > MAX_UPLOAD_BYTES:
        raise UploadRefused("file too large")
    target = settings.INBOX / f"{name}.csv"
    written = 0
    with target.open("wb") as out:
        while chunk := stream.read(CHUNK):
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                out.close()
                target.unlink()
                raise UploadRefused("file too large")
            out.write(chunk)
    return target
