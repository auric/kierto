# shop-catalog

The catalog service of the shop: products and prices.

- One process with one thread serves all requests (`app.py`). The event bus is in that process.
- `catalog/admin.py` changes single prices from the admin page.
- `catalog/importer.py` imports the supplier price feed (up to 200 000 rows) from the admin page, in the same process.
- `GET /prices?sku=...&sku=...` answers the shop pages, about 400 requests per second at peak.
