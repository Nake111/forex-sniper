import { readFile, writeFile, mkdir } from "node:fs/promises";
const API_URL = "https://www.financecalendar.com/wp-json/fc/v1/calendar";
const SOURCE_URL = "https://www.financecalendar.com";
const TIMEOUT_MS = Number(process.env.ECONOMIC_CALENDAR_TIMEOUT_MS ?? 12000);
const CACHE_PATH = ".cache/economic-calendar.json";
const CACHE_TTL_MS = 9 * 60 * 1000;
const COUNTRIES = "US,EU,DE,GB,JP,CA,AU,CH,NZ";
const HIGH_PRE_MINUTES = 15;
const HIGH_POST_MINUTES = 15;
const MEDIUM_PRE_MINUTES = 5;
const MEDIUM_POST_MINUTES = 5;

function isoDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseInstant(event) {
  const raw = event.release_at_utc ?? event.time_utc;
  if (!raw) return null;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : null;
}

function dateInTimezone(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(now));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.year + "-" + values.month + "-" + values.day;
  } catch {
    return isoDate(now);
  }
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
    source: event.source_name ?? "Finance Calendar",
    sourceUrl: event.source_url ?? event.url ?? null,
    lastVerifiedAt: event.last_verified_at ?? null,
    dataStale: event.data_stale === true,
    sourceLicense: event.source_license ?? null,
    sourceRights: event.source_rights ?? null
  };
}

export async function getEconomicCalendar({ now = Date.now(), apiKey = process.env.FINANCE_CALENDAR_API_KEY } = {}) {
  if (!apiKey) {
    return {
      status: "MISSING_API_KEY",
      provider: "Finance Calendar",
      sourceUrl: SOURCE_URL,
      fetchedAt: null,
      events: [],
      error: "Set FINANCE_CALENDAR_API_KEY in GitHub Actions secrets. Calendar risk is UNKNOWN and entries must remain blocked."
    };
  }

  try {
    const cached = JSON.parse(await readFile(CACHE_PATH, "utf8"));
    const age = now - Date.parse(cached.fetchedAt ?? "");
    if (cached.status === "AVAILABLE" && Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) {
      return { ...cached, cacheHit: true, cacheAgeMs: age };
    }
  } catch {
    // First run or missing/invalid cache: fetch a fresh calendar snapshot.
  }

  const from = isoDate(now - 3 * 86400000);
  const to = isoDate(now + 14 * 86400000);
  const params = new URLSearchParams({
    from, to, country: COUNTRIES, impact: "high,medium",
    tz: "Europe/Ljubljana", limit: "500", offset: "0", format: "json"
  });
  const url = API_URL + "?" + params;
  let response;
  try {
    response = await fetch(url, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store"
    });
  } catch (error) {
    return {
      status: "UNAVAILABLE", provider: "Finance Calendar", sourceUrl: SOURCE_URL,
      fetchedAt: new Date(now).toISOString(), events: [], error: error.message
    };
  }

  if (!response.ok) {
    return {
      status: "UNAVAILABLE", provider: "Finance Calendar", sourceUrl: SOURCE_URL,
      fetchedAt: new Date(now).toISOString(), events: [],
      httpStatus: response.status,
      error: "Economic calendar request failed (HTTP " + response.status + "). Check the API key, account entitlement and request quota."
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      status: "INVALID_RESPONSE", provider: "Finance Calendar", sourceUrl: SOURCE_URL,
      fetchedAt: new Date(now).toISOString(), events: [],
      error: "Calendar provider returned invalid JSON."
    };
  }

  if (!Array.isArray(payload.events) || !Number.isFinite(Number(payload.total ?? payload.count ?? payload.events.length))) {
    return {
      status: "INVALID_RESPONSE", provider: "Finance Calendar", sourceUrl: SOURCE_URL,
      fetchedAt: new Date(now).toISOString(), events: [],
      error: "Calendar response did not contain a valid events array and count."
    };
  }

  const rawEvents = [...payload.events];
  const total = Number(payload.total ?? payload.count ?? rawEvents.length);
  let offset = rawEvents.length;
  while (rawEvents.length < total && offset < 2500) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("offset", String(offset));
    let pageResponse;
    try {
      pageResponse = await fetch(API_URL + "?" + pageParams, {
        headers: { "X-API-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store"
      });
      if (!pageResponse.ok) throw new Error("HTTP " + pageResponse.status);
      const page = await pageResponse.json();
      if (!Array.isArray(page.events) || page.events.length === 0) throw new Error("Calendar pagination returned an empty or invalid page.");
      rawEvents.push(...page.events);
      offset += page.events.length;
    } catch (error) {
      return {
        status: "INCOMPLETE", provider: "Finance Calendar", sourceUrl: SOURCE_URL,
        fetchedAt: new Date(now).toISOString(), events: rawEvents.map(normalizeEconomicEvent),
        count: rawEvents.length, total,
        error: "Calendar pagination incomplete: " + error.message
      };
    }
  }

  const events = rawEvents.slice(0, total).map(normalizeEconomicEvent);
  const staleEvents = events.filter(event => event.dataStale).length;
  const unknownTimeHighImpact = events.filter(event =>
    event.impact === "HIGH" && event.timestamp === null &&
    event.date && event.status !== "cancelled"
  ).length;

  const result = {
    status: rawEvents.length >= total ? "AVAILABLE" : "INCOMPLETE",
    provider: "Finance Calendar",
    sourceUrl: SOURCE_URL,
    fetchedAt: new Date(now).toISOString(),
    from, to,
    total,
    count: events.length,
    truncated: rawEvents.length < total,
    staleEvents,
    unknownTimeHighImpact,
    attribution: payload.attribution ?? null,
    events: events.sort((a, b) => (a.timestamp ?? Date.parse(a.date ?? "")) - (b.timestamp ?? Date.parse(b.date ?? ""))),
    error: rawEvents.length >= total ? null : "Calendar result exceeded the safe pagination cap; refusing to claim complete event coverage.",
    cacheHit: false,
    cacheAgeMs: 0
  };
  if (result.status === "AVAILABLE") {
    try {
      await mkdir(".cache", { recursive: true });
      await writeFile(CACHE_PATH, JSON.stringify(result), "utf8");
    } catch (error) {
      console.warn("Economic calendar cache write failed:", error.message);
    }
  }
  return result;
}

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
      status: "STALE_SOURCE_DATA",
      blocked: true,
      reason: "A relevant event record is flagged stale by its source; refusing to clear event risk.",
      activeEvents: [],
      nextEvents: []
    };
  }

  const activeEvents = [];
  const nextEvents = [];
  let unknownTimeBlock = false;

  for (const event of relevant) {
    const eventIsToday = event.date === dateInTimezone(now, event.releaseTimezone);
    if (event.dataStale) continue;
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

  if (unknownTimeBlock) {
    return {
      status: "UNKNOWN_TIME_HIGH_IMPACT",
      blocked: true,
      reason: "A relevant high-impact release is listed for today without a verified release time.",
      activeEvents: [],
      nextEvents: nextEvents.slice(0, 5)
    };
  }
  if (activeEvents.length) {
    return {
      status: "HIGH",
      blocked: true,
      reason: "Inside the pre/post-release protection window for a relevant high- or medium-impact event.",
      activeEvents: activeEvents.sort((a, b) => a.timestamp - b.timestamp),
      nextEvents: nextEvents.slice(0, 5)
    };
  }
  return {
    status: "NORMAL",
    blocked: false,
    reason: "Calendar feed is available; no relevant event is inside the configured protection window.",
    activeEvents: [],
    nextEvents: nextEvents.slice(0, 5)
  };
}
