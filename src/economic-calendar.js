function parseInstant(event) {
  const raw = event.release_at_utc ?? event.time_utc ?? event.time;
  if (!raw) return null;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : null;
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).trim().replace(/,/g, "").match(/^([+-]?\\d+(?:\\.\\d+)?)\\s*([KMBT])?\\s*%?$/i);
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
    currency: event.currency ?? null,
    impact: ["high", "medium", "low"].includes(String(event.impact).toLowerCase())
      ? String(event.impact).toUpperCase() : "UNKNOWN",
    category: event.category ?? null,
    status: event.status ?? "unknown",
    timestamp,
    scheduledAt: timestamp === null ? null : new Date(timestamp).toISOString(),
    date: event.date ?? (timestamp === null ? null : new Date(timestamp).toISOString().slice(0, 10)),
    releaseTimezone: event.release_tz ?? "UTC",
    timePrecision: event.time_precision ?? (timestamp === null ? "unknown" : "second"),
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
    source: event.source_name ?? "ShowMyTrades Economic Calendar",
    sourceUrl: event.source_url ?? "https://showmytrades.com/tools/economic-calendar",
    lastVerifiedAt: event.last_verified_at ?? null,
    scheduleConfidence: event.schedule_confidence ?? "UNKNOWN",
    scheduleUncertain: event.schedule_uncertain === true,
    dataStale: event.data_stale === true || event.data_quality?.schedule?.stale === true,
    sourceLicense: event.source_license ?? null,
    sourceRights: event.source_rights ?? null,
    sourceNotice: event.source_notice ?? event.source_rights?.notice ?? null
  };
}

const CALENDAR_URL = "https://showmytrades.com/api/public/calendar/v1";
const CALENDAR_DOCS = "https://showmytrades.com/docs/api/economic-calendar";
const CALENDAR_TIMEOUT_MS = 12000;
const CALENDAR_MAX_AGE_MS = 30 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 10 * 60 * 1000;
const MIN_FORWARD_COVERAGE_MS = 24 * 60 * 60 * 1000;

