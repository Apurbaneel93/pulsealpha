/**
 * Network-free pieces of the live-price and chart features: range specs,
 * payload builders, quote maths and the buy-zone status. Shared by the server
 * loaders, the UI and the tests.
 */
import { emaSeries } from "./indicators";
import { pctChange } from "./indicators";
import { round2 } from "./levels";
import type { Series } from "./market-data-pure";
import { istDateKey } from "./time";
import { WATCHLIST } from "./watchlist";
import type { Candle, ChartPayload, ChartRange, LiveQuote, PriceLevels } from "./types";

export const CHART_RANGES: readonly ChartRange[] = ["1d", "5d", "1m", "3m", "6m", "1y"];

export const RANGE_LABELS: Record<ChartRange, string> = {
  "1d": "1D",
  "5d": "5D",
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
  "1y": "1Y",
};

/** Trading sessions shown for each daily range. */
export const DAILY_SESSIONS: Record<"1m" | "3m" | "6m" | "1y", number> = { "1m": 22, "3m": 63, "6m": 126, "1y": 250 };

/** Calendar days of daily history to fetch: 250 sessions plus an EMA-50 warm-up. */
export const DAILY_FETCH_DAYS = 470;

export const isChartRange = (v: unknown): v is ChartRange => typeof v === "string" && (CHART_RANGES as readonly string[]).includes(v);

// ── Symbols ─────────────────────────────────────────────────────────────────

const INDEX_SYMBOLS = ["^NSEI", "^GSPC", "^IXIC"] as const;
const YAHOO_BY_SYMBOL: ReadonlyMap<string, string> = new Map<string, string>([
  ...WATCHLIST.map((w) => [w.symbol, w.yahoo] as const),
  ...INDEX_SYMBOLS.map((s) => [s, s] as const),
]);

/** Yahoo symbol for an app symbol, or null for anything not on the watchlist (so the API can't be used as an open proxy). */
export function yahooSymbolFor(symbol: string): string | null {
  return YAHOO_BY_SYMBOL.get(symbol) ?? null;
}

export const MAX_QUOTE_SYMBOLS = 30;

// ── Sessions ────────────────────────────────────────────────────────────────

/** NSE regular session for an IST date key ("2026-11-02"): 09:15–15:30 IST, as epoch seconds. */
export function sessionWindow(dayKey: string): { start: number; end: number } {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  const start = Date.UTC(y, m - 1, d, 9, 15) / 1000 - 19_800;
  return { start, end: start + 6.25 * 3600 };
}

