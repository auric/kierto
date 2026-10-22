"""Request validation of the catalog API."""

import re

SKU = re.compile(r"[A-Z]{1,4}-\d{1,8}")
MAX_SKUS = 100


class BadRequest(ValueError):
    pass


def parse_skus(values: list[str]) -> list[str]:
    """The SKUs of a request: 1 to MAX_SKUS values that match SKU, without duplicates, in request order."""
    if not 1 <= len(values) <= MAX_SKUS:
        raise BadRequest(f"give 1 to {MAX_SKUS} sku values")
    bad = [v for v in values if not SKU.fullmatch(v)]
    if bad:
        raise BadRequest(f"bad sku: {bad[0][:20]}")
    return list(dict.fromkeys(values))
