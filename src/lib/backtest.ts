/**
 * Accuracy-check core, shared by the browser runner and `npm run verify`.
 * Uses the app's own indicator, filter, ranking and level code — nothing
 * re-implemented — so what is measured here is what the app ships.
 */
import { LOOKBACK_DAYS, seriesFromCandles, snapshotFromSeries } from "./market-data-pure";
import { EXIT_SPLIT, LEVEL_MULTIPLIERS, computeLevels } from "./levels";
import { checksFor, convictionScore, passesHardFilter } from "./rules-engine";
import { CHECK_KEYS } from "./types";
import type { Candle, CheckKey, MarketCues, TechnicalSnapshot, WatchlistEntry } from "./types";

/** The app computes indicators on ~200 calendar days; replay uses the same window size. */
export const WINDOW_SESSIONS = 135;

export function lookbackSlice(candles: Candle[], now: Date): Candle[] {
  const from = now.getTime() - LOOKBACK_DAYS * 86_400_000;
  return candles.filter((c) => new Date(c.date).getTime() >= from);
}

/** Today's snapshot exactly as the app computes it. */
export function liveSnapshot(
  entry: WatchlistEntry,
  candles: Candle[],
  regular: { start: Date; end: Date } | undefined,
  metaPrice: number,
  now: Date,
): TechnicalSnapshot | null {
  return snapshotFromSeries(entry, seriesFromCandles(lookbackSlice(candles, now), regular, metaPrice, now));
}

/** How many stocks pass each check on its own, and how many pass all six. */
export type FilterFunnel = Record<"scanned" | "passedAll" | CheckKey, number>;

export function funnel(snaps: readonly TechnicalSnapshot[]): FilterFunnel {
  const out = { scanned: snaps.length, passedAll: snaps.filter(passesHardFilter).length } as FilterFunnel;
  for (const k of CHECK_KEYS) out[k] = snaps.filter((s) => checksFor(s)[k]).length;
  return out;
}

// ── Backtest ────────────────────────────────────────────────────────────────

/**
 * How a trade ended:
 *   stop         — stopped out before Target 1, a full loss
 *   t1_breakeven — Target 1 booked (60%), the rest stopped at breakeven
 *   target_2     — both targets hit
 *   timeout      — still open after the horizon; the remainder sold at that close
 */
export type Outcome = "stop" | "t1_breakeven" | "target_2" | "timeout";

export interface Trade {
  symbol: string;
  signalDate: string;
  conviction: number;
  fill: number;
  /** Where the last part of the position was sold. */
  exit: number;
  /** Whether Target 1 was reached (so 60% was booked). */
  reachedT1: boolean;
  outcome: Outcome;
  /** Blended return on the whole position, in percent. */
  returnPct: number;
  sessions: number;
}

/** Same-day macro term is identical for every stock, so ranking within a day ignores it. */
const NEUTRAL_MARKET: MarketCues = { regime: "Neutral", score: 0, indices: [], summary: "" };

export interface SimLevels {
  entry_high: number;
  target_1: number;
  target_2: number;
  stop_loss: number;
}

export interface SimResult {
  fill: number;
  exit: number;
  reachedT1: boolean;
  outcome: Outcome;
  returnPct: number;
  sessions: number;
}

const pctMove = (from: number, to: number) => ((to - from) / from) * 100;

/**
 * One trade from a signal on candle i, or "nofill"/"open" when it can't be scored.
 *
 * Daily bars hide the order of events inside a session, so every ambiguity is
 * resolved against the trade:
 *   - the stop is checked before Target 1 in the same session;
 *   - after Target 1 the stop moves to breakeven (the fill) from the NEXT
 *     session — in the session that reached Target 1 only Target 2 is credited,
 *     and only if that session's high reached it;
 *   - gaps fill at the open, not at the level.
 */
