const MAX_AGE_MS = Object.freeze({ EURUSD: 15_000, BTCUSD: 15_000, XAUUSD: 15_000 });

/** Freeze one validated quote for every downstream decision layer. */
export function createQuoteSnapshot(quote, market, now = Date.now()) {
  const blockers = [];
  const maxAgeMs = MAX_AGE_MS[market];
  if (!maxAgeMs) blockers.push("Unsupported market for quote snapshot");
  if (!quote || quote.market !== market) blockers.push("Quote market does not match requested market");
  if (!quote || !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) || quote.bid <= 0 || quote.ask <= quote.bid) {
    blockers.push("A positive, uncrossed bid/ask pair is required");
  }
  if (!quote || !Number.isFinite(quote.timestamp) || !Number.isFinite(quote.receivedAt)) {
    blockers.push("Provider timestamp and local receive timestamp are required");
  }
  if (!quote?.source || typeof quote.source !== "string" || !quote?.venue) {
    blockers.push("Quote provider source and venue are required");
  }
  const ageMs = quote && Number.isFinite(quote.timestamp) ? now - quote.timestamp : null;
  const receiveAgeMs = quote && Number.isFinite(quote.receivedAt) ? now - quote.receivedAt : null;
  if (ageMs !== null && (ageMs < -2_000 || ageMs > maxAgeMs)) blockers.push("Provider quote timestamp is future-dated or stale");
  if (receiveAgeMs !== null && (receiveAgeMs < 0 || receiveAgeMs > maxAgeMs)) blockers.push("Locally received quote is future-dated or stale");
  const valid = blockers.length === 0;
  const snapshotId = valid ? [market, quote.timestamp, quote.receivedAt, quote.bid, quote.ask, quote.source, quote.venue].join("|") : null;
  const frozenQuote = valid ? Object.freeze({ ...quote, snapshotId }) : null;
  return {
    valid, snapshotId, market, maxAgeMs, ageMs: ageMs === null ? null : Math.max(0, ageMs),
    receiveAgeMs: receiveAgeMs === null ? null : Math.max(0, receiveAgeMs),
    quote: frozenQuote,
    validation: { valid, snapshotId, ageMs: ageMs === null ? null : Math.max(0, ageMs), spread: valid ? quote.ask - quote.bid : null,
      reason: blockers.join("; ") || null, timestampQuality: quote?.timestampQuality ?? "UNKNOWN",
      bid: valid ? quote.bid : null, ask: valid ? quote.ask : null,
      timestamp: valid ? quote.timestamp : null, receivedAt: valid ? quote.receivedAt : null,
      source: valid ? quote.source : null, venue: valid ? quote.venue : null },
    blockers
  };
}

export function validateQuoteSnapshot(snapshot, quote, now = Date.now()) {
  if (!snapshot?.valid || !snapshot.snapshotId || !quote || quote.snapshotId !== snapshot.snapshotId) {
    return { valid: false, reason: "Quote snapshot identity mismatch" };
  }
  if (snapshot.market !== quote.market) return { valid: false, reason: "Quote snapshot market mismatch" };
  const frozen = snapshot.quote;
  if (!frozen || ["bid", "ask", "timestamp", "receivedAt", "source", "venue"].some(key => frozen[key] !== quote[key])) {
    return { valid: false, reason: "Quote values changed after snapshot creation" };
  }
  if (now - quote.timestamp > snapshot.maxAgeMs || now - quote.receivedAt > snapshot.maxAgeMs) {
    return { valid: false, reason: "Quote snapshot expired before approval" };
  }
  return { valid: true, snapshotId: snapshot.snapshotId };
}
