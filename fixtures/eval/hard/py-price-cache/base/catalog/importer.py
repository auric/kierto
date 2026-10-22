"""Bulk import of the supplier price feed. The admin page starts it in the web process."""

import csv
from decimal import Decimal

from catalog import events
from catalog.repo import PriceRepo


def parse_feed(text: str) -> list[tuple[str, Decimal]]:
    return [(sku, Decimal(amount)) for sku, amount in csv.reader(text.splitlines())]


def import_prices(repo: PriceRepo, bus: events.EventBus, rows: list[tuple[str, Decimal]]) -> int:
    """Writes all prices in one transaction, then publishes one CATALOG_RELOADED event.

    It sends no PRICE_CHANGED per SKU: a feed has up to 200 000 rows.
    """
    count = repo.update_many(rows)
    bus.publish(events.CATALOG_RELOADED, count=count)
    return count
