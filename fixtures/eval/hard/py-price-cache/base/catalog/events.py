"""The in-process event bus. publish() calls each subscriber in the publishing thread, in subscription order."""

from collections import defaultdict
from collections.abc import Callable

# One price changed. Payload: sku.
PRICE_CHANGED = "price.changed"
# The bulk import replaced many prices at once. Payload: count. No PRICE_CHANGED event follows for the single SKUs.
CATALOG_RELOADED = "catalog.reloaded"


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, list[Callable[..., None]]] = defaultdict(list)

    def subscribe(self, name: str, fn: Callable[..., None]) -> None:
        self._subscribers[name].append(fn)

    def publish(self, name: str, **payload) -> None:
        for fn in list(self._subscribers[name]):
            fn(**payload)
