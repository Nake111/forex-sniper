const BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";
const BLS_ICS = "https://www.bls.gov/schedule/bls.ics";
const FED_FOMC = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const COT = "https://publicreporting.cftc.gov/resource/kh3c-gbw2.json";
const TIMEOUT = 12000;

async function get(url) {
  const response = await fetch(url, { headers: { "User-Agent": "ForexSniperResearch/1.0" }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!response.ok) throw new Error("HTTP " + response.status + " from " + new URL(url).hostname);
  return response;
}
function xmlValue(block, field) {
  const match = block.match(new RegExp("<(?:[A-Za-z0-9_]+:)?" + field + "(?:\\s[^>]*)?>([^<]*)<"));
  return match ? match[1].trim() : null;
}
export async function getTreasuryRealYields() {
  const year = new Date().getUTCFullYear();
  const url = BASE + "?data=daily_treasury_real_yield_curve&field_tdr_date_value=" + year;
  const xml = await (await get(url)).text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(([, block]) => ({
    date: xmlValue(block, "NEW_DATE") || xmlValue(block, "DATE"),
    fiveYear: Number(xmlValue(block, "BC_5YEAR")),
    tenYear: Number(xmlValue(block, "BC_10YEAR")),
    thirtyYear: Number(xmlValue(block, "BC_30YEAR"))
  })).filter(row => row.date && Number.isFinite(row.tenYear));
  entries.sort((a,b) => Date.parse(b.date) - Date.parse(a.date));
  if (!entries.length) throw new Error("Treasury real-yield XML returned no parseable 10Y observations");
  return { latest: entries[0], previous: entries[1] || null, change10Y: entries[1] ? entries[0].tenYear - entries[1].tenYear : null, source: "US Treasury daily real-yield curve" };
}
export async function getGoldCot() {
  const params = new URLSearchParams({
    "$where": "cftc_contract_market_code='088691'",
    "$order": "report_date_as_yyyy_mm_dd DESC",
    "$limit": "3"
  });
  const rows = await (await get(COT + "?" + params)).json();
  if (!Array.isArray(rows) || !rows.length) throw new Error("CFTC returned no Gold COT rows");
  const row = rows.find(item => /gold/i.test(item.contract_market_name || item.market_and_exchange_names || "")) || rows[0];
  const fields = Object.entries(row);
  const pick = pattern => {
    const found = fields.find(([key]) => pattern.test(key));
    return found ? Number(found[1]) : null;
  };
  const long = pick(/(?:managed_money|m_money).*positions_long/);
  const short = pick(/(?:managed_money|m_money).*positions_short/);
  const reportDate = row.report_date_as_yyyy_mm_dd || row.report_date;
  if (!Number.isFinite(long) || !Number.isFinite(short)) throw new Error("CFTC Gold row lacks recognized Managed Money long/short fields");
  const net = long - short;
  const ageDays = Number.isFinite(Date.parse(reportDate)) ? Math.max(0, (Date.now() - Date.parse(reportDate)) / 86400000) : null;
  return { contract: row.contract_market_name || row.market_and_exchange_names, reportDate, ageDays, managedMoneyLong: long, managedMoneyShort: short, managedMoneyNet: net, source: "CFTC Disaggregated Futures-and-Options COT", note: "Weekly positioning context, not an intraday entry trigger." };
}
function zonedLocalToUtc(year, month, day, hour, minute, timeZone) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(target));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const represented = Date.UTC(Number(values.year), Number(values.month) - 1,
    Number(values.day), Number(values.hour), Number(values.minute));
  return target - (represented - target);
}
function parseCalendarDate(value, timeZone = "America/New_York") {
  const raw = String(value || "");
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(raw);
  if (!match) return NaN;
  const [, y, mo, d, h = "00", mi = "00", sec = "00"] = match;
  if (raw.endsWith("Z")) return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  return zonedLocalToUtc(+y, +mo, +d, +h, +mi, timeZone) + Number(sec) * 1000;
}
function parseBlsIcs(ics) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const events = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0] || "";
    const summary = body.match(/^SUMMARY(?:;[^:]*)?:(.*)$/mi)?.[1]?.trim();
    const start = body.match(/^DTSTART(?:;TZID=([^;:]+))?(?:;[^:]*)?:(\d{8}T\d{6}Z?|\d{8})$/mi);
    if (!summary || !start) continue;
    const time = parseCalendarDate(start[2], start[1] || "America/New_York");
    if (!Number.isFinite(time)) continue;
    if (!/(consumer price|employment situation|producer price|job openings|personal income|personal consumption|gross domestic product|retail sales|unemployment|payroll|inflation)/i.test(summary)) continue;
    events.push({ name: summary, timestamp: time, source: "US Bureau of Labor Statistics", url: "https://www.bls.gov/schedule/bls.ics" });
  }
  return events;
}
function parseFomcCalendar(html, year = new Date().getUTCFullYear()) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const yearIndex = text.indexOf(String(year));
  if (yearIndex < 0) return [];
  const section = text.slice(yearIndex, text.indexOf(String(year + 1), yearIndex) > yearIndex ? text.indexOf(String(year + 1), yearIndex) : undefined);
  const months = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
  const events = [];
  for (const [name, month] of Object.entries(months)) {
    const match = section.match(new RegExp("\\b" + name + "\\s+(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\b", "i"));
    if (!match) continue;
    const day = Number(match[2]);
    const timestamp = zonedLocalToUtc(year, month, day, 14, 0, "America/New_York");
    events.push({ name: "FOMC rate decision / statement", timestamp, source: "Federal Reserve FOMC calendar", url: FED_FOMC });
  }
  return events;
}
export async function getUSCalendar(now = Date.now()) {
  const [blsResult, fedResult] = await Promise.allSettled([
    get(BLS_ICS).then(response => response.text()).then(parseBlsIcs),
    get(FED_FOMC).then(response => response.text()).then(html => parseFomcCalendar(html))
  ]);
  const events = [
    ...(blsResult.status === "fulfilled" ? blsResult.value : []),
    ...(fedResult.status === "fulfilled" ? fedResult.value : [])
  ].sort((a, b) => a.timestamp - b.timestamp);
  if (!events.length) throw new Error("Official BLS and Federal Reserve calendars returned no parseable events");
  const imminent = events.filter(event => Math.abs(event.timestamp - now) <= 30 * 60 * 1000);
  const next = events.find(event => event.timestamp >= now) || null;
  return {
    source: "Official BLS release calendar and Federal Reserve FOMC calendar",
    sourceStatus: { bls: blsResult.status, federalReserve: fedResult.status },
    nextReleaseAt: next ? new Date(next.timestamp).toISOString() : null,
    nextEvent: next ? { name: next.name, scheduledAt: new Date(next.timestamp).toISOString(), source: next.source, url: next.url } : null,
    events: events.map(event => ({ name: event.name, timestamp: event.timestamp, scheduledAt: new Date(event.timestamp).toISOString(), source: event.source, url: event.url })),
    imminentEvents: imminent.map(event => ({ name: event.name, scheduledAt: new Date(event.timestamp).toISOString(), source: event.source, url: event.url }))
  };
}

export async function getGoldMacroData() {
  const results = await Promise.allSettled([getTreasuryRealYields(), getGoldCot(), getUSCalendar()]);
  const [yields, cot, calendar] = results.map(result => result.status === "fulfilled" ? result.value : { unavailable: result.reason.message });
  const eventRisk = calendar?.imminentEvents?.length ? "HIGH" : calendar?.unavailable ? "UNKNOWN" : "NORMAL";
  return {
    status: results.every(result => result.status === "fulfilled") ? "ALL_SOURCES_AVAILABLE" : "PARTIAL",
    eventRisk, yields, cot, calendar,
    directionalBias: "UNCONFIRMED",
    note: "Macro datasets are contextual filters. COT is weekly; Treasury real yields are daily; calendar event times are UTC. No directional BUY/SELL is inferred from these alone."
  };
}
