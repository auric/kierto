# Webhooks

All webhook routes answer within a few milliseconds: they store the event and queue a job. The `webhook-event` job does the work.

## Carrier

`POST /hooks/carrier`. The carrier sends the shared `CARRIER_TOKEN` in `X-Carrier-Token`. It retries a delivery until it gets a 2xx answer.
