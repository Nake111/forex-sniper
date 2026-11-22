/**
 * Parse the compact status evidence emitted by the signal report.
 * Keep this parser separate so the publication contract is regression-tested.
 */
export function parseStatusEvidence(raw, { statusKey, booleanKey, blockersKey } = {}) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Status evidence must be a non-empty string");
  }
  const parts = raw.split("|").map(value => value.trim());
  const result = {};
  if (statusKey) result[statusKey] = parts[0].split(/\s+/)[0] || "UNKNOWN";
  for (const part of parts.slice(1)) {
    const match = part.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "approved" && booleanKey) {
      if (value.toLowerCase() === "true" || value.toLowerCase() === "false") {
        result[booleanKey] = value.toLowerCase() === "true";
      }
    }
    if (key === "blockers" && blockersKey) {
      try {
        const parsed = JSON.parse(value);
        result[blockersKey] = Array.isArray(parsed) ? parsed : [];
      } catch {
        result[blockersKey] = [];
      }
    }
  }
  if (blockersKey && !Array.isArray(result[blockersKey])) result[blockersKey] = [];
  return result;
}
