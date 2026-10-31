/* Sanity tests for the deterministic engine. Run: npm test */
import assert from "node:assert/strict";
import { atr, ema, rsi, volumeRatio } from "../src/lib/indicators";
import { computeLevels } from "../src/lib/levels";
import { formatBadge, formatDetectedAt, formatLastScan } from "../src/lib/time";
import { buildDemoInputs } from "../src/lib/demo-data";
import { passesHardFilter, rankByRules } from "../src/lib/rules-engine";
import { classifyRegime } from "../src/lib/market-data-pure";
import type { Candle } from "../src/lib/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("PulseAlpha engine tests");

test("RSI(14) matches the StockCharts/Wilder reference series", () => {
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0,
    46.03, 46.41, 46.22, 45.64,
  ];
  const expected = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97];
  expected.forEach((want, i) => {
    const got = rsi(closes.slice(0, 15 + i), 14);
    assert.ok(got !== null && Math.abs(got - want) < 0.1, `RSI step ${i}: got ${got}, want ${want}`);
  });
});

test("EMA of a constant series is the constant; EMA reacts toward new prices", () => {
  assert.equal(ema(Array(30).fill(100), 20), 100);
  const up = [...Array(20).fill(100), 110];
  const e = ema(up, 20);
  assert.ok(e !== null && Math.abs(e - (110 * (2 / 21) + 100 * (19 / 21))) < 1e-9);
});

test("ATR(14) of fixed-range candles equals the range", () => {
  const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(2026, 0, i + 1).toISOString(),
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
  }));
  assert.equal(atr(candles, 14), 4);
});

test("Volume ratio excludes the latest bar from its own baseline", () => {
  const v = volumeRatio([...Array(20).fill(1000), 2500], 20);
  assert.ok(v && v.ratio === 2.5 && v.average === 1000);
});

test("ATR levels follow the spec multipliers and NSE tick size", () => {
  const l = computeLevels(1000, 20);
  assert.deepEqual(
    { e0: l.entry_low, e1: l.entry_high, t: l.target_price, s: l.stop_loss },
    { e0: 1000, e1: 1003, t: 1050, s: 970 },
  );
  assert.equal(l.target_pct, 5);
  assert.equal(l.stop_pct, -3);
  const odd = computeLevels(412.37, 9.13);
  for (const v of [odd.entry_low, odd.entry_high, odd.target_price, odd.stop_loss]) {
    assert.ok(Math.abs(Math.round(v * 20) - v * 20) < 1e-6, `${v} not on 0.05 tick`);
  }
});

test("IST formatting matches the spec examples", () => {
  const d = new Date("2026-11-01T03:00:12Z");
  assert.equal(formatDetectedAt(d), "01 Nov 2026 • 08:30:12 AM IST");
  assert.equal(formatLastScan(d), "01 Nov 2026, 08:30 AM IST");
  assert.equal(formatBadge(d), "01 Nov • 08:30 AM");
  assert.equal(formatDetectedAt(new Date("2026-11-01T09:45:00Z")), "01 Nov 2026 • 03:15:00 PM IST");
});

test("Regime classifier is deterministic at the edges", () => {
  const mk = (spx: number, ndx: number, nifty: number, above: boolean) =>
    classifyRegime([
      { symbol: "^GSPC", label: "S&P 500", last: 1, changePct: spx, aboveEma20: true, sessionDate: "" },
      { symbol: "^IXIC", label: "Nasdaq", last: 1, changePct: ndx, aboveEma20: true, sessionDate: "" },
      { symbol: "^NSEI", label: "Nifty 50", last: 1, changePct: nifty, aboveEma20: above, sessionDate: "" },
    ]).regime;
  assert.equal(mk(0.6, 0.8, 0.4, true), "Bullish");
  assert.equal(mk(-0.8, -1.2, -0.6, false), "Bearish");
  assert.equal(mk(0.1, -0.1, 0.05, true), "Neutral");
});

test("Demo board runs through the real filter and yields 2–3+ candidates every day", () => {
  for (let day = 0; day < 60; day++) {
    const now = new Date(Date.UTC(2026, 10, 1 + day, 3, 0, 0));
    const { market, snapshots } = buildDemoInputs(now);
    const passing = snapshots.filter(passesHardFilter);
    assert.ok(passing.length >= 2, `day ${day}: only ${passing.length} passed`);
    const ranked = rankByRules(passing, market, new Map());
    assert.ok(ranked.every((r) => r.conviction >= 1 && r.conviction <= 99));
  }
  const a = buildDemoInputs(new Date("2026-11-01T03:00:00Z"));
  const b = buildDemoInputs(new Date("2026-11-01T08:00:00Z"));
  assert.deepEqual(a.snapshots, b.snapshots, "same IST day must produce the same board");
});

console.log(`\n${passed} passed`);
