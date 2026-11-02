import "server-only";
import { mapSettled } from "./async";
import { funnel, liveSnapshot, runBacktest, type BacktestReport, type FilterFunnel } from "./backtest";
import { runExperiment, type ExperimentReport } from "./experiment";
import { fetchDailyCandles } from "./market-data";
import { formatDetectedAt, istDateKey } from "./time";
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
  /** Is the data current? `behind` lists stocks Yahoo has traded since the newest candle we hold. */
  freshness: { latest_session: string; behind: string[] };
  /** How many of today's watchlist stocks pass each check, and all six. */
  todayFunnel: FilterFunnel;
  /** Raw recent sessions + computed indicators, to cross-check against any charting site. */
  dataCheck: Array<{
    symbol: string;
    lastSessions: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
    computed: Pick<TechnicalSnapshot, "current_price" | "sma20" | "rsi14" | "atr14" | "atr_pct" | "coil_ratio" | "sma20_extension_pct" | "volume_ratio"> | null;
  }>;
  backtest: BacktestReport;
  assumptions: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function buildVerifyReport(now = new Date()): Promise<VerifyReport> {
  const settled = await mapSettled(WATCHLIST, 6, async (entry: WatchlistEntry) => {
    const { candles, result } = await fetchDailyCandles(entry.yahoo, HISTORY_DAYS, now);
    return {
      entry,
      candles,
      regular: result.meta.currentTradingPeriod?.regular,
      metaPrice: result.meta.regularMarketPrice,
      marketTime: result.meta.regularMarketTime,
    };
  });
  const loaded: Array<{ entry: WatchlistEntry; candles: Candle[]; snapshot: TechnicalSnapshot | null }> = [];
  const failed: string[] = [];
  const behind: string[] = [];
  let latestSession = "";
  settled.forEach((r, i) => {
    const sym = WATCHLIST[i]?.symbol ?? "?";
    if (r.status === "rejected") return void failed.push(sym);
    if (r.value.candles.length < 80) return void failed.push(sym);
    const { entry, candles, regular, metaPrice, marketTime } = r.value;
    const lastDate = candles[candles.length - 1]?.date.slice(0, 10) ?? "";
    if (lastDate > latestSession) latestSession = lastDate;
    if (lastDate && marketTime && istDateKey(marketTime) > lastDate) behind.push(entry.symbol);
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
          ? {
              current_price: s.current_price,
              sma20: s.sma20,
              rsi14: s.rsi14,
              atr14: s.atr14,
              atr_pct: s.atr_pct,
              coil_ratio: s.coil_ratio,
              sma20_extension_pct: s.sma20_extension_pct,
              volume_ratio: s.volume_ratio,
            }
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
    freshness: { latest_session: latestSession, behind },
    todayFunnel: funnel(snapshots),
    dataCheck,
    backtest: runBacktest(loaded.map(({ entry, candles }) => ({ entry, candles }))),
    assumptions: [
      "Signals use only data available at that day's close, with the app's own indicators, filter and ATR levels.",
      "Entry is the next session's open if it is at or below the top of the buy zone; otherwise the top of the zone if that session trades down to it; otherwise no trade.",
      "Levels follow the card: buy zone ±0.10 ATR, stop −0.90 ATR, Target 1 +1.15 ATR, Target 2 +2.00 ATR. A stock that closed more than 0.75 ATR above its previous close is planned as a pullback entry (previous close + 0.35 ATR), so it often never fills.",
      "Exits: 60% is sold at Target 1 and the stop moves to breakeven; the other 40% is sold at Target 2 or at breakeven. Returns are blended across both parts.",
      "Daily bars hide the order of events inside a session, so ties go against the trade: the stop is assumed to hit before Target 1; the breakeven stop applies from the session after Target 1; gaps fill at the open. Intraday trailing (the 15-minute 9-EMA) cannot be replayed on daily data.",
      "Trades still open after the horizon exit at that session's close (counted as timeouts).",
      "Top picks = the app's board: top 2 per day by conviction, plus a third scoring ≥ 50. The macro term is identical across stocks on a day, so it is left out of the ranking here.",
      "Brokerage, taxes and slippage are not deducted (roughly 0.2–0.3% per round trip for delivery trades).",
      "Today's watchlist is used for the whole period, which favours stocks that stayed in the Nifty 200 (survivorship bias).",
    ],
  };
}

/** Strategy diagnostics (see experiment.ts): forward returns by check and indicator bin, and stop/target variants. */
export async function buildExperimentReport(now = new Date()): Promise<ExperimentReport> {
  const settled = await mapSettled(WATCHLIST, 6, async (entry: WatchlistEntry) => {
    const { candles } = await fetchDailyCandles(entry.yahoo, HISTORY_DAYS, now);
    return { entry, candles };
  });
  const series: Array<{ entry: WatchlistEntry; candles: Candle[] }> = [];
  for (const r of settled) if (r.status === "fulfilled" && r.value.candles.length >= 80) series.push(r.value);
  if (series.length < WATCHLIST.length * 0.35) {
    throw new Error(`Only ${series.length}/${WATCHLIST.length} symbols loaded from Yahoo Finance`);
  }
  return runExperiment(series);
}