function unavailable(now, error) {
  return {
    status: "UNAVAILABLE",
    provider: "SHOWMYTRADES_FREE",
    sourceUrl: CALENDAR_DOCS,
    fetchedAt: new Date(now).toISOString(),
    count: 0,
    events: [],
    error: error instanceof Error ? error.message : String(error)
  };
}

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
    if (!response.ok) throw new Error(`Calendar HTTP ${response.status}`);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Calendar returned invalid JSON");
    }

    if (!payload || !Array.isArray(payload.events) ||
        !Number.isFinite(Number(payload.server_time)) ||
        typeof payload.server_time_iso !== "string" ||
        typeof payload.generated_at !== "string" ||
        !Number.isFinite(Number(payload.count)) ||
        !Number.isFinite(Date.parse(payload.from ?? "")) ||
        !Number.isFinite(Date.parse(payload.to ?? ""))) {
      throw new Error("Calendar response failed the documented API schema");
    }
    if (Number(payload.count) !== payload.events.length) {
      throw new Error("Calendar event count does not match the returned event list");
    }

    const serverTimeMs = Number(payload.server_time) * 1000;
    const serverIsoMs = Date.parse(payload.server_time_iso);
    if (!Number.isFinite(serverIsoMs) || Math.abs(serverTimeMs - serverIsoMs) > 2000) {
      throw new Error("Calendar server_time and server_time_iso disagree");
    }
    if (Math.abs(now - serverTimeMs) > CLOCK_TOLERANCE_MS) {
      throw new Error("Calendar server clock is stale or inconsistent with the runner clock");
    }

    const generatedAt = Date.parse(payload.generated_at);
    if (!Number.isFinite(generatedAt) ||
        generatedAt - serverTimeMs > 5 * 60 * 1000 ||
        serverTimeMs - generatedAt > CALENDAR_MAX_AGE_MS) {
      throw new Error("Calendar response is stale or has an invalid generated_at timestamp");
    }

    const fromMs = Date.parse(payload.from);
    const toMs = Date.parse(payload.to);
    if (fromMs > serverTimeMs || toMs < serverTimeMs + MIN_FORWARD_COVERAGE_MS) {
      throw new Error("Calendar response does not cover the current time and at least 24 hours ahead");
    }

    const events = payload.events.map(raw => {
      if (!raw || typeof raw !== "object" ||
          !["EUR", "USD"].includes(raw.currency) ||
          !["high", "medium"].includes(String(raw.impact).toLowerCase()) ||
          typeof raw.title !== "string" || !raw.title.trim() ||
          typeof raw.id !== "string" || !raw.id.trim() ||
          !["scheduled", "moved", "tentative"].includes(raw.status) ||
          !["official", "sources_agree", "single_source", "sources_disagree"].includes(raw.confidence)) {
        throw new Error("Calendar contains an invalid or undocumented event record");
      }

      const tsMs = Number.isFinite(Number(raw.ts)) ? Number(raw.ts) * 1000 : null;
      const timeMs = Date.parse(raw.time ?? "");
      if (tsMs === null || !Number.isFinite(timeMs) || Math.abs(tsMs - timeMs) > 2000) {
        throw new Error("Calendar event timestamp fields are missing or inconsistent");
      }
      const uncertain = raw.status === "tentative" ||
        raw.confidence === "sources_disagree" ||
        raw.confidence === "single_source";
      const eventTime = uncertain ? null : new Date(tsMs).toISOString();
      return normalizeEconomicEvent({
        id: raw.id,
        name: raw.title,
        country: raw.currency === "USD" ? "US" : "EU",
        currency: raw.currency,
        impact: raw.impact,
        status: raw.status,
        release_at_utc: eventTime,
        date: new Date(tsMs).toISOString().slice(0, 10),
        release_tz: "UTC",
        actual: raw.actual,
        consensus: raw.forecast,
        prior: raw.previous,
        source_name: "ShowMyTrades Economic Calendar",
        source_url: "https://showmytrades.com/tools/economic-calendar",
        last_verified_at: payload.generated_at,
        schedule_confidence: raw.confidence,
        schedule_uncertain: uncertain
      });
    });

    return {
      status: "AVAILABLE",
      provider: "SHOWMYTRADES_FREE",
      sourceUrl: CALENDAR_DOCS,
      fetchedAt: new Date(now).toISOString(),
      generatedAt: payload.generated_at,
      serverTime: payload.server_time,
      coverage: { from: payload.from, to: payload.to, requestedDays: 7 },
      count: events.length,
      events,
      attribution: payload.attribution ?? {
        required: false,
        text: "Economic calendar by ShowMyTrades",
        url: "https://showmytrades.com/tools/economic-calendar"
      },
      error: null
    };
  } catch (error) {
    return unavailable(now, error);
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
    if (event.timestamp === null || event.scheduleUncertain) {
      if (event.impact === "HIGH" && eventIsToday) unknownTimeBlock = true;
      else if (event.timestamp !== null && event.timestamp > now &&
               event.timestamp <= now + 24 * 60 * 60 * 1000) nextEvents.push(event);
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
    reason: "A relevant high-impact event is tentative or lacks a verified time today; refusing to clear event risk.",
    activeEvents: [], nextEvents: nextEvents.slice(0, 5)
  };
  if (activeEvents.length) {
    const highActive = activeEvents.some(event => event.impact === "HIGH");
    const status = highActive ? "HIGH" : "MEDIUM";
    return {
      status, blocked: true,
      reason: highActive
        ? "Inside the configured high-impact release protection window."
        : "Inside the shorter configured medium-impact release caution window.",
      activeEvents: activeEvents.sort((a, b) => a.timestamp - b.timestamp),
      nextEvents: nextEvents.slice(0, 5)
    };
  }
  return {
    status: "NORMAL", blocked: false,
    reason: "Calendar feed is available; no relevant event is inside the configured protection window.",
    activeEvents: [], nextEvents: nextEvents.slice(0, 5)
  };
}
