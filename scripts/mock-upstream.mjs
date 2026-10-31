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
      return json(chartJson(decodeURIComponent(chart[1]), nowMs));
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
