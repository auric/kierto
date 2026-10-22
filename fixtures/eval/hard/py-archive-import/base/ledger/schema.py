"""The ledger tables. Each currency has its own table, partitioned by booking month."""

TABLE_BY_CURRENCY = {
    "EUR": "ledger_eur",
    "USD": "ledger_usd",
    "GBP": "ledger_gbp",
    "CHF": "ledger_chf",
}
