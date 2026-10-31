/**
 * Accuracy-check core, shared by the browser runner and `npm run verify`.
 * Uses the app's own indicator, filter, ranking and level code — nothing
 * re-implemented — so what is measured here is what the app ships.
 */
import { LOOKBACK_DAYS, seriesFromCandles, snapshotFromSeries } from "./market-data-pure";
import { computeLevels } from "./levels";
import { HARD_FILTER, convictionScore, passesHardFilter } from "./rules-engine";
import type { Candle, MarketCues, TechnicalSnapshot, WatchlistEntry } from "./types";

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

export type FilterFunnel = Record<"scanned" | "aboveEma20" | "rsiInBand" | "volumeOk" | "passedAll", number>;

export function funnel(snaps: readonly TechnicalSnapshot[]): FilterFunnel {
  return {
    scanned: snaps.length,
    aboveEma20: snaps.filter((s) => s.current_price > s.ema20).length,
    rsiInBand: snaps.filter((s) => s.rsi14 >= HARD_FILTER.rsiMin && s.rsi14 <= HARD_FILTER.rsiMax).length,
    volumeOk: snaps.filter((s) => s.volume_ratio > HARD_FILTER.volumeRatioMin).length,
    passedAll: snaps.filter(passesHardFilter).length,
  };
}

// ── Backtest ────────────────────────────────────────────────────────────────

export type Outcome = "target" | "stop" | "timeout";

export interface Trade {
  symbol: string;
  signalDate: string;
  conviction: number;
  fill: number;
  exit: number;
  outcome: Outcome;
  returnPct: number;
  sessions: number;
}

/** Same-day macro term is identical for every stock, so ranking within a day ignores it. */
const NEUTRAL_MARKET: MarketCues = { regime: "Neutral", score: 0, indices: [], summary: "" };

interface SimLevels {
  entry_high: number;
  target_price: number;
  stop_loss: number;
}

/** One trade from a signal on candle i, or "nofill"/"open" when it can't be scored. */
function simulate(
  candles: Candle[],
  i: number,
  lv: SimLevels,
  horizon: number,
): { fill: number; exit: number; outcome: Outcome; sessions: number } | "nofill" | "open" {
  const j = i + 1;
  const fillBar = candles[j];
  if (!fillBar) return "open";
  let fill: number;
  if (fillBar.open <= lv.entry_high) fill = fillBar.open;
  else if (fillBar.low <= lv.entry_high) fill = lv.entry_high;
  else return "nofill";
  for (let k = j; k < Math.min(candles.length, j + horizon); k++) {
    const b = candles[k];
    if (!b) break;
    // Stop is checked before target within a session: the conservative assumption.
    if (b.low <= lv.stop_loss) {
      let exit = k > j && b.open < lv.stop_loss ? b.open : lv.stop_loss;
      if (k === j && fill <= lv.stop_loss) exit = fill;
      return { fill, exit, outcome: "stop", sessions: k - j + 1 };
    }
    if (b.high >= lv.target_price) {
      const exit = k > j && b.open > lv.target_price ? b.open : lv.target_price;
      return { fill, exit, outcome: "target", sessions: k - j + 1 };
    }
  }
  const last = candles[j + horizon - 1];
  if (!last) return "open"; // still running at the end of the data
  return { fill, exit: last.close, outcome: "timeout", sessions: horizon };
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
 *   - Entry next session: at the open if inside (or below) the buy zone, else
 *     at the top of the zone if the day trades down into it, else no fill.
 *   - Exit at the ATR target or stop (gaps fill at the open); otherwise at the
 *     close after `horizon` sessions.
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
    const lv = computeLevels(snap.current_price, snap.atr14);
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
        outcome: r.outcome,
        returnPct: ((r.exit - r.fill) / r.fill) * 100,
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
  breakEvenHitRatePct: number;
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
    // target +2.5 ATR vs stop −1.5 ATR → break-even when hit rate × 2.5 = (1 − hit rate) × 1.5
    breakEvenHitRatePct: 37.5,
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
  targetHits: number;
  stopHits: number;
  timeouts: number;
  /** Share of trades that reached the target. */
  hitRatePct: number;
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
    targetHits: trades.filter((t) => t.outcome === "target").length,
    stopHits: trades.filter((t) => t.outcome === "stop").length,
    timeouts: trades.filter((t) => t.outcome === "timeout").length,
    hitRatePct: n ? r2((trades.filter((t) => t.outcome === "target").length / n) * 100) : 0,
    winRatePct: n ? r2((wins.length / n) * 100) : 0,
    avgReturnPct: n ? r2(sum(rets) / n) : 0,
    medianReturnPct: n ? r2(rets[Math.floor(n / 2)] ?? 0) : 0,
    avgWinPct: wins.length ? r2(grossWin / wins.length) : 0,
    avgLossPct: losses.length ? r2(-grossLoss / losses.length) : 0,
    profitFactor: grossLoss ? r2(grossWin / grossLoss) : 0,
    avgSessionsHeld: n ? r2(sum(trades.map((t) => t.sessions)) / n) : 0,
  };
}
