/**
 * Tests for the "latest session has a null close" fix (src/lib/market-data-pure.ts).
 * The scenario is the real one seen on Mon 2 Nov 2026: Yahoo returned the day's
 * bar with open/high/low/volume but close = null, hours after the bell.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { candlesFromBars, seriesFromCandles, type RawBar } from "../src/lib/market-data-pure";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
}

const ist = (iso: string) => new Date(`${iso}+05:30`);
const bar = (day: string, o: number, h: number, l: number, c: number | null, v = 1_000_000): RawBar => ({
  date: ist(`${day}T09:15:00`),
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
});

// Fri 30 Oct complete, Mon 2 Nov has no close.
const FRI = bar("2026-10-30", 1170.4, 1174.6, 1152.5, 1164.9, 14_753_650);
const MON = bar("2026-11-02", 1228.1, 1300, 1214.2, null, 88_043_504);

console.log("Session-close fix tests");

test("closed session, null close: the close is the last traded price (the Monday case)", () => {
  const out = candlesFromBars([FRI, MON], { price: 1300, time: ist("2026-11-02T15:29:30") }, ist("2026-11-03T00:39:00"));
  assert.equal(out.length, 2);
  assert.equal(out[1]?.close, 1300);
  assert.equal(out[1]?.volume, 88_043_504);
});

test("a stale last trade (stamped mid-session) is not used as the close", () => {
  // Last trade stamped 11:00 — the exchange may have halted it; do not invent a close.
  const out = candlesFromBars([FRI, MON], { price: 1250, time: ist("2026-11-02T11:00:00") }, ist("2026-11-03T00:39:00"));
  assert.equal(out.length, 1);
});

test("a last price outside the bar's own high–low range is not trusted", () => {
  const out = candlesFromBars([FRI, MON], { price: 1400, time: ist("2026-11-02T15:29:30") }, ist("2026-11-03T00:39:00"));
  assert.equal(out.length, 1);
});

test("a last trade from a different day is not trusted", () => {
  const out = candlesFromBars([FRI, MON], { price: 1164.9, time: ist("2026-10-30T15:29:30") }, ist("2026-11-03T00:39:00"));
  assert.equal(out.length, 1);
});

test("a null close in the middle of the series is still dropped", () => {
  const mid = bar("2026-10-29", 1159, 1182.1, 1155.6, null);
  const out = candlesFromBars([mid, FRI, MON], { price: 1300, time: ist("2026-11-02T15:29:30") }, ist("2026-11-03T00:39:00"));
  assert.deepEqual(
    out.map((c) => c.date.slice(0, 10)),
    ["2026-10-30", "2026-11-02"],
  );
});

test("session open: the forming bar is kept, then excluded from indicators as in progress", () => {
  const now = ist("2026-11-02T11:00:00");
  const bars: RawBar[] = [FRI, bar("2026-11-02", 1228.1, 1260, 1214.2, null, 30_000_000)];
  const candles = candlesFromBars(bars, { price: 1255, time: ist("2026-11-02T10:59:50") }, now);
  assert.equal(candles.length, 2);
  const regular = { start: ist("2026-11-02T09:15:00"), end: ist("2026-11-02T15:30:00") };
  const s = seriesFromCandles(candles, regular, 1255, now, ist("2026-11-02T10:59:50"));
  assert.equal(s.inProgress, true);
  assert.equal(s.completed.length, 1);
  assert.equal(s.last, 1255);
  assert.equal(s.behind, false);
});

test("bars with every field present are untouched", () => {
  const out = candlesFromBars([FRI], { price: 999, time: ist("2026-10-30T15:29:00") }, ist("2026-11-03T00:39:00"));
  assert.equal(out[0]?.close, 1164.9);
});

test("behind: Yahoo traded Monday but the newest candle we hold is Friday's", () => {
  const candles = candlesFromBars([FRI, MON], { price: 1250, time: ist("2026-11-02T11:00:00") }, ist("2026-11-03T00:39:00"));
  const regular = { start: ist("2026-11-03T09:15:00"), end: ist("2026-11-03T15:30:00") };
  const s = seriesFromCandles(candles, regular, 1250, ist("2026-11-03T00:39:00"), ist("2026-11-02T11:00:00"));
  assert.equal(s.behind, true);
});

test("not behind on a weekend: the last trade was Friday and Friday is the newest candle", () => {
  const candles = candlesFromBars([FRI], { price: 1164.9, time: ist("2026-10-30T15:29:00") }, ist("2026-10-31T10:00:00"));
  const regular = { start: ist("2026-11-02T09:15:00"), end: ist("2026-11-02T15:30:00") };
  const s = seriesFromCandles(candles, regular, 1164.9, ist("2026-10-31T10:00:00"), ist("2026-10-30T15:29:00"));
  assert.equal(s.behind, false);
});

console.log(`\n${n} passed`);
