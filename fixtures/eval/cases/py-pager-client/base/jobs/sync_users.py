"""Copies the directory users into the local accounts table. Accounts that the directory no longer lists get disabled."""

import logging

from client import DirectoryClient

log = logging.getLogger(__name__)


def run(client: DirectoryClient, accounts) -> int:
    seen: set[str] = set()
    page = 1
    while True:
        data = client.fetch_page(page)
        for user in data["items"]:
            accounts.upsert(user["id"], user["email"], user["name"])
            seen.add(user["id"])
        if page >= data["total_pages"]:
            break
        page += 1
    disabled = accounts.disable_all_except(seen)
    log.info("synced %d users, disabled %d accounts", len(seen), disabled)
    return len(seen)
