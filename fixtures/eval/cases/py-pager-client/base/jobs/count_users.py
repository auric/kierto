"""Reports the number of directory users to the license dashboard."""

from client import DirectoryClient


def run(client: DirectoryClient, dashboard) -> int:
    total = 0
    page = 1
    while True:
        data = client.fetch_page(page)
        total += len(data["items"])
        if page >= data["total_pages"]:
            break
        page += 1
    dashboard.report("directory_users", total)
    return total
