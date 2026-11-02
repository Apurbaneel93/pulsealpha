/**
 * Offline stand-ins for Yahoo Finance, Google News and Gemini, installed on
 * globalThis.fetch. Used by the tests; never imported by the app.
 *
 *   import { installMockUpstream } from "./mock-upstream.mjs"   // in a test
 *   node --import ./scripts/mock-upstream.mjs ...                // preload: auto-installs when MOCK_UPSTREAM=1
 *
 * Every upstream call is counted. With MOCK_UPSTREAM_LOG=<file>, each call
 * also appends "<kind>\n" to that file so another process can read counts.
 */
import { appendFileSync } from "node:fs";

const DAY = 86_400_000;
const BULLISH = new Set(["INFY", "LT", "BEL"]);

export const calls = { yahoo: 0, news: 0, gemini: 0 };
export const geminiRequests = [];

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chartJson(symbol, nowMs) {
  const base = symbol.replace(".NS", "");
  const bullish = BULLISH.has(base);
  const rand = rng([...symbol].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
  const n = 140;
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  let price = 1000;
  let day = nowMs - 2 * DAY - n * 1.4 * DAY;
  for (let i = 0; i < n; i++) {
    day += (i % 5 === 4 ? 3 : 1) * DAY;
    const run = bullish && i > n - 26;
    const r = bullish && i === n - 1 ? 0.012 : (run ? 0.0012 : 0) + (rand() - 0.5) * 0.024;
    const open = price;
    price = price * (1 + r);
    ts.push(Math.floor(day / 1000));
    o.push(open);
    c.push(price);
    h.push(Math.max(open, price) * (1 + rand() * 0.006));
    l.push(Math.min(open, price) * (1 - rand() * 0.006));
    v.push(Math.round(1e6 * (bullish && i === n - 1 ? 2.3 : 0.8 + rand() * 0.4)));
  }
  // A regular session that ended before "now", so no bar is treated as in-progress.
  const period = (startMs, endMs) => ({ timezone: "IST", start: Math.floor(startMs / 1000), end: Math.floor(endMs / 1000), gmtoffset: 19800 });
  const sessionStart = nowMs - DAY - 6 * 3_600_000;
  return {
    chart: {
      result: [
        {
          meta: {
            currency: "INR",
            symbol,
            exchangeName: "NSI",
            fullExchangeName: "NSE",
            instrumentType: symbol.startsWith("^") ? "INDEX" : "EQUITY",
            firstTradeDate: 820454400,
            regularMarketTime: ts[ts.length - 1],
            hasPrePostMarketData: false,
            gmtoffset: 19800,
            timezone: "IST",
            exchangeTimezoneName: "Asia/Kolkata",
            regularMarketPrice: c[c.length - 1],
            chartPreviousClose: c[0],
            priceHint: 2,
            currentTradingPeriod: {
              pre: period(sessionStart - 900_000, sessionStart),
              regular: period(sessionStart, sessionStart + 6.25 * 3_600_000),
              post: period(sessionStart + 6.25 * 3_600_000, sessionStart + 7 * 3_600_000),
            },
            dataGranularity: "1d",
            range: "",
            validRanges: ["1d", "5d", "1mo", "3mo", "6mo", "1y"],
          },
          timestamp: ts,
          indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }], adjclose: [{ adjclose: c }] },
        },
      ],
      error: null,
    },
  };
}

// ── Intraday bars (1m / 5m) for the chart tests ─────────────────────────────
const IST_MS = 19_800_000;
const hashOf = (symbol) => [...symbol].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const istDay = (ms) => {
  const d = new Date(ms + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() };
};
const sessionStartOf = ({ y, m, d }) => Date.UTC(y, m, d, 9, 15) - IST_MS;

/** Mon–Fri 09:15–15:30 IST sessions ending at `nowMs`; today's stops at the current minute while the market is open. */
function intradayJson(symbol, nowMs, stepMin, spanDays) {
  const sessions = [];
  for (let back = 0; sessions.length < Math.min(spanDays, 8) && back < 20; back++) {
    const day = istDay(nowMs - back * DAY);
    if (day.dow === 0 || day.dow === 6) continue;
    const start = sessionStartOf(day);
    if (start <= nowMs) sessions.unshift(start);
  }
  const rand = rng(hashOf(symbol));
  let price = 1000 + (Math.abs(hashOf(symbol)) % 500);
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  for (const start of sessions) {
    const end = Math.min(start + 375 * 60_000, nowMs);
    for (let t = start; t < end; t += stepMin * 60_000) {
      const open = price;
      price *= 1 + (rand() - 0.5) * 0.0016 * Math.sqrt(stepMin);
      ts.push(Math.floor(t / 1000)); o.push(open); c.push(price);
      h.push(Math.max(open, price)); l.push(Math.min(open, price)); v.push(Math.round(5e3 * (0.5 + rand())));
    }
  }
  const last = sessions[sessions.length - 1] ?? nowMs;
  const period = (a, b) => ({ timezone: "IST", start: Math.floor(a / 1000), end: Math.floor(b / 1000), gmtoffset: 19800 });
  return {
    chart: {
      result: [{
        meta: {
          currency: "INR", symbol, exchangeName: "NSI", fullExchangeName: "NSE",
          instrumentType: symbol.startsWith("^") ? "INDEX" : "EQUITY", firstTradeDate: 820454400,
          regularMarketTime: ts[ts.length - 1] ?? Math.floor(nowMs / 1000), hasPrePostMarketData: false,
          gmtoffset: 19800, timezone: "IST", exchangeTimezoneName: "Asia/Kolkata",
          regularMarketPrice: c[c.length - 1] ?? price, chartPreviousClose: c[0] ?? price, priceHint: 2,
          currentTradingPeriod: { pre: period(last - 900_000, last), regular: period(last, last + 375 * 60_000), post: period(last + 375 * 60_000, last + 420 * 60_000) },
          dataGranularity: `${stepMin}m`, range: "", validRanges: ["1d", "5d", "1mo", "3mo", "6mo", "1y"],
        },
        timestamp: ts,
        indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }], adjclose: [{ adjclose: c }] },
      }],
      error: null,
    },
  };
}

