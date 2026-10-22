# shop-payments

Payment jobs of the shop. Each worker process takes jobs from the `jobs` table and runs one at a time. Production runs four worker processes.

## Jobs

- `renew-subscription`: charges the next period of a subscription.
- `refund`: refunds a charge.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | | Postgres connection string. |
| `GATEWAY_URL` | | Base URL of the card gateway. |
| `GATEWAY_KEY` | | API key of the card gateway. |
| `PAYMENT_RETRY_ATTEMPTS` | 3 | Attempts per gateway call, 1 to 5. |
| `PAYMENT_RETRY_BASE_MS` | 200 | Wait before the second attempt, 50 to 2000 ms. |