export function simulate(candles: Candle[], i: number, lv: SimLevels, horizon: number): SimResult | "nofill" | "open" {
  const j = i + 1;
  const fillBar = candles[j];
  if (!fillBar) return "open";
  let fill: number;
  if (fillBar.open <= lv.entry_high) fill = fillBar.open;
  else if (fillBar.low <= lv.entry_high) fill = lv.entry_high;
  else return "nofill";

  const blend = (t1: number | null, rest: number) =>
    t1 === null
      ? pctMove(fill, rest)
      : EXIT_SPLIT.target1 * pctMove(fill, t1) + EXIT_SPLIT.target2 * pctMove(fill, rest);

  let t1Price: number | null = null;
  for (let k = j; k < Math.min(candles.length, j + horizon); k++) {
    const b = candles[k];
    if (!b) break;
    const sessions = k - j + 1;
    if (t1Price === null) {
      if (b.low <= lv.stop_loss) {
        let exit = k > j && b.open < lv.stop_loss ? b.open : lv.stop_loss;
        if (k === j && fill <= lv.stop_loss) exit = fill;
        return { fill, exit, reachedT1: false, outcome: "stop", returnPct: blend(null, exit), sessions };
      }
      if (b.high >= lv.target_1) {
        t1Price = k > j && b.open > lv.target_1 ? b.open : lv.target_1;
        if (b.high >= lv.target_2) {
          const exit = k > j && b.open > lv.target_2 ? b.open : lv.target_2;
          return { fill, exit, reachedT1: true, outcome: "target_2", returnPct: blend(t1Price, exit), sessions };
        }
      }
    } else {
      // Breakeven stop on the remaining 40%.
      if (b.low <= fill) {
        const exit = b.open < fill ? b.open : fill;
        return { fill, exit, reachedT1: true, outcome: "t1_breakeven", returnPct: blend(t1Price, exit), sessions };
      }
      if (b.high >= lv.target_2) {
        const exit = b.open > lv.target_2 ? b.open : lv.target_2;
        return { fill, exit, reachedT1: true, outcome: "target_2", returnPct: blend(t1Price, exit), sessions };
      }
    }
  }
  const last = candles[j + horizon - 1];
  if (!last) return "open"; // still running at the end of the data
  return { fill, exit: last.close, reachedT1: t1Price !== null, outcome: "timeout", returnPct: blend(t1Price, last.close), sessions: horizon };
}

export interface SymbolReplay {
  /** Trades from sessions where the app's hard filter passed, per horizon. */
  signals: Record<number, Trade[]>;
  /** Signals whose next session never traded inside the buy zone. */
  noFill: Record<number, number>;
  /** Same entry/exit rules applied to every session, no filter (the baseline). */
  baseline: Record<number, Trade[]>;
}

/**
 * Walk one stock's history and replay the trade each card would have described:
 *   - Indicators from the previous ~135 completed sessions, as the app does.
 *   - Levels from the same gap guard as the card: a stock that closed more than
 *     0.75 ATR above its previous close is planned as a pullback entry.
 *   - Entry next session: at the open if inside (or below) the buy zone, else
 *     at the top of the zone if the day trades down into it, else no fill.
 *   - Exits: 60% at Target 1 (+1.15 ATR) with the stop moved to breakeven, the
 *     rest at Target 2 (+2.00 ATR) or at breakeven; otherwise the close after
 *     `horizon` sessions.
 */
export function replaySymbol(entry: WatchlistEntry, candles: Candle[], horizons: readonly number[]): SymbolReplay {
  const out: SymbolReplay = { signals: {}, noFill: {}, baseline: {} };
  for (const h of horizons) {
    out.signals[h] = [];
    out.noFill[h] = 0;
    out.baseline[h] = [];
  }
  for (let i = 60; i < candles.length - 1; i++) {
    const bar = candles[i];
    if (!bar) continue;
    const window = candles.slice(Math.max(0, i - WINDOW_SESSIONS + 1), i + 1);
    const snap = snapshotFromSeries(entry, { completed: window, last: bar.close, inProgress: false });
    if (!snap) continue;
    const passed = passesHardFilter(snap);
    const lv = computeLevels(snap.current_price, snap.prev_close, snap.atr14);
    const conviction = convictionScore(snap, NEUTRAL_MARKET);
    for (const h of horizons) {
      const r = simulate(candles, i, lv, h);
      if (r === "open") continue;
      if (r === "nofill") {
        if (passed) out.noFill[h] = (out.noFill[h] ?? 0) + 1;
        continue;
      }
      const trade: Trade = {
        symbol: entry.symbol,
        signalDate: bar.date,
        conviction,
        fill: r.fill,
        exit: r.exit,
        reachedT1: r.reachedT1,
        outcome: r.outcome,
        returnPct: r.returnPct,
        sessions: r.sessions,
      };
      out.baseline[h]?.push(trade);
      if (passed) out.signals[h]?.push(trade);
    }
  }
  return out;
}

export interface BacktestReport {
  period: { from: string; to: string };
  symbols: number;
  /** Share of trades that must reach Target 1 for the plan to break even if no runner reaches Target 2. */
  breakEvenT1RatePct: number;
  horizons: Array<{
    sessions: number;
    topPicks: Stats;
    allSignals: Stats;
    baselineEveryDay: Stats;
    noFillSignals: number;
  }>;
  recentTopPicks: Array<{ symbol: string; signalDate: string; outcome: Outcome; returnPct: number; sessions: number }>;
}

/** Replay every symbol and aggregate into the app-board view, all signals, and the no-filter baseline. */
/**
 * Winners book 60% at +1.15 ATR and the rest at breakeven; losers lose 0.9 ATR.
 * p × 0.6 × 1.15 = (1 − p) × 0.9  →  p = 0.9 ÷ (0.9 + 0.6 × 1.15) ≈ 56.6%.
 */
export function breakEvenT1RatePct(): number {
  const win = EXIT_SPLIT.target1 * LEVEL_MULTIPLIERS.target1;
  return Math.round((LEVEL_MULTIPLIERS.stop / (LEVEL_MULTIPLIERS.stop + win)) * 1000) / 10;
}

