from app.config import get_setting
from app.db import query


def list_accounts(params: dict[str, str]) -> tuple[int, dict]:
    try:
        page = int(params.get("page", "0"))
    except ValueError:
        return 400, {"error": "page must be an integer"}
    size = int(get_setting("PAGE_SIZE", "50"))
    rows = query(
        "SELECT id, email, name FROM accounts WHERE deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?",
        (size, max(page, 0) * size),
    )
    return 200, {"accounts": rows, "page": page}
