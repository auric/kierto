"""Price changes from the admin page."""

from decimal import Decimal

from catalog import events
from catalog.repo import PriceRepo


def set_price(repo: PriceRepo, bus: events.EventBus, sku: str, amount: Decimal) -> None:
    if amount <= 0:
        raise ValueError("a price must be positive")
    repo.update(sku, amount)
    bus.publish(events.PRICE_CHANGED, sku=sku)
