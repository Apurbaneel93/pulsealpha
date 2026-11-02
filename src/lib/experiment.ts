/**
 * Strategy diagnostics on the same history the backtest uses.
 *
 * The backtest answers "did the plan make money?". This answers "why or why
 * not?" without leaning on stop/target tuning, which overfits on a few dozen
 * trades. Three views:
 *
 *   1. Raw forward returns (buy the next open, no stops) for the screen, each
 *      check on its own and each relaxation, measured against the same-day
 *      average stock ("excess"). If the screen has no excess return, no stop or
 *      target arrangement can create an edge.
 *   2. Bins of each indicator, to see whether the thresholds sit where the
 *      forward returns actually change.
 *   3. Stop/target/entry variants on the screen and on every stock-day.
 *
 * Every number is split into an earlier "train" period and a later "test"
 * period. Only a result that holds in both is worth acting on.
 */
import { WINDOW_SESSIONS, simulate, type SimLevels } from "./backtest";
import { LEVEL_MULTIPLIERS, computeLevels, roundToTick } from "./levels";
import { snapshotFromSeries } from "./market-data-pure";
import { checksFor } from "./rules-engine";
import { CHECK_KEYS } from "./types";
import type { Candle, CheckKey, TechnicalSnapshot, WatchlistEntry } from "./types";

export const FWD_HORIZONS = [1, 3, 5, 10] as const;
const H5 = 2; // index of the 5-session horizon in FWD_HORIZONS

