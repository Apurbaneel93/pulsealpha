/**
 * The momentum strategy end to end, on pure functions: the six-check screen,
 * the gap-guard levels, the unpriced-catalyst classifier, the staggered T1/T2
 * exits in the backtest, and the pinned Gemini prompt. No network.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { breakEvenT1RatePct, funnel, replaySymbol, simulate, summarize, type SimLevels, type Trade } from "../src/lib/backtest";
import { SYSTEM_INSTRUCTION } from "../src/lib/gemini-prompt";
import { EXIT_PLAN, EXIT_SPLIT, LEVEL_MULTIPLIERS, computeLevels } from "../src/lib/levels";
import {
  HARD_FILTER,
  buildBoard,
  checksFor,
  classifyCatalyst,
  convictionScore,
  passesHardFilter,
  rankByRules,
  rulesBreakdown,
  rulesExecutionRisk,
  sessionCloseMs,
} from "../src/lib/rules-engine";
import type { Candle, MarketCues, NewsItem, TechnicalSnapshot, WatchlistEntry } from "../src/lib/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("PulseAlpha strategy tests");

// A stock that clears every check with room to spare. Tests nudge one field at a time.
const GOOD: TechnicalSnapshot = {
  symbol: "GOOD",
  name: "Good Ltd",
  sector: "Capital Goods",
  current_price: 1000,
  prev_close: 990,
  day_change_pct: 1.01,
  sma20: 970,
  ema20: 972,
  ema50: 940,
  rsi14: 58,
  atr14: 25,
  atr_pct: 2.5,
  coil_ratio: 1.0,
  sma20_extension_pct: 3.09,
  opening_gap_atr: 0.4,
  volume_ratio: 2.0,
  latest_volume: 2_000_000,
  avg_volume20: 1_000_000,
  as_of_session: "2026-10-30T03:45:00.000Z",
  spark: [],
};
const snap = (patch: Partial<TechnicalSnapshot>): TechnicalSnapshot => ({ ...GOOD, ...patch });
const NEUTRAL: MarketCues = { regime: "Neutral", score: 0, indices: [], summary: "" };
const BULL: MarketCues = { regime: "Bullish", score: 1.5, indices: [], summary: "" };

// ── The screen ──────────────────────────────────────────────────────────────

test("The screen passes a clean setup, and every limit is inclusive at its edge", () => {
  assert.equal(passesHardFilter(GOOD), true);
  assert.deepEqual(HARD_FILTER, { rsiMin: 52, rsiMax: 65, maxExtensionPct: 4.5, maxCoilRatio: 1.25, minAtrPct: 2.2, volumeRatioMin: 1.5 });
  for (const ok of [
    { rsi14: 52 },
    { rsi14: 65 },
    { sma20_extension_pct: 4.5 },
    { coil_ratio: 1.25 },
    { atr_pct: 2.2 },
    { volume_ratio: 1.5 },
  ]) {
    assert.equal(passesHardFilter(snap(ok)), true, `edge ${JSON.stringify(ok)} should pass`);
  }
});

test("Each check fails on its own, just past the edge, and names the check that failed", () => {
  const cases: Array<[string, Partial<TechnicalSnapshot>]> = [
    ["trend", { current_price: 960 }], // at or below the 20-DMA (sma20 is 970)
    ["trend", { current_price: 970 }],
    ["extension", { sma20_extension_pct: 4.51 }],
    ["rsi", { rsi14: 51.99 }],
    ["rsi", { rsi14: 65.01 }],
    ["coil", { coil_ratio: 1.26 }],
    ["volatility", { atr_pct: 2.19 }],
    ["volume", { volume_ratio: 1.49 }],
  ];
  for (const [key, patch] of cases) {
    const s = snap(patch);
    assert.equal(passesHardFilter(s), false, `${JSON.stringify(patch)} must fail`);
    const checks = checksFor(s);
    assert.equal(checks[key as keyof typeof checks], false, `${key} is the failing check for ${JSON.stringify(patch)}`);
    assert.equal(Object.values(checks).filter((v) => !v).length, 1, "only that one check fails");
  }
});

test("The board lists stocks above the 20-DMA, ranked by checks passed (out of six), then score", () => {
  const rows = buildBoard(
    [
      snap({ symbol: "A" }), // 6/6
      snap({ symbol: "B", rsi14: 70 }), // 5/6
      snap({ symbol: "C", rsi14: 70, volume_ratio: 1.0 }), // 4/6
      snap({ symbol: "D", current_price: 900 }), // below the 20-DMA: not listed
    ],
    NEUTRAL,
  );
  assert.deepEqual(rows.map((r) => [r.symbol, r.passed]), [["A", 6], ["B", 5], ["C", 4]]);
  assert.ok(rows.every((r) => r.checks.trend));
});

test("Funnel counts each check independently, plus the stocks passing all six", () => {
  const f = funnel([GOOD, snap({ rsi14: 70 }), snap({ coil_ratio: 2 }), snap({ current_price: 900 })]);
  assert.equal(f.scanned, 4);
  assert.equal(f.passedAll, 1);
  assert.equal(f.rsi, 3);
  assert.equal(f.coil, 3);
  assert.equal(f.trend, 3);
});

// ── Levels and the gap guard ────────────────────────────────────────────────

test("Active buy zone: base entry is the current price; zone ±0.10 ATR; SL −0.90; T1 +1.15; T2 +2.00", () => {
  const l = computeLevels(1000, 990, 20); // gap = 10 ÷ 20 = 0.5 ATR
  assert.equal(l.gap_status, "ACTIVE_BUY_ZONE");
  assert.equal(l.opening_gap_atr, 0.5);
  assert.deepEqual(
    { base: l.base_entry, lo: l.entry_low, hi: l.entry_high, sl: l.stop_loss, t1: l.target_1, t2: l.target_2 },
    { base: 1000, lo: 998, hi: 1002, sl: 982, t1: 1023, t2: 1040 },
  );
  assert.equal(l.target_1_pct, 2.3);
  assert.equal(l.target_2_pct, 4);
  assert.equal(l.stop_pct, -1.8);
});

test("Gap guard: above 0.75 ATR it waits for a pullback, anchored at previous close + 0.35 ATR", () => {
  const l = computeLevels(1030, 1000, 20); // gap = 1.5 ATR
  assert.equal(l.gap_status, "WAIT_FOR_PULLBACK");
  assert.equal(l.opening_gap_atr, 1.5);
  assert.deepEqual(
    { base: l.base_entry, lo: l.entry_low, hi: l.entry_high, sl: l.stop_loss, t1: l.target_1, t2: l.target_2 },
    { base: 1007, lo: 1005, hi: 1009, sl: 989, t1: 1030, t2: 1047 },
  );
  assert.ok(l.entry_high < 1030, "the buy zone is below the spike, not at it");
});

test("Gap guard boundary: exactly 0.75 ATR is still active; a hair more is not", () => {
  assert.equal(computeLevels(1015, 1000, 20).gap_status, "ACTIVE_BUY_ZONE");
  assert.equal(computeLevels(1015.05, 1000, 20).gap_status, "WAIT_FOR_PULLBACK");
  assert.equal(computeLevels(990, 1000, 20).gap_status, "ACTIVE_BUY_ZONE", "a gap down is never a chase");
  assert.equal(computeLevels(990, 1000, 20).opening_gap_atr, -0.5);
});

test("Levels sit on the NSE ₹0.05 tick and keep their order", () => {
  for (const [price, prev, atr] of [[412.37, 409.9, 9.13], [2873.35, 2801.2, 61.7], [96.15, 95.4, 2.41]] as const) {
    const l = computeLevels(price, prev, atr);
    for (const v of [l.base_entry, l.entry_low, l.entry_high, l.stop_loss, l.target_1, l.target_2]) {
      assert.ok(Math.abs(Math.round(v * 20) - v * 20) < 1e-6, `${v} not on the 0.05 tick`);
    }
    assert.ok(l.stop_loss < l.entry_low && l.entry_low <= l.entry_high && l.entry_high < l.target_1 && l.target_1 < l.target_2);
  }
});

test("The exit plan carries the T1/T2 instructions, and the split adds up", () => {
  assert.equal(EXIT_PLAN.target1, "Book 60% & Trail SL to Breakeven");
  assert.equal(EXIT_PLAN.target2, "Book 40% or Trail 15m 9-EMA");
  assert.equal(EXIT_SPLIT.target1 + EXIT_SPLIT.target2, 1);
  assert.deepEqual(LEVEL_MULTIPLIERS, { gapGuard: 0.75, pullbackAnchor: 0.35, entryBand: 0.1, stop: 0.9, target1: 1.15, target2: 2.0 });
});

// ── Catalysts: fresh and unpriced vs. a recap ───────────────────────────────

const AS_OF = "2026-10-30T03:45:00.000Z"; // the Friday session; it closed at 15:30 IST = 10:00 UTC
const CLOSE = sessionCloseMs(AS_OF);
const news = (title: string, minutesAfterClose: number): NewsItem => ({
  title,
  source: "Wire",
  link: `https://example.com/${encodeURIComponent(title)}`,
  publishedAt: new Date(CLOSE + minutesAfterClose * 60_000).toISOString(),
});

test("The session close is 15:30 IST on the day of the last completed session", () => {
  assert.equal(new Date(CLOSE).toISOString(), "2026-10-30T10:00:00.000Z");
});

test("Headlines that recap a move are 'Priced-In Recap'; the model's own three examples included", () => {
  for (const t of ["Why Stock X surged 5% today", "Stock hits 52-week high", "Top gainers today: X, Y, Z", "Shares rally on strong day"]) {
    const c = classifyCatalyst([news(t, 30)], AS_OF);
    assert.equal(c.freshness, "Priced-In Recap", t);
  }
});

test("A non-recap headline after the close is 'Unpriced Post-Market', categorised by what it says", () => {
  const cases: Array<[string, string]> = [
    ["LT bags large order from defence ministry", "Order Win"],
    ["BEL wins Rs 500 crore order", "Order Win"],
    ["Sun Pharma gets USFDA approval for new drug", "Regulatory"],
    ["Infosys Q2 profit beats estimates as margins expand", "Earnings Beat"],
    ["Government announces new subsidy for EV makers", "Sector Tailwind"],
    ["Brokerage upgrades stock with higher target", "Technical Coil Breakout"], // nothing categorisable: falls back to the coil
  ];
  for (const [title, category] of cases) {
    const c = classifyCatalyst([news(title, 45)], AS_OF);
    assert.equal(c.freshness, "Unpriced Post-Market", title);
    assert.equal(c.category, category, title);
  }
});

test("News from before the close is 'Ongoing Multi-Day'; no news at all is a plain technical setup", () => {
  assert.equal(classifyCatalyst([news("Company wins order", -300)], AS_OF).freshness, "Ongoing Multi-Day");
  const none = classifyCatalyst([], AS_OF);
  assert.deepEqual([none.category, none.freshness, none.lead], ["Technical Coil Breakout", "Ongoing Multi-Day", null]);
});

test("A recap headline does not hide a fresh one next to it", () => {
  const c = classifyCatalyst([news("Why X surged today", 20), news("X wins large order", 40)], AS_OF);
  assert.equal(c.freshness, "Unpriced Post-Market");
  assert.equal(c.category, "Order Win");
});

test("Conviction rewards fresh catalysts and punishes recaps, a spent gap and exhaustion", () => {
  const base = convictionScore(GOOD, NEUTRAL);
  const fresh = convictionScore(GOOD, NEUTRAL, [news("X wins large order", 30)]);
  const recap = convictionScore(GOOD, NEUTRAL, [news("Why X surged today", 30)]);
  assert.ok(fresh > base && base > recap, `fresh ${fresh} > none ${base} > recap ${recap}`);
  assert.ok(convictionScore(snap({ opening_gap_atr: 1.2 }), NEUTRAL) < base, "already ran past the gap guard");
  assert.ok(convictionScore(snap({ rsi14: 64.9 }), NEUTRAL) < base, "near the RSI ceiling is less attractive than mid-band");
  assert.ok(convictionScore(snap({ coil_ratio: 1.24 }), NEUTRAL) < convictionScore(snap({ coil_ratio: 0.8 }), NEUTRAL), "tighter coil scores higher");
  assert.ok(convictionScore(GOOD, BULL) > base, "a risk-on regime helps");
  for (const s of [GOOD, snap({ volume_ratio: 9 }), snap({ rsi14: 52, coil_ratio: 1.25, atr_pct: 2.2, volume_ratio: 1.5 })]) {
    const c = convictionScore(s, BULL, [news("X wins large order", 30)]);
    assert.ok(c >= 1 && c <= 99);
  }
});

test("Rules ranking is by conviction, and the fallback copy never contains a price", () => {
  const ranked = rankByRules([snap({ symbol: "LOW", volume_ratio: 1.5, coil_ratio: 1.2 }), snap({ symbol: "HIGH", volume_ratio: 3 })], NEUTRAL, new Map());
  assert.deepEqual(ranked.map((r) => r.snapshot.symbol), ["HIGH", "LOW"]);
  const b = rulesBreakdown(GOOD, NEUTRAL, [news("X wins large order", 30)]);
  for (const text of [b.global_cue, b.technical_trigger, b.thesis, rulesExecutionRisk(GOOD), rulesExecutionRisk(snap({ opening_gap_atr: 1 }))]) {
    assert.ok(!/₹|\bRs\b/.test(text), text);
  }
  assert.match(b.technical_trigger, /1\.00x ATR/);
  assert.match(rulesExecutionRisk(GOOD), /0\.75 ATR/);
});

// ── Staggered exits ─────────────────────────────────────────────────────────

const LV: SimLevels = { entry_high: 100.5, stop_loss: 95, target_1: 110, target_2: 120 };
let day = 0;
const bar = (open: number, high: number, low: number, close = open): Candle => ({
  date: new Date(Date.UTC(2026, 0, 1 + day++)).toISOString(),
  open,
  high,
  low,
  close,
  volume: 1000,
});
const signal = () => bar(100, 101, 99);
const run = (bars: Candle[], horizon = 5) => simulate([signal(), ...bars], 0, LV, horizon);
const ret = (r: ReturnType<typeof run>) => {
  assert.ok(typeof r === "object");
  return Math.round(r.returnPct * 100) / 100;
};

test("No fill when the next session opens above the zone and never trades down into it", () => {
  assert.equal(run([bar(103, 105, 102)]), "nofill");
  const r = run([bar(103, 105, 100, 104)], 1);
  assert.ok(typeof r === "object" && r.fill === 100.5, "fills at the top of the zone if the day trades down to it");
});

test("Stopped out before Target 1 loses the whole position", () => {
  const r = run([bar(100, 105, 94)]);
  assert.ok(typeof r === "object");
  assert.equal(r.outcome, "stop");
  assert.equal(r.reachedT1, false);
  assert.equal(ret(r), -5);
});

test("Stop and Target 1 in the same session: the stop is assumed to hit first", () => {
  const r = run([bar(100, 112, 94)]);
  assert.ok(typeof r === "object");
  assert.equal(r.outcome, "stop");
});

test("Target 1 books 60%, then the breakeven stop exits the rest from the next session: +6.0%", () => {
  const r = run([bar(100, 111, 99), bar(108, 109, 99.5)]);
  assert.ok(typeof r === "object");
  assert.equal(r.outcome, "t1_breakeven");
  assert.equal(r.reachedT1, true);
  assert.equal(r.sessions, 2);
  assert.equal(ret(r), 6, "0.6 × 10% + 0.4 × 0%");
});

test("Target 1 then Target 2 on a later session: +14.0%", () => {
  const r = run([bar(100, 111, 99), bar(108, 121, 105)]);
  assert.ok(typeof r === "object");
  assert.equal(r.outcome, "target_2");
  assert.equal(ret(r), 14, "0.6 × 10% + 0.4 × 20%");
});

test("Both targets inside one session count as Target 2", () => {
  const r = run([bar(100, 121, 99)]);
  assert.ok(typeof r === "object");
  assert.equal(r.outcome, "target_2");
  assert.equal(r.sessions, 1);
  assert.equal(ret(r), 14);
});

test("Gaps fill at the open, not at the level", () => {
  const up = run([bar(100, 111, 99), bar(125, 126, 124)]);
  assert.equal(ret(up), 16, "T2 gap-up fills at 125: 0.6 × 10% + 0.4 × 25%");
  const down = run([bar(100, 111, 99), bar(97, 99, 96)]);
  assert.equal(ret(down), 4.8, "breakeven gap-down fills at 97: 0.6 × 10% + 0.4 × −3%");
  const stopGap = run([bar(100, 101, 99.5), bar(90, 91, 89)]);
  assert.ok(typeof stopGap === "object" && stopGap.exit === 90, "a stop gapped through fills at the open");
});

test("Still open at the horizon: the rest is sold at that close; 'open' while data runs out", () => {
  const t = run([bar(100, 104, 98, 102), bar(102, 105, 99, 103)], 2);
  assert.ok(typeof t === "object");
  assert.equal(t.outcome, "timeout");
  assert.equal(t.reachedT1, false);
  assert.equal(ret(t), 3);
  const afterT1 = run([bar(100, 111, 99, 109), bar(109, 112, 101, 110)], 2);
  assert.ok(typeof afterT1 === "object");
  assert.equal(afterT1.outcome, "timeout");
  assert.equal(afterT1.reachedT1, true);
  assert.equal(ret(afterT1), 10, "T1 booked at +10%, the rest sold at the +10% close");
  assert.equal(run([bar(100, 104, 98, 102)], 3), "open");
});

test("Break-even Target-1 hit rate follows from the multipliers (about 56.6%)", () => {
  assert.equal(breakEvenT1RatePct(), 56.6);
});

test("summarize counts every outcome and blends returns", () => {
  const t = (outcome: Trade["outcome"], returnPct: number, reachedT1: boolean): Trade => ({
    symbol: "X", signalDate: "2026-01-01", conviction: 70, fill: 100, exit: 100, reachedT1, outcome, returnPct, sessions: 1,
  });
  const s = summarize([t("stop", -5, false), t("t1_breakeven", 6, true), t("target_2", 14, true), t("timeout", 2, false)]);
  assert.deepEqual(
    [s.trades, s.stopHits, s.breakevenExits, s.t2Hits, s.t1Hits, s.timeouts],
    [4, 1, 1, 1, 2, 1],
  );
  assert.equal(s.t1RatePct, 50);
  assert.equal(s.avgReturnPct, 4.25);
  assert.equal(s.winRatePct, 75);
});

test("Replay runs the real pipeline on a synthetic history without errors, and trades are consistent", () => {
  const entry: WatchlistEntry = { symbol: "SYN", yahoo: "SYN.NS", name: "Synthetic", sector: "IT" };
  let price = 100;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const candles: Candle[] = Array.from({ length: 260 }, (_, i) => {
    const open = price;
    price *= 1 + (rand() - 0.47) * 0.05;
    return {
      date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
      open,
      high: Math.max(open, price) * (1 + rand() * 0.01),
      low: Math.min(open, price) * (1 - rand() * 0.01),
      close: price,
      volume: Math.round(1e6 * (0.6 + rand() * 1.6)),
    };
  });
  const r = replaySymbol(entry, candles, [5]);
  assert.ok((r.baseline[5]?.length ?? 0) > 100, "baseline trades every session");
  for (const t of r.baseline[5] ?? []) {
    assert.ok(Number.isFinite(t.returnPct));
    assert.ok(t.outcome !== "stop" || !t.reachedT1);
    assert.ok(t.outcome !== "target_2" || t.reachedT1);
  }
  assert.ok((r.signals[5]?.length ?? 0) <= (r.baseline[5]?.length ?? 0));
});

// ── The Gemini prompt ───────────────────────────────────────────────────────

test("The system prompt carries the role, the four rules and the JSON contract the parser relies on", () => {
  const p = SYSTEM_INSTRUCTION;
  for (const piece of [
    "You are a Senior Institutional Momentum Trader and Equity Catalyst Analyst specializing in 1-day intraday and overnight swing setups on the Indian stock market (NSE/BSE).",
    "TOP 2 to 3",
    "Never invent or output stock prices.",
    "REJECT BACKWARD-LOOKING RECAPS",
    "PRIORITIZE FRESH, UNPRICED CATALYSTS",
    "3:30 PM IST",
    "Tier 1",
    "Tier 2",
    "ENFORCE VOLATILITY COIL & ANTI-EXHAUSTION",
    "coilRatio < 1.15",
    "atrPercent >= 2.5%",
    "RSI > 65",
    "coilRatio > 1.3",
    "MARKET REGIME ALIGNMENT",
    "S&P 500, Nasdaq, and Nifty 50",
    "marketRegimeSummary",
    "convictionScore",
    "catalystCategory",
    "Order Win | Earnings Beat | Regulatory | Sector Tailwind | Technical Coil Breakout",
    "catalystFreshness",
    "Unpriced Post-Market | Ongoing Multi-Day | Priced-In Recap",
    "whyItWillExpandToday",
    "executionRisk",
    "Skip if opening gap exceeds 0.75 ATR",
  ]) {
    assert.ok(p.includes(piece), `prompt is missing: ${piece}`);
  }
  assert.ok(!/₹/.test(p), "the prompt itself contains no prices");
});

test("Every category and freshness value the prompt offers is a value the app understands", async () => {
  const { CATALYST_CATEGORIES, CATALYST_FRESHNESS } = await import("../src/lib/gemini");
  const line = (label: string) => new RegExp(`"${label}": "([^"]+)"`).exec(SYSTEM_INSTRUCTION)?.[1]?.split(" | ") ?? [];
  assert.deepEqual(line("catalystCategory"), [...CATALYST_CATEGORIES]);
  assert.deepEqual(line("catalystFreshness"), [...CATALYST_FRESHNESS]);
});

console.log(`\n${passed} passed`);
