/**
 * Smoke and sanity tests for the strategy diagnostics (src/lib/experiment.ts)
 * on synthetic random-walk stocks, where no screen can have a real edge.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { runExperiment } from "../src/lib/experiment";
import type { Candle, WatchlistEntry } from "../src/lib/types";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
}

// Small deterministic PRNG so the test never flakes.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

function walk(seed: number, sessions: number): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let price = 400 + seed;
  const start = Date.parse("2026-01-01T03:45:00Z");
  for (let d = 0; d < sessions; d++) {
    const open = price * (1 + 0.004 * gauss(r));
    const close = open * (1 + 0.016 * gauss(r));
    const high = Math.max(open, close) * (1 + 0.006 * r());
    const low = Math.min(open, close) * (1 - 0.006 * r());
    out.push({
      date: new Date(start + d * 86_400_000).toISOString(),
      open,
      high,
      low,
      close,
      volume: Math.round(1_000_000 * (0.6 + 1.6 * r())),
    });
    price = close;
  }
  return out;
}

const entries: WatchlistEntry[] = Array.from({ length: 40 }, (_, k) => ({
  symbol: `S${k}`,
  yahoo: `S${k}.NS`,
  name: `Stock ${k}`,
  sector: "IT",
}));
const series = entries.map((entry, k) => ({ entry, candles: walk(k + 1, 260) }));

console.log("Strategy diagnostics tests");
const t0 = Date.now();
const rep = runExperiment(series);
const ms = Date.now() - t0;

test("runs on 40 stocks × 260 sessions in a few seconds", () => {
  assert.ok(ms < 15_000, `took ${ms} ms`);
  assert.ok(rep.stockDays > 5000);
});

test("train/test split falls inside the period", () => {
  assert.ok(rep.period.split > rep.period.from && rep.period.split < rep.period.to);
});

test("every stock-day has zero excess return by construction", () => {
  const all = rep.groups.find((g) => g.name === "Every stock-day");
  assert.ok(all);
  for (const e of all.excess) assert.ok(Math.abs(e) < 0.05, `excess ${e}`);
});

test("on random walks the screen shows no significant edge", () => {
  const scr = rep.groups.find((g) => g.name.startsWith("Passes all 6"));
  assert.ok(scr);
  if (scr.n > 30) assert.ok(Math.abs(scr.t5) < 3.5, `t5 ${scr.t5}`);
});

test("every indicator has bins that add up to all stock-days", () => {
  for (const [name, rows] of Object.entries(rep.bins)) {
    assert.equal(rows.reduce((a, r) => a + r.n, 0), rep.stockDays, name);
  }
});

test("every stop/target variant is reported for the screen and for every day", () => {
  assert.equal(rep.variants.length, 6);
  for (const v of rep.variants) {
    assert.ok(v.everyDay.all.trades > 1000, v.name);
    assert.equal(v.everyDay.train.trades + v.everyDay.test.trades, v.everyDay.all.trades);
  }
});

test("buying the open never leaves a signal unfilled", () => {
  const open = rep.variants.find((v) => v.name.startsWith("Same levels, buy the next open"));
  assert.ok(open);
  assert.equal(open.everyDay.all.noFill, 0);
});

console.log(`\n${n} passed (${ms} ms)`);