export function runBacktest(
  series: ReadonlyArray<{ entry: WatchlistEntry; candles: Candle[] }>,
  horizons: readonly number[] = [10, 5],
): BacktestReport {
  const signals: Record<number, Trade[]> = {};
  const baseline: Record<number, Trade[]> = {};
  const noFill: Record<number, number> = {};
  for (const h of horizons) {
    signals[h] = [];
    baseline[h] = [];
    noFill[h] = 0;
  }
  let from = "9999-12-31";
  let to = "0000-01-01";
  for (const { entry, candles } of series) {
    const r = replaySymbol(entry, candles, horizons);
    for (const h of horizons) {
      signals[h]?.push(...(r.signals[h] ?? []));
      baseline[h]?.push(...(r.baseline[h] ?? []));
      noFill[h] = (noFill[h] ?? 0) + (r.noFill[h] ?? 0);
    }
    const d0 = candles[60]?.date.slice(0, 10);
    const d1 = candles[candles.length - 1]?.date.slice(0, 10);
    if (d0 && d0 < from) from = d0;
    if (d1 && d1 > to) to = d1;
  }
  const main = horizons[0] ?? 10;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    period: { from, to },
    symbols: series.length,
    breakEvenT1RatePct: breakEvenT1RatePct(),
    horizons: horizons.map((h) => ({
      sessions: h,
      topPicks: summarize(topPicksPerDay(signals[h] ?? [])),
      allSignals: summarize(signals[h] ?? []),
      baselineEveryDay: summarize(baseline[h] ?? []),
      noFillSignals: noFill[h] ?? 0,
    })),
    recentTopPicks: topPicksPerDay(signals[main] ?? [])
      .sort((a, b) => b.signalDate.localeCompare(a.signalDate))
      .slice(0, 15)
      .map((t) => ({
        symbol: t.symbol,
        signalDate: t.signalDate.slice(0, 10),
        outcome: t.outcome,
        returnPct: r2(t.returnPct),
        sessions: t.sessions,
      })),
  };
}

/** Mirror the app's board: per signal date, top 2 by conviction, plus a third if it scores ≥ 50. */
export function topPicksPerDay(trades: readonly Trade[]): Trade[] {
  const byDay = new Map<string, Trade[]>();
  for (const t of trades) {
    const day = t.signalDate.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), t]);
  }
  const out: Trade[] = [];
  for (const list of byDay.values()) {
    const ranked = [...list].sort((a, b) => b.conviction - a.conviction);
    ranked.slice(0, 3).forEach((t, idx) => {
      if (idx < 2 || t.conviction >= 50) out.push(t);
    });
  }
  return out;
}

export interface Stats {
  trades: number;
  /** Trades that reached Target 1 (including those that went on to Target 2). */
  t1Hits: number;
  t2Hits: number;
  /** Stopped out before Target 1: full losses. */
  stopHits: number;
  /** Target 1 booked, the rest stopped at breakeven. */
  breakevenExits: number;
  timeouts: number;
  /** Share of trades that reached Target 1. */
  t1RatePct: number;
  t2RatePct: number;
  /** Share of trades with a positive return (targets + profitable timeouts). */
  winRatePct: number;
  avgReturnPct: number;
  medianReturnPct: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  avgSessionsHeld: number;
}

export function summarize(trades: readonly Trade[]): Stats {
  const n = trades.length;
  const rets = trades.map((t) => t.returnPct).sort((a, b) => a - b);
  const wins = trades.filter((t) => t.returnPct > 0);
  const losses = trades.filter((t) => t.returnPct <= 0);
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const grossWin = sum(wins.map((t) => t.returnPct));
  const grossLoss = Math.abs(sum(losses.map((t) => t.returnPct)));
  return {
    trades: n,
    t1Hits: trades.filter((t) => t.reachedT1).length,
    t2Hits: trades.filter((t) => t.outcome === "target_2").length,
    stopHits: trades.filter((t) => t.outcome === "stop").length,
    breakevenExits: trades.filter((t) => t.outcome === "t1_breakeven").length,
    timeouts: trades.filter((t) => t.outcome === "timeout").length,
    t1RatePct: n ? r2((trades.filter((t) => t.reachedT1).length / n) * 100) : 0,
    t2RatePct: n ? r2((trades.filter((t) => t.outcome === "target_2").length / n) * 100) : 0,
    winRatePct: n ? r2((wins.length / n) * 100) : 0,
    avgReturnPct: n ? r2(sum(rets) / n) : 0,
    medianReturnPct: n ? r2(rets[Math.floor(n / 2)] ?? 0) : 0,
    avgWinPct: wins.length ? r2(grossWin / wins.length) : 0,
    avgLossPct: losses.length ? r2(-grossLoss / losses.length) : 0,
    profitFactor: grossLoss ? r2(grossWin / grossLoss) : 0,
    avgSessionsHeld: n ? r2(sum(trades.map((t) => t.sessions)) / n) : 0,
  };
}
