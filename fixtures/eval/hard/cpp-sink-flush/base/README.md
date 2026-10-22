# shipper

A small library that ships application log records to the log collector.

- `Record::make()` builds a record. The text is cut at 16 KiB, and control characters become spaces.
- `AsyncSink` queues records and writes them in batches on its own worker thread through a `Transport`.
- `SinkRegistry` names the sinks of a process and counts their dropped records for the metrics page.

A full queue refuses new records: `push()` returns false.
