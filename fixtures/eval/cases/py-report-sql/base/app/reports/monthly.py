from datetime import date

from app.db import query


def monthly_totals(year: int, month: int) -> list[dict]:
    start = date(year, month, 1)
    end = date(year + (month == 12), month % 12 + 1, 1)
    return query(
        """
        SELECT region, SUM(amount_cents) AS total_cents, COUNT(*) AS orders
        FROM sales
        WHERE sold_on >= ? AND sold_on < ?
        GROUP BY region
        ORDER BY region
        """,
        (start.isoformat(), end.isoformat()),
    )
