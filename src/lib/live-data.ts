import "server-only";
import { unstable_cache } from "next/cache";
import { errorMessage, isRateLimitError, mapSettled } from "./async";
import {
  DAILY_FETCH_DAYS,
  buildDailyPayload,
  buildIntradayPayload,
  quoteFromSeries,
  yahooSymbolFor,
} from "./live-pure";
import { fetchDailyCandles, fetchIntradayBars } from "./market-data";
import { seriesFromCandles } from "./market-data-pure";
import type { ChartPayload, ChartRange, LiveQuote, QuotesResponse } from "./types";

/**
 * Live prices and charts, cached on the server with `unstable_cache` (the same
 * platform cache the scan uses), so any number of viewers cost Yahoo about one
 * request per symbol per window:
 *
 *   quotes      15 s   daily bars + chart meta → price, official previous close
 *   1D chart    15 s   1-minute bars
 *   5D chart   120 s   5-minute bars
 *   1M–1Y      180 s   daily closes (+ EMA 20/50)
 *
 * Failures throw inside the cached function and are never cached. An entry
 * older than its max age is reloaded in the foreground instead of being served
 * stale, so the first viewer after a quiet spell never sees old prices.
 */

export const QUOTE_REVALIDATE_SECONDS = 15;
const QUOTE_MAX_AGE_MS = 45_000;
const BACKOFF_MS = 60_000;
const TAGS = ["pulsealpha:live"];

let backoffUntil = 0;
function noteFailure(err: unknown): void {
  if (isRateLimitError(err)) backoffUntil = Date.now() + BACKOFF_MS;
}

async function loadQuote(yahoo: string): Promise<LiveQuote> {
  const now = new Date();
  const { candles, result } = await fetchDailyCandles(yahoo, 14, now);
  const series = seriesFromCandles(candles, result.meta.currentTradingPeriod?.regular, result.meta.regularMarketPrice, now);
  const quote = quoteFromSeries(series, candles[candles.length - 1], result.meta.regularMarketTime, now);
  if (!quote) throw new Error(`${yahoo}: not enough sessions for a quote`);
  return quote;
}

interface Bars {
  bars: Array<[number, number]>;
  fetched_at_iso: string;
}

const loadBars = (interval: "1m" | "5m", days: number) => async (yahoo: string): Promise<Bars> => {
  const now = new Date();
  return { bars: await fetchIntradayBars(yahoo, interval, days, now), fetched_at_iso: now.toISOString() };
};
// 1-minute data reaches back 7 days; 6 covers a long weekend plus a holiday.
const load1m = loadBars("1m", 6);
const load5m = loadBars("5m", 9);

async function loadDaily(yahoo: string): Promise<Bars> {
  const now = new Date();
  const { candles } = await fetchDailyCandles(yahoo, DAILY_FETCH_DAYS, now);
  return { bars: candles.map((c) => [Date.parse(c.date), c.close] as [number, number]), fetched_at_iso: now.toISOString() };
}

const cachedQuote = unstable_cache(loadQuote, ["pulsealpha:quote:v1"], { revalidate: QUOTE_REVALIDATE_SECONDS, tags: TAGS });
const cached1m = unstable_cache(load1m, ["pulsealpha:bars-1m:v1"], { revalidate: QUOTE_REVALIDATE_SECONDS, tags: TAGS });
const cached5m = unstable_cache(load5m, ["pulsealpha:bars-5m:v1"], { revalidate: 120, tags: TAGS });
const cachedDaily = unstable_cache(loadDaily, ["pulsealpha:bars-daily:v1"], { revalidate: 180, tags: TAGS });

async function freshOrReload<T extends { fetched_at_iso: string }>(
  cached: () => Promise<T>,
  reload: () => Promise<T>,
  maxAgeMs: number,
): Promise<T> {
  const value = await cached();
  return Date.now() - Date.parse(value.fetched_at_iso) > maxAgeMs ? reload() : value;
}

export class UnknownSymbolError extends Error {}

function yahooOrThrow(symbol: string): string {
  const y = yahooSymbolFor(symbol);
  if (!y) throw new UnknownSymbolError(`Unknown symbol: ${symbol}`);
  return y;
}

export async function getQuote(symbol: string): Promise<LiveQuote> {
  const yahoo = yahooOrThrow(symbol);
  return freshOrReload(() => cachedQuote(yahoo), () => loadQuote(yahoo), QUOTE_MAX_AGE_MS);
}

/** Latest quotes for several symbols. One bad symbol never fails the rest. */
export async function getQuotes(symbols: readonly string[]): Promise<QuotesResponse> {
  const quotes: Record<string, LiveQuote> = {};
  const missing: string[] = [];
  if (Date.now() < backoffUntil) return { as_of_iso: new Date().toISOString(), quotes, missing: [...symbols] };
  const settled = await mapSettled(symbols, 6, (s) => getQuote(s));
  settled.forEach((r, i) => {
    const symbol = symbols[i] as string;
    if (r.status === "fulfilled") quotes[symbol] = r.value;
    else {
      missing.push(symbol);
      noteFailure(r.reason);
      if (!isRateLimitError(r.reason)) console.error(`[PulseAlpha] quote ${symbol} failed:`, errorMessage(r.reason));
    }
  });
  return { as_of_iso: new Date().toISOString(), quotes, missing };
}

export async function getChart(symbol: string, range: ChartRange): Promise<ChartPayload> {
  const yahoo = yahooOrThrow(symbol);
  const now = new Date();
  try {
    if (range === "1d" || range === "5d") {
      const one = range === "1d";
      const { bars } = await freshOrReload(
        () => (one ? cached1m(yahoo) : cached5m(yahoo)),
        () => (one ? load1m(yahoo) : load5m(yahoo)),
        one ? 60_000 : 10 * 60_000,
      );
      // The official previous close comes from the quote cache; a missing one only hides the dashed reference line.
      const previousClose = one ? await getQuote(symbol).then((q) => q.prev_close).catch(() => null) : null;
      return buildIntradayPayload({ symbol, range, bars, previousClose, now });
    }
    const { bars } = await freshOrReload(() => cachedDaily(yahoo), () => loadDaily(yahoo), 15 * 60_000);
    return buildDailyPayload({ symbol, range, closes: bars, now });
  } catch (err: unknown) {
    noteFailure(err);
    throw err;
  }
}
