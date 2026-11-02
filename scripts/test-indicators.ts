/* Sanity tests for the deterministic engine. Run: npm test */
import assert from "node:assert/strict";
import { atr, ema, rsi, sma, volumeRatio } from "../src/lib/indicators";
import { formatBadge, formatDetectedAt, formatLastScan } from "../src/lib/time";
import { buildDemoInputs } from "../src/lib/demo-data";
import { passesHardFilter, rankByRules } from "../src/lib/rules-engine";
import { classifyRegime, snapshotFromSeries } from "../src/lib/market-data-pure";
import { computeLevels } from "../src/lib/levels";
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

test("SMA is the plain mean of the last N closes, and null without enough data", () => {
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
  assert.equal(sma([100, 1, 2, 3, 4, 5], 5), 3, "only the last N closes count");
  assert.equal(sma([1, 2, 3], 5), null);
});

test("Snapshot ratios match a hand calculation (coil, ATR%, 20-DMA extension, gap)", () => {
  // 60 sessions of an identical 4-point range around 100, then a quiet last session.
  const flat: Candle[] = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
  }));
  const last: Candle = { ...flat[0]!, date: new Date(Date.UTC(2026, 4, 1)).toISOString(), open: 100, high: 104, low: 101, close: 103, volume: 3000 };
  const entry = { symbol: "TEST", yahoo: "TEST.NS", name: "Test Ltd", sector: "IT" as const };
  const snap = snapshotFromSeries(entry, { completed: [...flat, last], last: 103, inProgress: false });
  assert.ok(snap);
  // ATR(14) over 13 flat sessions and the last one: the last true range is 104 − 100 = 4, same as the flat ones.
  assert.equal(snap.atr14, 4);
  assert.equal(snap.atr_pct, 3.88, "4 ÷ 103");
  assert.equal(snap.coil_ratio, 0.75, "last session range 3 ÷ ATR 4");
  assert.equal(snap.sma20, 100.15, "(19 × 100 + 103) ÷ 20");
  assert.equal(snap.sma20_extension_pct, 2.85, "(103 − 100.15) ÷ 100.15");
  assert.equal(snap.prev_close, 100);
  assert.equal(snap.opening_gap_atr, 0.75, "(103 − 100) ÷ 4");
  assert.equal(snap.volume_ratio, 3);

  // While a session is open, the live price is measured against the last completed close.
  const live = snapshotFromSeries(entry, { completed: [...flat, last], last: 106, inProgress: true });
  assert.equal(live?.prev_close, 103);
  assert.equal(live?.opening_gap_atr, 0.75, "(106 − 103) ÷ 4");
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

test("Demo board runs through the real filter and yields 2–3+ candidates every day, with both gap states", () => {
  const states = new Set<string>();
  for (let day = 0; day < 60; day++) {
    const now = new Date(Date.UTC(2026, 10, 1 + day, 3, 0, 0));
    const { market, snapshots } = buildDemoInputs(now);
    const passing = snapshots.filter(passesHardFilter);
    assert.ok(passing.length >= 2, `day ${day}: only ${passing.length} passed`);
    for (const s of passing) states.add(computeLevels(s.current_price, s.prev_close, s.atr14).gap_status);
    const ranked = rankByRules(passing, market, new Map());
    assert.ok(ranked.every((r) => r.conviction >= 1 && r.conviction <= 99));
  }
  assert.deepEqual([...states].sort(), ["ACTIVE_BUY_ZONE", "WAIT_FOR_PULLBACK"], "the demo shows the gap guard working both ways");
  const a = buildDemoInputs(new Date("2026-11-01T03:00:00Z"));
  const b = buildDemoInputs(new Date("2026-11-01T08:00:00Z"));
  assert.deepEqual(a.snapshots, b.snapshots, "same IST day must produce the same board");
});

console.log(`\n${passed} passed`);
