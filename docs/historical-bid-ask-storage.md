# Historical bid/ask quote storage

The realtime market-data service appends every normalized quote it publishes to an
NDJSON journal:

- Default: `data/historical-bid-ask.jsonl`
- Override: `QUOTE_HISTORY_PATH=/persistent-volume/historical-bid-ask.jsonl`
- If using a mounted persistent volume, set `DATA_DIR` to the mounted directory
  or set `QUOTE_HISTORY_PATH` directly to a file on that volume.

Each line is an immutable record containing market, provider and venue, bid, ask,
midpoint, absolute spread, spread in basis points, provider timestamp, local receipt
time, quote age, timestamp quality, market state, tradeable flag and validation
results. Provider time and receipt time are never substituted for one another.

The feed exposes `/quote-history-health` to report journal readability, record
count, per-market coverage and the last received quote. The journal is append-only;
it is not committed to Git because it is runtime evidence and can grow continuously.

Important limitations:

- The journal begins collecting when the updated realtime feed is deployed and
  running. It cannot recreate historical bid/ask quotes that were never stored.
- The Biquote and Coinbase adapters currently publish normalized accepted quotes.
  A quote rejected before normalization is not represented as a full bid/ask
  observation in this journal.
- Keep the data directory on persistent storage. An ephemeral container filesystem
  can lose the journal when the service is redeployed or restarted.
- Back up the NDJSON file regularly before rotating or archiving it. Do not rewrite
  existing records; archive completed files and start a new journal if rotation is
  needed.
- This is paper/research market data only. It does not place orders or imply actual
  execution fills.
