function parseInstant(event) {
  const raw = event.release_at_utc ?? event.time_utc;
  if (!raw) return null;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : null;
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).trim().replace(/,/g, "").match(/^([+-]?\d+(?:\.\d+)?)\s*([KMBT])?\s*%?$/i);
  if (!match) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return Number(match[1]) * (scale[(match[2] ?? "").toUpperCase()] ?? 1);
}

export function normalizeEconomicEvent(event) {
  const timestamp = parseInstant(event);
  const actual = numericValue(event.actual);
  const consensus = numericValue(event.consensus);
  const comparable = actual !== null && consensus !== null;
  const difference = comparable ? actual - consensus : null;
  return {
    id: String(event.id ?? event.native_id ?? event.series_code ?? event.name ?? "unknown"),
    name: String(event.name ?? event.title ?? event.series_name ?? "Unnamed economic release"),
    country: event.country ?? null,
    impact: ["high", "medium", "low"].includes(String(event.impact).toLowerCase())
      ? String(event.impact).toUpperCase() : "UNKNOWN",
    category: event.category ?? null,
    status: event.status ?? "unknown",
    timestamp,
    scheduledAt: timestamp === null ? null : new Date(timestamp).toISOString(),
    date: event.date ?? null,
    releaseTimezone: event.release_tz ?? null,
    timePrecision: event.time_precision ?? (timestamp === null ? "unknown" : "minute"),
    allDay: event.all_day === true,
    actual: event.actual ?? null,
    consensus: event.consensus ?? null,
    prior: event.prior ?? null,
    unit: event.unit ?? null,
    surprise: comparable ? {
      difference,
      direction: difference > 0 ? "ABOVE_CONSENSUS" : difference < 0 ? "BELOW_CONSENSUS" : "INLINE",
      note: "Numerical comparison only; above/below consensus is not automatically bullish or bearish for a currency."
    } : null,
    source: event.source_name ?? "Unspecified",
    sourceUrl: event.source_url ?? event.url ?? null,
    lastVerifiedAt: event.last_verified_at ?? null,
    dataStale: event.data_stale === true || event.data_quality?.schedule?.stale === true,
    sourceLicense: event.source_license ?? null,
    sourceRights: event.source_rights ?? null,
    sourceNotice: event.source_notice ?? event.source_rights?.notice ?? null
  };
}

// Finance Calendar is removed. No automated provider is configured, so the
// calendar gate deliberately fails closed until a replacement is verified.
export async function getEconomicCalendar({ now = Date.now() } = {}) {
  return {
    status: "UNAVAILABLE",
    provider: "NO_AUTOMATED_PROVIDER",
    sourceUrl: null,
    fetchedAt: new Date(now).toISOString(),
    count: 0,
    events: [],
    error: "No automated economic calendar provider is configured. Forex Factory is a manual cross-check only; automated event-risk clearance is unavailable."
  };
}

function dateInTimezone(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(now));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.year + "-" + values.month + "-" + values.day;
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

const HIGH_PRE_MINUTES = 15;
const HIGH_POST_MINUTES = 15;
const MEDIUM_PRE_MINUTES = 5;
const MEDIUM_POST_MINUTES = 5;

export function evaluateEconomicRisk(calendar, market, now = Date.now()) {
  if (calendar?.status !== "AVAILABLE") {
    return {
      status: "UNKNOWN",
      blocked: true,
      reason: "Economic calendar unavailable; no event-risk clearance can be claimed.",
      activeEvents: [],
      nextEvents: []
    };
  }
  const currencies = market === "EURUSD" ? new Set(["US", "EU", "DE"])
    : market === "XAUUSD" || market === "BTCUSD" ? new Set(["US"])
      : new Set(["US", "EU", "GB", "JP", "CA", "AU", "CH", "NZ"]);
  const relevant = (calendar.events ?? []).filter(event =>
    currencies.has(event.country) && event.status !== "cancelled"
  );
  if (relevant.some(event => event.dataStale)) {
    return {
      status: "STALE_SOURCE_DATA", blocked: true,
      reason: "A relevant event record is flagged stale by its source; refusing to clear event risk.",
      activeEvents: [], nextEvents: []
    };
  }
  const activeEvents = [];
  const nextEvents = [];
  let unknownTimeBlock = false;
  for (const event of relevant) {
    const eventIsToday = event.date === dateInTimezone(now, event.releaseTimezone);
    if (event.timestamp === null) {
      if (event.impact === "HIGH" && eventIsToday) unknownTimeBlock = true;
      continue;
    }
    const before = event.impact === "HIGH" ? HIGH_PRE_MINUTES * 60000
      : event.impact === "MEDIUM" ? MEDIUM_PRE_MINUTES * 60000 : 0;
    const after = event.impact === "HIGH" ? HIGH_POST_MINUTES * 60000
      : event.impact === "MEDIUM" ? MEDIUM_POST_MINUTES * 60000 : 0;
    const delta = event.timestamp - now;
    if (delta >= -after && delta <= before) activeEvents.push(event);
    else if (delta > before && delta <= 24 * 60 * 60 * 1000) nextEvents.push(event);
  }
  if (unknownTimeBlock) return {
    status: "UNKNOWN_TIME_HIGH_IMPACT", blocked: true,
    reason: "A relevant high-impact release is listed for today without a verified release time.",
    activeEvents: [], nextEvents: nextEvents.slice(0, 5)
  };
  if (activeEvents.length) return {
    status: "HIGH", blocked: true,
    reason: "Inside the pre/post-release protection window for a relevant high- or medium-impact event.",
    activeEvents: activeEvents.sort((a, b) => a.timestamp - b.timestamp),
    nextEvents: nextEvents.slice(0, 5)
  };
  return {
    status: "NORMAL", blocked: false,
    reason: "Calendar feed is available; no relevant event is inside the configured protection window.",
    activeEvents: [], nextEvents: nextEvents.slice(0, 5)
  };
}
