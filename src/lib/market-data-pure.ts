/**
 * Pure (network-free) pieces of the market-data pipeline, shared by the live
 * Yahoo path, demo mode and tests.
 */
import { atr, ema, pctChange, rsi, sma, volumeRatio } from "./indicators";
import { openingGapAtr, round2 } from "./levels";
import { istDateKey } from "./time";
import type { Candle, IndexCue, MarketCues, Regime, TechnicalSnapshot, WatchlistEntry } from "./types";

export interface Series {
  /** Completed daily sessions only — an in-progress bar is removed. */
  completed: Candle[];
  /** Live/last traded price. */
  last: number;
  /** True when the exchange session is open and the last bar was in-progress. */
  inProgress: boolean;
  /**
   * True when Yahoo shows a trade on a later day than the newest completed bar
   * while the market is closed: the latest session is missing from `completed`,
   * so every indicator is one session old.
   */
  behind?: boolean;
}

/** One raw daily bar as Yahoo returns it: any field can be null. */
export interface RawBar {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

/** Daily bars are stamped at the 09:15 IST open; the regular session ends 6h15m later. */
const SESSION_MS = 6.25 * 3_600_000;
/** The last trade must be at least this long after the open to count as the day's close (≥ 15:15 IST). */
const LATE_TRADE_MS = 6 * 3_600_000;

/**
 * Yahoo can leave the newest daily bar's close null for hours after the bell
 * (the bar has its open, high, low and volume, but no close). Dropping it
 * would make every indicator a full session old, so the bar's close is taken
 * from the last traded price when that price is trustworthy: same IST day,
 * inside the bar's own high–low range, and (once the session is over) stamped
 * in the closing minutes. While the session is open the bar is still forming
 * and `seriesFromCandles` excludes it from indicators anyway.
 */
function closeFromLastTrade(bar: RawBar, low: number, high: number, price: number, time: Date | undefined): number | null {
  if (!Number.isFinite(price) || price <= 0 || !time || !Number.isFinite(time.getTime())) return null;
  if (istDateKey(time) !== istDateKey(bar.date)) return null;
  if (price < low * 0.995 || price > high * 1.005) return null;
  return price;
}

/**
 * Clean raw bars into candles. Bars with a missing field are dropped, except
 * the newest bar's missing close, which `closeFromLastTrade` may supply.
 */
export function candlesFromBars(
  bars: readonly RawBar[],
  meta: { price: number; time: Date | undefined },
  now: Date,
): Candle[] {
  const out: Candle[] = [];
  bars.forEach((q, idx) => {
    let close = q.close;
    if (close == null && idx === bars.length - 1 && q.open != null && q.high != null && q.low != null) {
      const sessionOver = now.getTime() >= q.date.getTime() + SESSION_MS;
      const late = meta.time !== undefined && meta.time.getTime() >= q.date.getTime() + LATE_TRADE_MS;
      if (!sessionOver || late) close = closeFromLastTrade(q, q.low, q.high, meta.price, meta.time);
    }
    if (q.open == null || q.high == null || q.low == null || close == null) return;
    if (![q.open, q.high, q.low, close].every(Number.isFinite)) return;
    out.push({
      date: q.date.toISOString(),
      open: q.open,
      high: q.high,
      low: q.low,
      close,
      volume: q.volume ?? 0,
    });
  });
  return out;
}

/** ~200 calendar days ≈ 135 sessions: enough for a well-converged 50-EMA. */
export const LOOKBACK_DAYS = 200;

export const INDEX_DEFS: ReadonlyArray<Pick<IndexCue, "symbol" | "label">> = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "Nasdaq" },
  { symbol: "^NSEI", label: "Nifty 50" },
];

/**
 * Split a daily series into completed sessions + the live price. Yahoo stamps
 * a daily bar with its session open, so a bar stamped inside today's open
 * session window is still forming and is excluded from indicators.
 */
export function seriesFromCandles(
  candles: Candle[],
  regular: { start: Date; end: Date } | undefined,
  metaPrice: number,
  now: Date,
  /** When the exchange stamped the last trade; lets the series notice a missing session. */
  marketTime?: Date,
): Series {
  const lastBar = candles[candles.length - 1];
  const sessionOpen =
    regular !== undefined && now.getTime() >= regular.start.getTime() && now.getTime() < regular.end.getTime();
  const inProgress =
    sessionOpen && lastBar !== undefined && new Date(lastBar.date).getTime() >= regular.start.getTime() - 6 * 3_600_000;
  const completed = inProgress ? candles.slice(0, -1) : candles;
  const last = Number.isFinite(metaPrice) && metaPrice > 0 ? metaPrice : (lastBar?.close ?? 0);
  const lastDone = completed[completed.length - 1];
  const behind =
    !sessionOpen &&
    lastDone !== undefined &&
    marketTime !== undefined &&
    Number.isFinite(marketTime.getTime()) &&
    istDateKey(marketTime) > istDateKey(new Date(lastDone.date));
  return { completed, last, inProgress, behind };
}

