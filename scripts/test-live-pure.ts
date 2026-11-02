/**
 * Unit tests for live prices and charts (src/lib/live-pure.ts): sessions in
 * IST, intraday and daily payloads, EMA alignment, quote maths, buy-zone
 * status, axis ticks and symbol whitelist.
 *
 * Run: npm run test:chart
 */
import assert from "node:assert/strict";
import { ema } from "../src/lib/indicators";
import {
  DAILY_SESSIONS,
  buildDailyPayload,
  buildIntradayPayload,
  isChartRange,
  lastSessionsBars,
  niceTicks,
  planStatus,
  quoteFromSeries,
  quoteLagSeconds,
  sessionWindow,
  yahooSymbolFor,
} from "../src/lib/live-pure";
import type { Series } from "../src/lib/market-data-pure";
import type { Candle } from "../src/lib/types";

const istToMs = (iso: string) => Date.parse(`${iso}+05:30`);
let n = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`) || n++;

console.log("Live price and chart tests");

// ── sessions ────────────────────────────────────────────────────────────────
{
  const w = sessionWindow("2026-11-02");
  assert.equal(w.start * 1000, istToMs("2026-11-02T09:15:00"));
  assert.equal(w.end * 1000, istToMs("2026-11-02T15:30:00"));
  ok("session window is 09:15–15:30 IST");
}

// ── intraday ────────────────────────────────────────────────────────────────
{
  const bars: Array<[number, number]> = [];
  for (const day of ["2026-10-29", "2026-10-30", "2026-11-02"]) {
    for (let m = 0; m < 375; m += 5) bars.push([istToMs(`${day}T09:15:00`) + m * 60_000, 100 + m / 10]);
  }
  const one = lastSessionsBars(bars, 1);
  assert.equal(one.length, 75);
  assert.equal(one[0]![0] * 1000, istToMs("2026-11-02T09:15:00"));
  assert.equal(lastSessionsBars(bars, 2).length, 150);
  assert.equal(lastSessionsBars(bars, 5).length, 225, "asking for more sessions than exist returns all");
  ok("keeps only the last N IST sessions");

  const p = buildIntradayPayload({ symbol: "LT", range: "1d", bars, previousClose: 101.234, now: new Date(istToMs("2026-11-02T11:30:00")) });
  assert.equal(p.interval, "1m");
  assert.equal(p.previous_close, 101.23);
  assert.deepEqual(p.session, sessionWindow("2026-11-02"));
  assert.ok(p.ema20 === null && p.ema50 === null);
  const five = buildIntradayPayload({ symbol: "LT", range: "5d", bars, previousClose: 99, now: new Date() });
  assert.equal(five.previous_close, null, "5D has no previous-close line");
  assert.equal(five.session, null);
  assert.equal(five.points.length, 225);
  ok("1D payload carries the previous close and a fixed session window; 5D does not");

  // A Monday-morning request before the open shows Friday's session, not an empty chart.
  const friday = bars.filter(([t]) => t < istToMs("2026-11-02T00:00:00"));
  const pre = buildIntradayPayload({ symbol: "LT", range: "1d", bars: friday, previousClose: 100, now: new Date(istToMs("2026-11-02T08:00:00")) });
  assert.deepEqual(pre.session, sessionWindow("2026-10-30"));
  assert.equal(pre.points.length, 75);
  ok("before the open, 1D shows the last completed session");

  const empty = buildIntradayPayload({ symbol: "LT", range: "1d", bars: [], previousClose: null, now: new Date() });
  assert.deepEqual(empty.points, []);
  assert.equal(empty.session, null);
  ok("no bars → empty chart, no crash");
}

// ── daily + EMA ─────────────────────────────────────────────────────────────
{
  const closes: Array<[number, number]> = [];
  for (let i = 0; i < 320; i++) closes.push([Date.UTC(2025, 8, 1) + i * 86_400_000, 100 + i * 0.5 + Math.sin(i / 5) * 3]);
  const values = closes.map(([, c]) => c);
  for (const range of ["1m", "3m", "6m", "1y"] as const) {
    const p = buildDailyPayload({ symbol: "LT", range, closes, now: new Date() });
    assert.equal(p.points.length, DAILY_SESSIONS[range]);
    assert.equal(p.ema20!.length, p.points.length);
    assert.equal(p.ema50!.length, p.points.length);
    assert.ok(p.ema50!.every((v) => v !== null), `${range}: EMA-50 already warm at the left edge`);
    assert.equal(p.previous_close, null);
  }
  const y = buildDailyPayload({ symbol: "LT", range: "1y", closes, now: new Date() });
  assert.ok(Math.abs(y.ema20![y.ema20!.length - 1]! - ema(values, 20)!) < 0.01, "last EMA-20 equals the indicator used by the scan");
  assert.ok(Math.abs(y.ema50![y.ema50!.length - 1]! - ema(values, 50)!) < 0.01, "last EMA-50 equals the indicator used by the scan");
  ok("daily ranges: right length, EMAs warm and identical to the scan's indicators");

  const short = buildDailyPayload({ symbol: "NEW", range: "1y", closes: closes.slice(0, 30), now: new Date() });
  assert.equal(short.points.length, 30);
  assert.equal(short.ema20!.filter((v) => v === null).length, 19);
  assert.ok(short.ema50!.every((v) => v === null));
  ok("a recently listed stock shows nulls where an average isn't defined yet");
}

// ── quotes ──────────────────────────────────────────────────────────────────
{
  const bar = (date: string, c: number, h = c + 2, l = c - 2): Candle => ({ date, open: c, high: h, low: l, close: c, volume: 1 });
  const done = [bar("2026-10-29T03:45:00Z", 98), bar("2026-10-30T03:45:00Z", 100)];
  const forming = bar("2026-11-02T03:45:00Z", 101, 103, 99);
  const now = new Date("2026-11-02T06:00:00Z");
  const mt = new Date("2026-11-02T05:59:40Z");

  const live = quoteFromSeries({ completed: done, last: 102.5, inProgress: true }, forming, mt, now)!;
  assert.equal(live.price, 102.5);
  assert.equal(live.prev_close, 100);
  assert.equal(live.change_pct, 2.5);
  assert.equal(live.day_high, 103);
  assert.equal(live.day_low, 99);
  assert.equal(quoteLagSeconds(live, now), 20);
  ok("open session: live price against last completed close, day range from the forming bar");

  const closed = quoteFromSeries({ completed: done, last: 100, inProgress: false }, undefined, mt, now)!;
  assert.equal(closed.price, 100);
  assert.equal(closed.prev_close, 98);
  assert.equal(closed.change_pct, 2.04);
  ok("after the bell: last session against the one before, like a broker");

  assert.equal(quoteFromSeries({ completed: done.slice(0, 1), last: 1, inProgress: false }, undefined, mt, now), null);
  const noStamp = quoteFromSeries({ completed: done, last: 100, inProgress: false } as Series, undefined, new Date(NaN), now)!;
  assert.equal(noStamp.market_time_iso, now.toISOString());
  ok("too little history → no quote; an unusable timestamp falls back to now");
}

// ── buy-zone status ─────────────────────────────────────────────────────────
{
  const lv = { entry_low: 100, entry_high: 101, target_1: 110, target_2: 120, stop_loss: 95, gap_status: "ACTIVE_BUY_ZONE" as const };
  assert.equal(planStatus(100.5, lv).kind, "in_zone");
  assert.equal(planStatus(100, lv).kind, "in_zone");
  assert.equal(planStatus(101, lv).kind, "in_zone");
  assert.deepEqual(planStatus(103, lv), { kind: "above", label: "2.0% above buy zone", tone: "caution" });
  assert.deepEqual(planStatus(98, lv), { kind: "below", label: "2.0% below buy zone", tone: "neutral" });
  assert.equal(planStatus(101.04, lv).kind, "in_zone", "0.04% over the top edge still reads as in the zone");
  assert.equal(planStatus(99.96, lv).kind, "in_zone");
  assert.deepEqual(planStatus(110, lv), { kind: "target_1", label: "Target 1 reached", tone: "bull" });
  assert.deepEqual(planStatus(119.95, lv), { kind: "target_1", label: "Target 1 reached", tone: "bull" });
  assert.deepEqual(planStatus(120, lv), { kind: "target_2", label: "Target 2 reached", tone: "bull" });
  assert.equal(planStatus(130, lv).kind, "target_2");
  assert.equal(planStatus(95, lv).kind, "stop");
  assert.equal(planStatus(90, lv).kind, "stop");
  // After a spike the plan says wait: the same distance above the zone now reads as "don't chase".
  const wait = { ...lv, gap_status: "WAIT_FOR_PULLBACK" as const };
  assert.deepEqual(planStatus(103, wait), { kind: "above", label: "Don't chase: 2.0% above buy zone", tone: "caution" });
  assert.equal(planStatus(100.5, wait).kind, "in_zone", "the pullback arrived: it is a buy zone again");
  ok("price vs plan: in zone, above (and don't chase), below, Target 1, Target 2, stop hit");
}

// ── ticks, whitelist ────────────────────────────────────────────────────────
{
  assert.deepEqual(niceTicks(0, 100, 4), [0, 20, 40, 60, 80, 100]);
  const t = niceTicks(1043, 1071, 3);
  assert.ok(t.every((v) => v >= 1043 && v <= 1071) && t.length >= 2 && t.length <= 6, `ticks ${t}`);
  assert.deepEqual(niceTicks(5, 5, 3), [5]);
  ok("axis ticks are round numbers inside the range");

  assert.equal(yahooSymbolFor("LT"), "LT.NS");
  assert.equal(yahooSymbolFor("^NSEI"), "^NSEI");
  assert.equal(yahooSymbolFor("AAPL"), null);
  assert.equal(yahooSymbolFor("lt"), null, "lookups are exact; the routes upper-case first");
  assert.equal(yahooSymbolFor("../etc/passwd"), null);
  assert.ok(isChartRange("1d") && isChartRange("1y") && !isChartRange("10y") && !isChartRange(undefined));
  ok("only watchlist symbols and known ranges are accepted");
}

console.log(`\n✓ live price and chart logic OK (${n} groups)`);
