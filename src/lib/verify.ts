import "server-only";
import { mapSettled } from "./async";
import { funnel, liveSnapshot, runBacktest, type BacktestReport, type FilterFunnel } from "./backtest";
import { fetchDailyCandles } from "./market-data";
import { formatDetectedAt } from "./time";
import { WATCHLIST } from "./watchlist";
import type { Candle, TechnicalSnapshot, WatchlistEntry } from "./types";

/** ~380 calendar days ≈ 250 sessions: 60 warm-up sessions + ~9 months of replay. */
const HISTORY_DAYS = 380;
const CHECK_SYMBOLS = ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS"] as const;

export interface VerifyReport {
  generated_at: string;
  generated_at_iso: string;
  universe: number;
  loaded: number;
  failed: string[];
  /** How today's watchlist falls through the hard filter. */
  todayFunnel: FilterFunnel;
  /** Raw recent sessions + computed indicators, to cross-check against any charting site. */
  dataCheck: Array<{
    symbol: string;
    lastSessions: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
    computed: Pick<TechnicalSnapshot, "current_price" | "ema20" | "ema50" | "rsi14" | "atr14" | "volume_ratio"> | null;
  }>;
  backtest: BacktestReport;
  assumptions: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function buildVerifyReport(now = new Date()): Promise<VerifyReport> {
  const settled = await mapSettled(WATCHLIST, 6, async (entry: WatchlistEntry) => {
    const { candles, result } = await fetchDailyCandles(entry.yahoo, HISTORY_DAYS, now);
    return { entry, candles, regular: result.meta.currentTradingPeriod?.regular, metaPrice: result.meta.regularMarketPrice };
  });
  const loaded: Array<{ entry: WatchlistEntry; candles: Candle[]; snapshot: TechnicalSnapshot | null }> = [];
  const failed: string[] = [];
  settled.forEach((r, i) => {
    const sym = WATCHLIST[i]?.symbol ?? "?";
    if (r.status === "rejected") return void failed.push(sym);
    if (r.value.candles.length < 80) return void failed.push(sym);
    const { entry, candles, regular, metaPrice } = r.value;
    loaded.push({ entry, candles, snapshot: liveSnapshot(entry, candles, regular, metaPrice, now) });
  });
  if (loaded.length < WATCHLIST.length * 0.35) {
    // Thrown, so a failed run is never cached.
    throw new Error(`Only ${loaded.length}/${WATCHLIST.length} symbols loaded from Yahoo Finance`);
  }

  const snapshots = loaded.flatMap((l) => (l.snapshot ? [l.snapshot] : []));
  const dataCheck = CHECK_SYMBOLS.flatMap((symbol) => {
    const l = loaded.find((x) => x.entry.symbol === symbol);
    if (!l) return [];
    const s = l.snapshot;
    return [
      {
        symbol,
        lastSessions: l.candles.slice(-3).map((c) => ({
          date: c.date.slice(0, 10),
          open: r2(c.open),
          high: r2(c.high),
          low: r2(c.low),
          close: r2(c.close),
          volume: c.volume,
        })),
        computed: s
          ? { current_price: s.current_price, ema20: s.ema20, ema50: s.ema50, rsi14: s.rsi14, atr14: s.atr14, volume_ratio: s.volume_ratio }
          : null,
      },
    ];
  });

  return {
    generated_at: formatDetectedAt(now),
    generated_at_iso: now.toISOString(),
    universe: WATCHLIST.length,
    loaded: loaded.length,
    failed,
    todayFunnel: funnel(snapshots),
    dataCheck,
    backtest: runBacktest(loaded.map(({ entry, candles }) => ({ entry, candles }))),
    assumptions: [
      "Signals use only data available at that day's close, with the app's own indicators, filter and ATR levels.",
      "Entry is the next session's open if it is at or below the top of the buy zone; otherwise the top of the zone if that session trades down to it; otherwise no trade.",
      "Exit at target (+2.5 ATR) or stop-loss (−1.5 ATR); gaps fill at the open; if both are touched in one session the stop is assumed first.",
      "Trades still open after the horizon exit at that session's close (counted as timeouts).",
      "Top picks = the app's board: top 2 per day by conviction, plus a third scoring ≥ 50. The macro term is identical across stocks on a day, so it is left out of the ranking here.",
      "Brokerage, taxes and slippage are not deducted (roughly 0.2–0.3% per round trip for delivery trades).",
      "Today's watchlist is used for the whole period, which favours stocks that stayed in the Nifty 200 (survivorship bias).",
    ],
  };
}
