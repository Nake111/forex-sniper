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

const CALENDAR_URL = "https://showmytrades.com/api/public/calendar/v1";
const CALENDAR_TIMEOUT_MS = 12000;
const CALENDAR_MAX_AGE_MS = 30 * 60 * 1000;

export async function getEconomicCalendar({ now = Date.now() } = {}) {
  try {
    const params = new URLSearchParams({
      currency: "EUR,USD",
      impact: "high,medium",
      days: "7",
      format: "json"
    });
    const response = await fetch(`${CALENDAR_URL}?${params}`, {
      signal: AbortSignal.timeout(CALENDAR_TIMEOUT_MS),
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`Calendar HTTP ${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Calendar returned invalid JSON");
    }

    if (!payload || !Array.isArray(payload.events) ||
        !Number.isFinite(Number(payload.server_time))) {
      throw new Error("Calendar response failed schema validation");
    }
    if (payload.events.length === 0) {
      throw new Error("Calendar returned no EUR/USD events; refusing to clear event risk");
    }

    const serverTimeMs = Number(payload.server_time) * 1000;
    if (Math.abs(now - serverTimeMs) > 10 * 60 * 1000) {
      throw new Error("Calendar server clock is stale or inconsistent");
    }

    const generatedAt = Date.parse(payload.generated_at ?? "");
    if (!Number.isFinite(generatedAt) ||
        now - generatedAt < -5 * 60 * 1000 ||
        now - generatedAt > CALENDAR_MAX_AGE_MS) {
      throw new Error("Calendar response is stale or has an invalid generated_at timestamp");
    }

    const events = payload.events.map(raw => {
      if (!raw || typeof raw !== "object" ||
          !["EUR", "USD"].includes(raw.currency) ||
          !["high", "medium"].includes(String(raw.impact).toLowerCase()) ||
          typeof raw.title !== "string" || !raw.title.trim()) {
        throw new Error("Calendar contains an invalid event record");
      }
      const tentative = raw.status === "tentative" ||
        raw.confidence === "sources_disagree";
      const time = tentative ? null : raw.time;
      const date = typeof raw.time === "string" ? raw.time.slice(0, 10) : null;
      return normalizeEconomicEvent({
        id: raw.id,
        name: raw.title,
        country: raw.currency === "USD" ? "US" : "EU",
        impact: raw.impact,
        status: raw.status ?? "scheduled",
        release_at_utc: time,
        date,
        release_tz: "UTC",
        actual: raw.actual,
        consensus: raw.forecast,
        prior: raw.previous,
        unit: raw.unit,
        source_name: "ShowMyTrades Economic Calendar",
        source_url: "https://showmytrades.com/tools/economic-calendar",
        last_verified_at: payload.generated_at,
        data_stale: tentative
      });
    });

    return {
      status: "AVAILABLE",
      provider: "SHOWMYTRADES_FREE",
      sourceUrl: "https://showmytrades.com/docs/api/economic-calendar",
      fetchedAt: new Date(now).toISOString(),
      generatedAt: payload.generated_at,
      serverTime: payload.server_time,
      count: events.length,
      events,
      attribution: payload.attribution ?? null,
      error: null
    };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      provider: "SHOWMYTRADES_FREE",
      sourceUrl: "https://showmytrades.com/docs/api/economic-calendar",
      fetchedAt: new Date(now).toISOString(),
      count: 0,
      events: [],
      error: error.message
    };
  }
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
