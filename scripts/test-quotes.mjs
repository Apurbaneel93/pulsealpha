/**
 * Live prices and charts on a real `next start` (Yahoo mocked): validation,
 * the symbol/range whitelist, response shapes, and that the server cache keeps
 * upstream calls to about one per symbol per window however often clients poll.
 *
 * Run after `npm run build`:  npm run test:quotes
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3127;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), "pulsealpha-quotes-"));
const LOG = path.join(dir, "upstream.log");
writeFileSync(LOG, "");
const yahooCalls = () => readFileSync(LOG, "utf8").split("\n").filter((l) => l === "yahoo").length;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function istNseOpen(d = new Date()) {
  const ist = new Date(d.getTime() + 19_800_000);
  const dow = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return dow >= 1 && dow <= 5 && mins >= 9 * 60 + 15 && mins < 15 * 60 + 30;
}
const istDay = (sec) => new Date(sec * 1000 + 19_800_000).toISOString().slice(0, 10);

const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], {
  cwd: root,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", MOCK_UPSTREAM: "1", MOCK_UPSTREAM_LOG: LOG, NODE_OPTIONS: `--import ${path.join(root, "scripts/mock-upstream.mjs")}` },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
  console.log(`  ✓ ${msg}`);
};
const get = (p) => fetch(`${BASE}${p}`);

try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await get("/api/config")).ok) break;
    } catch {}
    await sleep(250);
    if (i === 79) throw new Error(`server did not start:\n${serverOut}`);
  }
  rmSync(path.join(root, ".next", "cache", "fetch-cache"), { recursive: true, force: true });
  console.log(`Live price and chart test (next start, mocked Yahoo; NSE is ${istNseOpen() ? "OPEN" : "closed"} right now)\n`);

  console.log("Quotes");
  let before = yahooCalls();
  const r1 = await get("/api/quotes?symbols=LT,INFY,%5ENSEI");
  const q1 = await r1.json();
  ok(r1.status === 200 && r1.headers.get("cache-control") === "no-store", "200 and never cached by the browser or a CDN");
  ok(Object.keys(q1.quotes).sort().join() === "INFY,LT,^NSEI" && q1.missing.length === 0, "every requested symbol comes back, including the index");
  for (const [sym, q] of Object.entries(q1.quotes)) {
    assert.ok(q.price > 0 && q.prev_close > 0, `${sym} prices`);
    assert.ok(Math.abs(q.change_pct - ((q.price - q.prev_close) / q.prev_close) * 100) < 0.011, `${sym}: change_pct matches price vs previous close`);
    assert.ok(Date.parse(q.market_time_iso) > 0 && Date.parse(q.fetched_at_iso) > 0 && q.day_high >= q.day_low, `${sym} timestamps and range`);
  }
  ok(true, "each quote: price, official previous close, % change that matches, exchange timestamp, day range");
  ok(yahooCalls() - before === 3, `first call: one upstream request per symbol (${yahooCalls() - before})`);

  before = yahooCalls();
  const r2 = await (await get("/api/quotes?symbols=LT,INFY,%5ENSEI")).json();
  const r3 = await (await get("/api/quotes?symbols=lt,infy&x=1")).json();
  ok(yahooCalls() === before, "repeat polls inside the window cost Yahoo nothing");
  ok(r2.quotes.LT.price === q1.quotes.LT.price && r3.quotes.LT.fetched_at_iso === q1.quotes.LT.fetched_at_iso, "…and return the same cached quote; lower-case symbols work");

  console.log("\nValidation");
  for (const [label, p] of [
    ["no symbols", "/api/quotes"],
    ["unknown symbol", "/api/quotes?symbols=AAPL"],
    ["one bad symbol spoils the request", "/api/quotes?symbols=LT,AAPL"],
    ["path-like input", "/api/quotes?symbols=LT,..%2Fetc%2Fpasswd"],
    ["31 symbols", `/api/quotes?symbols=${Array.from({ length: 31 }, (_, i) => `S${i}`).join(",")}`],
  ]) {
    const res = await get(p);
    ok(res.status === 400, `${label}: 400`);
  }
  ok((await get("/api/chart?symbol=AAPL&range=1d")).status === 400, "chart: unknown symbol 400");
  ok((await get("/api/chart?symbol=LT&range=10y")).status === 400, "chart: unknown range 400");
  ok((await get("/api/chart?range=1d")).status === 400, "chart: missing symbol 400");
  ok(yahooCalls() === before, "rejected requests never reach Yahoo");

  console.log("\nCharts");
  before = yahooCalls();
  const c1d = await (await get("/api/chart?symbol=LT&range=1d")).json();
  ok(c1d.interval === "1m" && c1d.points.length > 0 && c1d.points.length <= 376, `1D: 1-minute bars, one session (${c1d.points.length} points)`);
  ok(new Set(c1d.points.map(([t]) => istDay(t))).size === 1, "1D: every point is on the same IST trading day");
  const day = istDay(c1d.points[0][0]);
  ok(c1d.session && istDay(c1d.session.start) === day && c1d.session.end - c1d.session.start === 22500, "1D: fixed 09:15–15:30 IST window for that day");
  ok(c1d.points.every(([t], i, a) => i === 0 || t > a[i - 1][0]) && c1d.points.every(([t]) => t >= c1d.session.start && t <= c1d.session.end), "1D: points ascend and sit inside the session");
  ok(c1d.previous_close > 0 && c1d.ema20 === null, "1D: official previous close from the quote cache; no moving averages");
  if (istNseOpen()) {
    const lastT = c1d.points[c1d.points.length - 1][0];
    ok(Date.now() / 1000 - lastT < 180, "market open: the newest bar is under 3 minutes old");
  }

  const c5d = await (await get("/api/chart?symbol=LT&range=5d")).json();
  ok(c5d.interval === "5m" && new Set(c5d.points.map(([t]) => istDay(t))).size === 5 && c5d.session === null && c5d.previous_close === null, "5D: 5-minute bars across 5 sessions");

  const daily = {};
  for (const r of ["1m", "3m", "6m", "1y"]) daily[r] = await (await get(`/api/chart?symbol=LT&range=${r}`)).json();
  ok(daily["1m"].points.length === 22 && daily["3m"].points.length === 63 && daily["6m"].points.length === 126, "1M/3M/6M: 22, 63 and 126 sessions");
  ok(daily["1y"].points.length > 100 && daily["1y"].points.length <= 250, `1Y: all available sessions up to 250 (${daily["1y"].points.length} here)`);
  ok(daily["1m"].ema20.every((v) => v !== null) && daily["1m"].ema50.every((v) => v !== null), "1M: both averages already warm at the left edge");
  ok(daily["1y"].ema20.filter((v) => v === null).length === 19 && daily["1y"].ema50.filter((v) => v === null).length === 49, "1Y with short history: null until each average exists");
  ok(daily["1m"].interval === "1d" && daily["1m"].points.every(([t], i, a) => i === 0 || t > a[i - 1][0]), "daily ranges ascend");
  ok(yahooCalls() - before === 3, `upstream: 1 for 1D bars (the previous close reuses the cached quote), 1 for 5D, 1 shared by all four daily ranges (${yahooCalls() - before} calls)`);

  before = yahooCalls();
  await get("/api/chart?symbol=LT&range=1d");
  await get("/api/chart?symbol=LT&range=5d");
  await get("/api/chart?symbol=LT&range=1y");
  ok(yahooCalls() === before, "repeat chart requests are served from the cache");

  console.log("\nRefresh after the window");
  const priceBefore = q1.quotes.LT.price;
  await sleep(16_500);
  before = yahooCalls();
  await get("/api/quotes?symbols=LT,INFY,%5ENSEI"); // may be served stale while the cache refreshes behind it
  await sleep(2_500);
  ok(yahooCalls() - before === 3, `after 15 s the next poll triggers exactly one refresh per symbol (${yahooCalls() - before})`);
  const q4 = await (await get("/api/quotes?symbols=LT,INFY,%5ENSEI")).json();
  ok(Date.parse(q4.quotes.LT.fetched_at_iso) > Date.parse(q1.quotes.LT.fetched_at_iso), "…and the refreshed quote is newer");
  if (istNseOpen()) ok(q4.quotes.LT.price !== priceBefore, `market open: the price moved (${priceBefore} → ${q4.quotes.LT.price})`);
  else ok(q4.quotes.LT.price === priceBefore, "market closed: the price correctly stays at the last close");

  console.log(`\n✓ live prices and charts OK (${checks} checks)`);
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  rmSync(dir, { recursive: true, force: true });
}
