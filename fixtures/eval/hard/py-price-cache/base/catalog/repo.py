"""Price storage."""

from decimal import Decimal

from catalog.model import Price


class PriceRepo:
    def __init__(self, conn):
        self._conn = conn

    def get(self, sku: str) -> Price | None:
        with self._conn.cursor() as cur:
            cur.execute("SELECT sku, amount, currency FROM prices WHERE sku = %s", (sku,))
            row = cur.fetchone()
        return Price(*row) if row else None

    def get_many(self, skus: list[str]) -> dict[str, Price]:
        """The prices of the known SKUs. Unknown SKUs are missing from the result."""
        if not skus:
            return {}
        marks = ", ".join(["%s"] * len(skus))
        with self._conn.cursor() as cur:
            cur.execute(f"SELECT sku, amount, currency FROM prices WHERE sku IN ({marks})", skus)
            return {row[0]: Price(*row) for row in cur.fetchall()}

    def update(self, sku: str, amount: Decimal) -> None:
        with self._conn.cursor() as cur:
            cur.execute("UPDATE prices SET amount = %s WHERE sku = %s", (amount, sku))
        self._conn.commit()

    def update_many(self, rows: list[tuple[str, Decimal]]) -> int:
        with self._conn.cursor() as cur:
            cur.executemany("UPDATE prices SET amount = %s WHERE sku = %s", [(amount, sku) for sku, amount in rows])
        self._conn.commit()
        return len(rows)