interface Obs {
  symbol: string;
  date: string;
  candles: Candle[];
  i: number;
  snap: TechnicalSnapshot;
  checks: Record<CheckKey, boolean>;
  passedCount: number;
  passedAll: boolean;
  /** % return from the next open to the close h sessions after the signal; null when the data ends first. */
  fwd: Array<number | null>;
  /** `fwd` minus the average of all stocks on the same signal day. */
  excess: Array<number | null>;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function tStat(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return sd > 0 ? m / (sd / Math.sqrt(n)) : 0;
}

function collect(series: ReadonlyArray<{ entry: WatchlistEntry; candles: Candle[] }>): Obs[] {
  const all: Obs[] = [];
  for (const { entry, candles } of series) {
    for (let i = 60; i < candles.length - 1; i++) {
      const bar = candles[i];
      const next = candles[i + 1];
      if (!bar || !next) continue;
      const window = candles.slice(Math.max(0, i - WINDOW_SESSIONS + 1), i + 1);
      const snap = snapshotFromSeries(entry, { completed: window, last: bar.close, inProgress: false });
      if (!snap) continue;
      const checks = checksFor(snap);
      const passedCount = CHECK_KEYS.filter((k) => checks[k]).length;
      const fwd = FWD_HORIZONS.map((h) => {
        const exit = candles[i + h];
        return exit && next.open > 0 ? ((exit.close - next.open) / next.open) * 100 : null;
      });
      all.push({
        symbol: entry.symbol,
        date: bar.date.slice(0, 10),
        candles,
        i,
        snap,
        checks,
        passedCount,
        passedAll: passedCount === CHECK_KEYS.length,
        fwd,
        excess: fwd.map(() => null),
      });
    }
  }
  // Same-day average per horizon, so a falling or rising market doesn't read as skill.
  const byDay = new Map<string, Obs[]>();
  for (const o of all) byDay.set(o.date, [...(byDay.get(o.date) ?? []), o]);
  for (const list of byDay.values()) {
    FWD_HORIZONS.forEach((_, h) => {
      const vals = list.flatMap((o) => (o.fwd[h] == null ? [] : [o.fwd[h] as number]));
      if (vals.length < 10) return;
      const m = mean(vals);
      for (const o of list) o.excess[h] = o.fwd[h] == null ? null : (o.fwd[h] as number) - m;
    });
  }
  return all;
}

// ── 1 + 2: forward returns by group and by indicator bin ────────────────────

export interface GroupRow {
  name: string;
  n: number;
  /** Distinct signal days the group appears on. */
  days: number;
  /** Mean % return, next open → close h sessions later, minus the same-day average stock: 1, 3, 5, 10 sessions. */
  excess: number[];
  /** Mean raw % return at 5 sessions. */
  raw5: number;
  /** Share of raw 5-session returns above zero. */
  win5Pct: number;
  /** t-statistic of the 5-session excess (naive: overlapping windows overstate it). */
  t5: number;
  train5: number;
  test5: number;
}

function groupRow(name: string, obs: readonly Obs[], split: string): GroupRow {
  const ex = (h: number, list: readonly Obs[]) => list.flatMap((o) => (o.excess[h] == null ? [] : [o.excess[h] as number]));
  const raw5 = obs.flatMap((o) => (o.fwd[H5] == null ? [] : [o.fwd[H5] as number]));
  const train = obs.filter((o) => o.date < split);
  const test = obs.filter((o) => o.date >= split);
  return {
    name,
    n: obs.length,
    days: new Set(obs.map((o) => o.date)).size,
    excess: FWD_HORIZONS.map((_, h) => r2(mean(ex(h, obs)))),
    raw5: r2(mean(raw5)),
    win5Pct: raw5.length ? r2((raw5.filter((x) => x > 0).length / raw5.length) * 100) : 0,
    t5: r2(tStat(ex(H5, obs))),
    train5: r2(mean(ex(H5, train))),
    test5: r2(mean(ex(H5, test))),
  };
}

function binRows(label: string, obs: readonly Obs[], value: (o: Obs) => number, edges: readonly number[], split: string): GroupRow[] {
  const rows: GroupRow[] = [];
  for (let b = 0; b <= edges.length; b++) {
    const lo = b === 0 ? Number.NEGATIVE_INFINITY : (edges[b - 1] as number);
    const hi = b === edges.length ? Number.POSITIVE_INFINITY : (edges[b] as number);
    const name =
      b === 0 ? `${label} < ${hi}` : b === edges.length ? `${label} ≥ ${lo}` : `${label} ${lo} to <${hi}`;
    rows.push(groupRow(name, obs.filter((o) => value(o) >= lo && value(o) < hi), split));
  }
  return rows;
}

// ── 3: stop / target / entry variants ───────────────────────────────────────

export interface Variant {
  name: string;
  stop: number;
  t1: number;
  t2: number;
  /**
   *   zone — the card's rule: fill at the next open if inside the buy zone, else only if the day trades back into it.
   *   open — always buy the next open and measure the stop and targets from that fill.
   */
  entry: "zone" | "open";
}

export const VARIANTS: readonly Variant[] = [
  { name: "Current card (stop 0.9 · T1 1.15 · T2 2.0, buy-zone entry)", stop: 0.9, t1: 1.15, t2: 2.0, entry: "zone" },
  { name: "Same levels, buy the next open", stop: 0.9, t1: 1.15, t2: 2.0, entry: "open" },
  { name: "Stop 1.25 · T1 1.15 · T2 2.0, buy the open", stop: 1.25, t1: 1.15, t2: 2.0, entry: "open" },
  { name: "Stop 1.5 · T1 1.5 · T2 2.5, buy the open", stop: 1.5, t1: 1.5, t2: 2.5, entry: "open" },
  { name: "Stop 2.0 · T1 1.5 · T2 3.0, buy the open", stop: 2.0, t1: 1.5, t2: 3.0, entry: "open" },
  { name: "Stop 1.5 · T1 1.0 · T2 2.0, buy the open", stop: 1.5, t1: 1.0, t2: 2.0, entry: "open" },
];

function variantLevels(o: Obs, v: Variant): SimLevels {
  const atr = o.snap.atr14;
  if (v.entry === "open") {
    const fill = o.candles[o.i + 1]?.open ?? o.snap.current_price;
    return {
      entry_high: Number.POSITIVE_INFINITY,
      stop_loss: roundToTick(fill - v.stop * atr),
      target_1: roundToTick(fill + v.t1 * atr),
      target_2: roundToTick(fill + v.t2 * atr),
    };
  }
  const lv = computeLevels(o.snap.current_price, o.snap.prev_close, atr);
  return {
    entry_high: lv.entry_high,
    stop_loss: roundToTick(lv.base_entry - v.stop * atr),
    target_1: roundToTick(lv.base_entry + v.t1 * atr),
    target_2: roundToTick(lv.base_entry + v.t2 * atr),
  };
}

export interface PlanStats {
  trades: number;
  noFill: number;
  t1Pct: number;
  stopPct: number;
  avgReturnPct: number;
  profitFactor: number;
}

function planStats(obs: readonly Obs[], v: Variant, horizon: number): PlanStats {
  const rets: number[] = [];
  let t1 = 0;
  let stops = 0;
  let noFill = 0;
  for (const o of obs) {
    const r = simulate(o.candles, o.i, variantLevels(o, v), horizon);
    if (r === "open") continue;
    if (r === "nofill") {
      noFill++;
      continue;
    }
    rets.push(r.returnPct);
    if (r.reachedT1) t1++;
    if (r.outcome === "stop") stops++;
  }
  const win = rets.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const loss = Math.abs(rets.filter((x) => x <= 0).reduce((a, b) => a + b, 0));
  const n = rets.length;
  return {
    trades: n,
    noFill,
    t1Pct: n ? r2((t1 / n) * 100) : 0,
    stopPct: n ? r2((stops / n) * 100) : 0,
    avgReturnPct: r2(mean(rets)),
    profitFactor: loss ? r2(win / loss) : 0,
  };
}

export interface VariantRow {
  name: string;
  screen: { all: PlanStats; train: PlanStats; test: PlanStats };
  everyDay: { all: PlanStats; train: PlanStats; test: PlanStats };
}

// ── report ──────────────────────────────────────────────────────────────────

export interface ExperimentReport {
  period: { from: string; to: string; split: string };
  stockDays: number;
  screenSignals: number;
  signalDays: number;
  groups: GroupRow[];
  bins: Record<string, GroupRow[]>;
  variants: VariantRow[];
  notes: string[];
}

export function runExperiment(series: ReadonlyArray<{ entry: WatchlistEntry; candles: Candle[] }>, horizon = 10): ExperimentReport {
  const obs = collect(series);
  const dates = [...new Set(obs.map((o) => o.date))].sort();
  // The first 60% of signal days train; the rest test.
  const split = dates[Math.floor(dates.length * 0.6)] ?? "9999-12-31";
  const screen = obs.filter((o) => o.passedAll);

  const groups: GroupRow[] = [
    groupRow("Every stock-day", obs, split),
    groupRow("Passes all 6 (the screen)", screen, split),
    groupRow("Passes 5 of 6", obs.filter((o) => o.passedCount === 5), split),
    groupRow("Passes 4 or fewer", obs.filter((o) => o.passedCount <= 4), split),
  ];
  for (const k of CHECK_KEYS) {
    groups.push(groupRow(`Fails only "${k}"`, obs.filter((o) => o.passedCount === 5 && !o.checks[k]), split));
  }
  for (const k of CHECK_KEYS) {
    groups.push(groupRow(`Passes "${k}" (others ignored)`, obs.filter((o) => o.checks[k]), split));
    groups.push(groupRow(`Fails "${k}" (others ignored)`, obs.filter((o) => !o.checks[k]), split));
  }

  const bins: Record<string, GroupRow[]> = {
    rsi14: binRows("RSI", obs, (o) => o.snap.rsi14, [40, 52, 58, 65, 72], split),
    rvol: binRows("RVOL", obs, (o) => o.snap.volume_ratio, [0.7, 1.0, 1.5, 2.5], split),
    atrPct: binRows("ATR%", obs, (o) => o.snap.atr_pct, [1.5, 2.2, 3.0], split),
    coil: binRows("Coil", obs, (o) => o.snap.coil_ratio, [0.6, 0.9, 1.25], split),
    extension: binRows("Ext%", obs, (o) => o.snap.sma20_extension_pct, [-3, 0, 2, 4.5], split),
    sessionMoveAtr: binRows("Move(ATR)", obs, (o) => o.snap.opening_gap_atr, [-0.75, 0, 0.75], split),
  };

  const variants: VariantRow[] = VARIANTS.map((v) => {
    const part = (list: readonly Obs[]) => ({
      all: planStats(list, v, horizon),
      train: planStats(list.filter((o) => o.date < split), v, horizon),
      test: planStats(list.filter((o) => o.date >= split), v, horizon),
    });
    return { name: v.name, screen: part(screen), everyDay: part(obs) };
  });

  return {
    period: { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "", split },
    stockDays: obs.length,
    screenSignals: screen.length,
    signalDays: new Set(screen.map((o) => o.date)).size,
    groups,
    bins,
    variants,
    notes: [
      "Excess = a stock's return from the next open to the close h sessions later, minus the average of all stocks for the same signal day. It strips out market direction.",
      "Train = signal days before the split date, test = from the split date on. Trust only what holds in both.",
      "t5 is naive: 5-session windows overlap and stocks move together, so the true t is lower. |t| below ~2 is noise.",
      `Break-even note: with stop ${LEVEL_MULTIPLIERS.stop} and T1 ${LEVEL_MULTIPLIERS.target1} ATR, a plan with no edge cannot make money after costs; stops and targets only reshape returns.`,
    ],
  };
}