/** Keep the bars of the last `sessions` IST trading days. `bars` are [epoch ms, close], oldest first. */
export function lastSessionsBars(bars: ReadonlyArray<readonly [number, number]>, sessions: number): Array<[number, number]> {
  const keys: string[] = [];
  const keyOf = new Map<number, string>();
  for (const [t] of bars) {
    const k = istDateKey(new Date(t));
    keyOf.set(t, k);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  const keep = new Set(keys.slice(-sessions));
  const out: Array<[number, number]> = [];
  for (const [t, c] of bars) {
    if (Number.isFinite(c) && c > 0 && keep.has(keyOf.get(t) ?? "")) out.push([Math.floor(t / 1000), round2(c)]);
  }
  return out;
}

export function buildIntradayPayload(args: {
  symbol: string;
  range: "1d" | "5d";
  bars: ReadonlyArray<readonly [number, number]>;
  previousClose: number | null;
  now: Date;
}): ChartPayload {
  const { symbol, range, bars, previousClose, now } = args;
  const points = lastSessionsBars(bars, range === "1d" ? 1 : 5);
  const lastT = points[points.length - 1]?.[0];
  return {
    symbol,
    range,
    interval: range === "1d" ? "1m" : "5m",
    points,
    ema20: null,
    ema50: null,
    previous_close: range === "1d" && previousClose != null ? round2(previousClose) : null,
    session: range === "1d" && lastT != null ? sessionWindow(istDateKey(new Date(lastT * 1000))) : null,
    fetched_at_iso: now.toISOString(),
  };
}

/** Daily closes for 1M–1Y with EMA-20/50 computed on the full history, then sliced so the lines are already warm at the left edge. */
export function buildDailyPayload(args: {
  symbol: string;
  range: "1m" | "3m" | "6m" | "1y";
  closes: ReadonlyArray<readonly [number, number]>;
  now: Date;
}): ChartPayload {
  const { symbol, range, closes, now } = args;
  const values = closes.map(([, c]) => c);
  const align = (period: number): Array<number | null> => {
    const s = emaSeries(values, period);
    const pad = values.length - s.length;
    return values.map((_, i) => (i < pad ? null : round2(s[i - pad] ?? 0)));
  };
  const e20 = align(20);
  const e50 = align(50);
  const n = Math.min(DAILY_SESSIONS[range], closes.length);
  const from = closes.length - n;
  return {
    symbol,
    range,
    interval: "1d",
    points: closes.slice(from).map(([t, c]) => [Math.floor(t / 1000), round2(c)] as [number, number]),
    ema20: e20.slice(from),
    ema50: e50.slice(from),
    previous_close: null,
    session: null,
    fetched_at_iso: now.toISOString(),
  };
}

// ── Quotes ──────────────────────────────────────────────────────────────────

/**
 * One live quote from daily candles plus the chart meta. While the session is
 * open the last daily bar is still forming, so the price is the live price and
 * the previous close is the last completed session; otherwise it is the last
 * completed session against the one before — what a broker shows after the bell.
 */
export function quoteFromSeries(series: Series, forming: Candle | undefined, marketTime: Date, now: Date): LiveQuote | null {
  const lastDone = series.completed[series.completed.length - 1];
  const beforeLast = series.completed[series.completed.length - 2];
  if (!lastDone || !beforeLast) return null;
  const price = series.inProgress ? series.last : lastDone.close;
  const prev = series.inProgress ? lastDone.close : beforeLast.close;
  const bar = series.inProgress ? forming : lastDone;
  const stamp = Number.isFinite(marketTime.getTime()) ? marketTime : now;
  return {
    price: round2(price),
    prev_close: round2(prev),
    change_pct: round2(pctChange(prev, price)),
    day_high: bar ? round2(Math.max(bar.high, price)) : null,
    day_low: bar ? round2(Math.min(bar.low, price)) : null,
    market_time_iso: stamp.toISOString(),
    fetched_at_iso: now.toISOString(),
  };
}

/** Seconds the exchange timestamp trails `now`. */
export const quoteLagSeconds = (q: LiveQuote, now: Date): number =>
  Math.max(0, Math.round((now.getTime() - Date.parse(q.market_time_iso)) / 1000));

// ── Price against the trade plan ────────────────────────────────────────────

export type PlanKind = "target" | "stop" | "in_zone" | "above" | "below";

export interface PlanStatus {
  kind: PlanKind;
  label: string;
  tone: "bull" | "bear" | "neutral" | "caution";
}

/** Where the live price sits relative to the pick's buy zone, target and stop-loss. */
export function planStatus(price: number, levels: Pick<PriceLevels, "entry_low" | "entry_high" | "target_price" | "stop_loss">): PlanStatus {
  if (price >= levels.target_price) return { kind: "target", label: "Target reached", tone: "bull" };
  if (price <= levels.stop_loss) return { kind: "stop", label: "Below stop-loss", tone: "bear" };
  // Within 0.05% of an edge still counts as inside: "0.0% above" would read as a contradiction.
  const above = (price / levels.entry_high - 1) * 100;
  if (above >= 0.05) return { kind: "above", label: `${above.toFixed(1)}% above buy zone`, tone: "caution" };
  const below = (1 - price / levels.entry_low) * 100;
  if (below >= 0.05) return { kind: "below", label: `${below.toFixed(1)}% below buy zone`, tone: "neutral" };
  return { kind: "in_zone", label: "In buy zone", tone: "bull" };
}

// ── Chart geometry ──────────────────────────────────────────────────────────

/** Round, human-friendly tick values spanning [min, max]. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const rawStep = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}
