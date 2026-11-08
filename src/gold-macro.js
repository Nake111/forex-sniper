const BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";
const CALENDAR = "https://xoomar.com/api/markets/calendar";
const COT = "https://publicreporting.cftc.gov/resource/kh3c-gbw2.json";
const TIMEOUT = 12000;

async function get(url) {
  const response = await fetch(url, { headers: { "User-Agent": "ForexSniperResearch/1.0" }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!response.ok) throw new Error("HTTP " + response.status + " from " + new URL(url).hostname);
  return response;
}
function xmlValue(block, field) {
  const match = block.match(new RegExp("<(?:[A-Za-z0-9_]+:)?" + field + ">([^<]*)<"));
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
    "$where": "contract_market_name like '%GOLD%'",
    "$order": "report_date_as_yyyy_mm_dd DESC",
    "$limit": "3"
  });
  const rows = await (await get(COT + "?" + params)).json();
  if (!Array.isArray(rows) || !rows.length) throw new Error("CFTC returned no Gold COT rows");
  const row = rows.find(item => /gold/i.test(item.contract_market_name || "")) || rows[0];
  const fields = Object.entries(row);
  const pick = pattern => {
    const found = fields.find(([key]) => pattern.test(key));
    return found ? Number(found[1]) : null;
  };
  const long = pick(/managed_money.*positions_long/);
  const short = pick(/managed_money.*positions_short/);
  const reportDate = row.report_date_as_yyyy_mm_dd || row.report_date_as_yyyy_mm_dd;
  if (!Number.isFinite(long) || !Number.isFinite(short)) throw new Error("CFTC Gold row lacks recognized Managed Money long/short fields");
  const net = long - short;
  return { contract: row.contract_market_name, reportDate, managedMoneyLong: long, managedMoneyShort: short, managedMoneyNet: net, source: "CFTC Disaggregated Futures-and-Options COT", note: "Weekly positioning context, not an intraday entry trigger." };
}
export async function getUSCalendar() {
  const response = await get(CALENDAR + "?importance=high");
  const payload = await response.json();
  const events = Array.isArray(payload.data) ? payload.data : [];
  const now = Date.now();
  const imminent = events.filter(event => {
    const time = Date.parse(event.scheduledAt || "");
    return Number.isFinite(time) && Math.abs(time - now) <= 30 * 60 * 1000;
  });
  const next = events.filter(event => Date.parse(event.scheduledAt || "") >= now)
    .sort((a,b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0] || null;
  return {
    source: "XOOMAR US calendar (agency-published BLS, BEA, Census, Federal Reserve and DOL schedules)",
    nextReleaseAt: payload.nextReleaseAt || next?.scheduledAt || null,
    nextEvent: next ? { name: next.eventName, scheduledAt: next.scheduledAt, source: next.source, url: next.canonicalUrl || null } : null,
    imminentEvents: imminent.map(event => ({ name: event.eventName, scheduledAt: event.scheduledAt, source: event.source, url: event.canonicalUrl || null }))
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
