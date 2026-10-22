from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Price:
    sku: str
    amount: Decimal
    currency: str
