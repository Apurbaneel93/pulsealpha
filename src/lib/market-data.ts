import "server-only";
import YahooFinance from "yahoo-finance2";
import type { ChartResultArray } from "yahoo-finance2/modules/chart";
import { mapSettled, errorMessage, isRateLimitError } from "./async";
import {
  INDEX_DEFS,
  LOOKBACK_DAYS,
  classifyRegime,
  indexCueFromSeries,
  seriesFromCandles,
  snapshotFromSeries,
  type Series,
} from "./market-data-pure";
import type { Candle, IndexCue, MarketCues, TechnicalSnapshot, WatchlistEntry } from "./types";

export { classifyRegime, snapshotFromSeries };

const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  queue: { concurrency: 6 },
  validation: { logErrors: false },
});

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { at: number; value: Series }>();

function toCandles(result: ChartResultArray): Candle[] {
  const out: Candle[] = [];
  for (const q of result.quotes) {
    if (q.open == null || q.high == null || q.low == null || q.close == null) continue;
    if (![q.open, q.high, q.low, q.close].every(Number.isFinite)) continue;
    out.push({
      date: q.date.toISOString(),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume ?? 0,
    });
  }
  return out;
}

/** Daily candles for one Yahoo symbol over the last `days` calendar days (nulls dropped). */
export async function fetchDailyCandles(
  yahooSymbol: string,
  days: number,
  now = new Date(),
): Promise<{ candles: Candle[]; result: ChartResultArray }> {
  const result = await yf.chart(yahooSymbol, {
    period1: new Date(now.getTime() - days * 86_400_000),
    interval: "1d",
    return: "array",
  });
  return { candles: toCandles(result), result };
}

export async function fetchSeries(yahooSymbol: string, now = new Date()): Promise<Series> {
  const hit = cache.get(yahooSymbol);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return hit.value;

  const { candles, result } = await fetchDailyCandles(yahooSymbol, LOOKBACK_DAYS, now);
  if (candles.length < 60) throw new Error(`${yahooSymbol}: only ${candles.length} sessions returned`);
  const value = seriesFromCandles(candles, result.meta.currentTradingPeriod?.regular, result.meta.regularMarketPrice, now);
  cache.set(yahooSymbol, { at: now.getTime(), value });
  return value;
}

export interface UniverseScan {
  snapshots: TechnicalSnapshot[];
  attempted: number;
  failed: number;
  rateLimited: boolean;
}

export async function scanUniverse(entries: readonly WatchlistEntry[], now = new Date()): Promise<UniverseScan> {
  const settled = await mapSettled(entries, 8, async (entry) => {
    const series = await fetchSeries(entry.yahoo, now);
    return snapshotFromSeries(entry, series);
  });
  const snapshots: TechnicalSnapshot[] = [];
  let failed = 0;
  let rateLimited = false;
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) snapshots.push(r.value);
    else {
      failed++;
      if (r.status === "rejected" && isRateLimitError(r.reason)) rateLimited = true;
    }
  }
  return { snapshots, attempted: entries.length, failed, rateLimited };
}

export async function fetchMarketCues(now = new Date()): Promise<MarketCues> {
  const settled = await mapSettled(INDEX_DEFS, 3, async (def): Promise<IndexCue> => {
    const cue = indexCueFromSeries(def, await fetchSeries(def.symbol, now), now);
    if (!cue) throw new Error(`${def.symbol}: insufficient history`);
    return cue;
  });
  const indices: IndexCue[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") indices.push(r.value);
    else errors.push(errorMessage(r.reason));
  }
  if (indices.length === 0) throw new Error(`index data unavailable: ${[...new Set(errors)].join("; ")}`);
  return classifyRegime(indices);
}