/**
 * Daily history for the quote path (a 14-day window) while the real NSE
 * session is open: append a forming bar for today and move its price a little
 * with the clock, so successive quotes differ.
 */
function withFormingBar(json, nowMs) {
  const today = istDay(nowMs);
  const start = sessionStartOf(today);
  if (today.dow === 0 || today.dow === 6 || nowMs < start || nowMs >= start + 375 * 60_000) return json;
  const r = json.chart.result[0];
  const q = r.indicators.quote[0];
  const prevClose = q.close[q.close.length - 1];
  const price = prevClose * (1 + 0.006 + 0.004 * Math.sin(nowMs / 45_000));
  r.timestamp.push(Math.floor(start / 1000));
  q.open.push(prevClose); q.high.push(Math.max(prevClose, price) * 1.001); q.low.push(Math.min(prevClose, price) * 0.999);
  q.close.push(price); q.volume.push(400_000);
  r.indicators.adjclose[0].adjclose.push(price);
  const per = (a, b) => ({ timezone: "IST", start: Math.floor(a / 1000), end: Math.floor(b / 1000), gmtoffset: 19800 });
  r.meta.currentTradingPeriod.regular = per(start, start + 375 * 60_000);
  r.meta.regularMarketPrice = price;
  r.meta.regularMarketTime = Math.floor(nowMs / 1000) - 20;
  return json;
}

function rss(symbol, nowMs) {
  const fresh = new Date(nowMs - 3 * 3_600_000).toUTCString();
  const stale = new Date(nowMs - 3 * DAY).toUTCString();
  return `<?xml version="1.0"?><rss><channel>
<item><title>${symbol} wins large export order &amp; raises guidance - Example Times</title><link>https://news.example/${symbol}</link><pubDate>${fresh}</pubDate><source url="https://news.example">Example Times</source></item>
<item><title>Old story on ${symbol} - Old Wire</title><link>https://old.example/${symbol}</link><pubDate>${stale}</pubDate><source url="https://old.example">Old Wire</source></item>
</channel></rss>`;
}

function geminiResponse(body) {
  geminiRequests.push(body);
  const picks = [
    { symbol: "LT", conviction: 84, catalyst: "Order-win headline + 2.3x volume", global_cue: "US indices firm; infra beta benefits.", technical_trigger: "Breakout above 20-EMA on 2.3x volume.", news_catalyst: "Fresh export-order headline in the last 3 hours." },
    // Tries to sneak in a price — must be replaced by deterministic copy.
    { symbol: "INFY", conviction: 79, catalyst: "Nasdaq IT tailwind + volume breakout", global_cue: "Nasdaq strength supports IT exporters.", technical_trigger: "Target ₹9,999 looks achievable.", news_catalyst: "Export-order headline in the last day." },
    // Hallucinated ticker — must be dropped.
    { symbol: "FAKE", conviction: 99, catalyst: "Hallucinated", global_cue: "x", technical_trigger: "x", news_catalyst: "x" },
  ];
  return { candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify({ picks }) }] }, finishReason: "STOP" }] };
}

export function installMockUpstream({ now } = {}) {
  const log = process.env.MOCK_UPSTREAM_LOG;
  const count = (kind) => {
    calls[kind]++;
    if (log) appendFileSync(log, `${kind}\n`);
  };
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const nowMs = now ? now.getTime() : Date.now();
    const host = new URL(url).host;
    const chart = url.match(/\/v8\/finance\/chart\/([^?]+)/);
    if (chart) {
      count("yahoo");
      const symbol = decodeURIComponent(chart[1]);
      const q = new URL(url).searchParams;
      const interval = q.get("interval") ?? "1d";
      const p1 = Number(q.get("period1")) * 1000;
      const spanDays = p1 ? (nowMs - p1) / DAY : 200;
      if (interval === "1m" || interval === "5m") return json(intradayJson(symbol, nowMs, interval === "1m" ? 1 : 5, Math.ceil(spanDays)));
      const daily = chartJson(symbol, nowMs);
      // Short daily windows are the live-quote path; the 200-day scan window is left untouched.
      if (spanDays <= 15) {
        const r = daily.chart.result[0];
        const keep = 8;
        r.timestamp = r.timestamp.slice(-keep);
        const qd = r.indicators.quote[0];
        for (const k of Object.keys(qd)) qd[k] = qd[k].slice(-keep);
        r.indicators.adjclose[0].adjclose = r.indicators.adjclose[0].adjclose.slice(-keep);
        return json(withFormingBar(daily, nowMs));
      }
      return json(daily);
    }
    if (url.includes("getcrumb")) return new Response("mockcrumb", { status: 200 });
    if (host.includes("yahoo")) return new Response("", { status: 200, headers: { "set-cookie": "A3=d=mock; Domain=.yahoo.com; Path=/" } });
    if (host === "news.google.com") {
      count("news");
      const q = new URL(url).searchParams.get("q") ?? "";
      return new Response(rss(q.split(" ")[0] || "X", nowMs), { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
    if (host.includes("generativelanguage")) {
      count("gemini");
      const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.text() : "{}";
      return json(geminiResponse(JSON.parse(body)));
    }
    return new Response("not mocked", { status: 599 });
  };
}

if (process.env.MOCK_UPSTREAM === "1") installMockUpstream();