/** Last-session move of an index and whether it sits above its 20-EMA. */
export function indexCueFromSeries(
  def: Pick<IndexCue, "symbol" | "label">,
  s: Series,
  now: Date,
): IndexCue | null {
  const closes = s.completed.map((c) => c.close);
  const lastCompleted = s.completed[s.completed.length - 1];
  const beforeLast = s.completed[s.completed.length - 2];
  const e20 = ema(closes, 20);
  if (!lastCompleted || !beforeLast || e20 == null) return null;
  const current = s.inProgress ? s.last : lastCompleted.close;
  const prev = s.inProgress ? lastCompleted.close : beforeLast.close;
  return {
    ...def,
    last: round2(current),
    changePct: round2(pctChange(prev, current)),
    aboveEma20: current > e20,
    sessionDate: s.inProgress ? now.toISOString() : lastCompleted.date,
  };
}

/** Build the deterministic indicator snapshot from completed sessions. */
export function snapshotFromSeries(entry: WatchlistEntry, series: Series): TechnicalSnapshot | null {
  const { completed, last, inProgress } = series;
  const closes = completed.map((c) => c.close);
  const volumes = completed.map((c) => c.volume);
  const sma20 = sma(closes, 20);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(completed, 14);
  const vol = volumeRatio(volumes, 20);
  const lastCompleted = completed[completed.length - 1];
  const beforeLast = completed[completed.length - 2];
  if (sma20 == null || ema20 == null || ema50 == null || rsi14 == null || atr14 == null || atr14 <= 0 || !vol || !lastCompleted || !beforeLast) {
    return null;
  }
  const currentPrice = inProgress ? last : lastCompleted.close;
  const prevClose = inProgress ? lastCompleted.close : beforeLast.close;
  return {
    symbol: entry.symbol,
    name: entry.name,
    sector: entry.sector,
    current_price: round2(currentPrice),
    prev_close: round2(prevClose),
    day_change_pct: round2(pctChange(prevClose, currentPrice)),
    sma20: round2(sma20),
    ema20: round2(ema20),
    ema50: round2(ema50),
    rsi14: round2(rsi14),
    atr14: round2(atr14),
    // Ratios use the unrounded ATR and price, so they match a hand calculation.
    atr_pct: round2((atr14 / currentPrice) * 100),
    // "Yesterday" is the last completed session: the range it printed vs. a normal day.
    coil_ratio: round2((lastCompleted.high - lastCompleted.low) / atr14),
    sma20_extension_pct: round2(((currentPrice - sma20) / sma20) * 100),
    opening_gap_atr: round2(openingGapAtr(currentPrice, prevClose, atr14)),
    volume_ratio: round2(vol.ratio),
    latest_volume: Math.round(vol.latest),
    avg_volume20: Math.round(vol.average),
    as_of_session: lastCompleted.date,
    spark: [...closes.slice(-30), ...(inProgress ? [currentPrice] : [])].map(round2),
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Deterministic regime model.
 *   US leg    : average overnight S&P/Nasdaq move, ±0.5% saturates at ±1
 *   Nifty leg : last Nifty move, ±0.5% saturates at ±1
 *   Trend leg : Nifty above its 20-EMA → +0.5, below → −0.5
 * Score ≥ 1 → Bullish, ≤ −1 → Bearish, otherwise Neutral.
 */
export function classifyRegime(indices: IndexCue[]): MarketCues {
  const find = (s: IndexCue["symbol"]) => indices.find((i) => i.symbol === s);
  const spx = find("^GSPC");
  const ndx = find("^IXIC");
  const nifty = find("^NSEI");
  const us = [spx, ndx].filter((x): x is IndexCue => x !== undefined);
  const usAvg = us.length ? us.reduce((a, b) => a + b.changePct, 0) / us.length : 0;
  const usLeg = us.length ? clamp(usAvg / 0.5, -1, 1) : 0;
  const niftyLeg = nifty ? clamp(nifty.changePct / 0.5, -1, 1) : 0;
  const trendLeg = nifty ? (nifty.aboveEma20 ? 0.5 : -0.5) : 0;
  const score = round2(usLeg + niftyLeg + trendLeg);
  const regime: Regime = score >= 1 ? "Bullish" : score <= -1 ? "Bearish" : "Neutral";
  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  const bits = indices.map((i) => `${i.label} ${fmt(i.changePct)}`);
  return { regime, score, indices, summary: `${regime}: ${bits.join(", ")}` };
}
