/**
 * PulseAlpha — shared, strict domain types.
 * Every price on the wire is computed in code; the AI layer only ever
 * returns symbols (constrained to the shortlist) and prose.
 */

export type DataMode = "live" | "demo";
export type Regime = "Bullish" | "Neutral" | "Bearish";
export type Engine = "gemini" | "rules";

export interface Candle {
  /** Session date as ISO string (UTC midnight-ish from the feed). */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchlistEntry {
  /** NSE trading symbol, e.g. "RELIANCE" */
  symbol: string;
  /** Yahoo Finance symbol, e.g. "RELIANCE.NS" */
  yahoo: string;
  name: string;
  sector: Sector;
}

export type Sector =
  | "IT"
  | "Banking"
  | "Financials"
  | "Energy"
  | "Auto"
  | "FMCG"
  | "Pharma"
  | "Healthcare"
  | "Metals"
  | "Cement"
  | "Infra"
  | "Capital Goods"
  | "Defence"
  | "Consumer"
  | "Telecom"
  | "Realty"
  | "Chemicals"
  | "Aviation";

export interface IndexCue {
  symbol: "^GSPC" | "^IXIC" | "^NSEI";
  label: "S&P 500" | "Nasdaq" | "Nifty 50";
  last: number;
  changePct: number;
  aboveEma20: boolean;
  /** ISO time of the session the change refers to. */
  sessionDate: string;
}

export interface MarketCues {
  regime: Regime;
  /** Deterministic composite score in [-2.5, 2.5]. */
  score: number;
  indices: IndexCue[];
  summary: string;
}

export interface TechnicalSnapshot {
  symbol: string;
  name: string;
  sector: Sector;
  current_price: number;
  prev_close: number;
  day_change_pct: number;
  /** 20-day simple moving average (the "20-DMA" the screen is built on). */
  sma20: number;
  ema20: number;
  ema50: number;
  rsi14: number;
  atr14: number;
  /** ATR(14) as a percentage of price: how much a stock can move in a day. */
  atr_pct: number;
  /** Last completed session's high-low range divided by ATR(14). Below ~1.25 = coiled, not yet expanded. */
  coil_ratio: number;
  /** How far price sits above the 20-DMA, in percent (negative = below). */
  sma20_extension_pct: number;
  /** (price − previous close) ÷ ATR(14): how far the stock has already run. */
  opening_gap_atr: number;
  /** Relative volume: latest completed session ÷ the prior 20-session average. */
  volume_ratio: number;
  latest_volume: number;
  avg_volume20: number;
  /** ISO date of the last completed daily candle used for indicators. */
  as_of_session: string;
  /** Last ~30 closes (plus the live price when a session is open), for the card sparkline. */
  spark: number[];
}

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  publishedAt: string;
}

/** ACTIVE_BUY_ZONE: buy near the current price. WAIT_FOR_PULLBACK: it has already run, so don't chase. */
export type GapStatus = "ACTIVE_BUY_ZONE" | "WAIT_FOR_PULLBACK";

export interface PriceLevels {
  gap_status: GapStatus;
  /** (price − previous close) ÷ ATR(14) at detection time. */
  opening_gap_atr: number;
  /** The price the plan is built around: the current price, or previous close + 0.35 ATR after a spike. */
  base_entry: number;
  entry_low: number;
  entry_high: number;
  stop_loss: number;
  /** Target 1, +1.15 ATR: book 60% and trail the stop to breakeven. */
  target_1: number;
  /** Target 2, +2.00 ATR: book the other 40%, or trail the 15-minute 9-EMA. */
  target_2: number;
  /** Distances from `base_entry`, in percent. */
  target_1_pct: number;
  target_2_pct: number;
  stop_pct: number;
}

export type CatalystCategory = "Order Win" | "Earnings Beat" | "Regulatory" | "Sector Tailwind" | "Technical Coil Breakout";
export type CatalystFreshness = "Unpriced Post-Market" | "Ongoing Multi-Day" | "Priced-In Recap";

export interface ResearchBreakdown {
  /** The market regime in one sentence. */
  global_cue: string;
  /** Deterministic: what the coil, RSI, volume and extension numbers say. */
  technical_trigger: string;
  /** Why fresh buyers should step in today (2 sentences). */
  thesis: string;
}

export interface Pick {
  rank: number;
  symbol: string;
  name: string;
  sector: Sector;
  current_price: number;
  day_change_pct: number;
  levels: PriceLevels;
  metrics: {
    sma20: number;
    ema20: number;
    ema50: number;
    rsi14: number;
    atr14: number;
    atr_pct: number;
    coil_ratio: number;
    sma20_extension_pct: number;
    /** Relative volume (RVOL). */
    volume_ratio: number;
  };
  spark: number[];
  conviction: number;
  /** One-line catalyst: the category, e.g. "Order Win". */
  catalyst: string;
  catalyst_category: CatalystCategory;
  catalyst_freshness: CatalystFreshness;
  /** What would invalidate the setup, e.g. "Skip if the opening gap exceeds 0.75 ATR". */
  execution_risk: string;
  breakdown: ResearchBreakdown;
  news: NewsItem[];
  detected_at: string;
  detected_at_iso: string;
}

/**
 * Everything one scan needs from the outside world, captured at one moment.
 * This is the unit the server caches: it is small (shortlist only), JSON-safe,
 * and shared by every user and every serverless instance.
 */
export interface MarketSnapshot {
  /** Unique per fetch; identical across users served from the same cache entry. */
  version: string;
  fetched_at_iso: string;
  market: MarketCues;
  universe_size: number;
  failed_symbols: number;
  /** How many stocks cleared the hard filter (shortlist may be capped below this). */
  passed_count: number;
  /** Filter survivors, pre-ranked by the rules engine, capped for news + AI. */
  shortlist: TechnicalSnapshot[];
  /** Last-24h headlines per shortlisted symbol. Empty in demo/simulated data. */
  news: Record<string, NewsItem[]>;
  /** Stocks with usable data this scan (denominator for the board). */
  scanned: number;
  /** Every stock above its 20-DMA, ranked: checks passed, then score. */
  board: BoardRow[];
}

/** The six screening checks. All six passing = a full setup. */
export type CheckKey = "trend" | "extension" | "rsi" | "coil" | "volatility" | "volume";
export const CHECK_KEYS: readonly CheckKey[] = ["trend", "extension", "rsi", "coil", "volatility", "volume"];

/** One row of the full bullish ranking: every scanned stock trading above its 20-DMA. */
export interface BoardRow {
  symbol: string;
  name: string;
  sector: Sector;
  price: number;
  prev_close: number;
  change_pct: number;
  rsi14: number;
  /** Relative volume (RVOL). */
  volume_ratio: number;
  atr_pct: number;
  coil_ratio: number;
  /** Percent above the 20-DMA. */
  sma20_extension_pct: number;
  ema20_above_ema50: boolean;
  atr14: number;
  /** `trend` (above the 20-DMA) is always true on the board. */
  checks: Record<CheckKey, boolean>;
  /** How many of the six checks pass (6 = a full setup). */
  passed: number;
  /** Rules-engine bullish score, 1–99. */
  score: number;
}

export type CacheStatus = "hit" | "miss" | "stale";

export interface ScanResult {
  /** Deterministic for the same market data + engine, so history can de-duplicate. */
  id: string;
  mode: DataMode;
  engine: Engine;
  model: string | null;
  /** True when live data failed and the scan was served from simulated data. */
  simulated: boolean;
  notice: string | null;
  /** When the market data behind this scan was fetched = when the setups were detected. */
  scanned_at: string;
  scanned_at_iso: string;
  market: MarketCues;
  /** One-sentence read of how today's global and Nifty cues affect follow-through (Gemini's, or the rules engine's). */
  regime_summary?: string;
  universe_size: number;
  shortlist_size: number;
  picks: Pick[];
  /** Full bullish ranking (may be absent on scans saved by older versions). */
  board?: BoardRow[];
  board_scanned?: number;
  /** Server cache status for live scans; null for demo/simulated. */
  cache: { market: CacheStatus; ai: CacheStatus | null; refresh_seconds: number } | null;
  duration_ms: number;
}

export interface ScanRequestBody {
  mode?: DataMode;
  model?: string;
}

export interface HistoryEntry {
  id: string;
  scan_id: string;
  symbol: string;
  name: string;
  entry_low: number;
  entry_high: number;
  /** Target 1. Entries saved before the T1/T2 exits existed have only this. */
  target_price: number;
  /** Target 2; absent on older entries. */
  target_2?: number;
  gap_status?: GapStatus;
  stop_loss: number;
  conviction: number;
  catalyst: string;
  mode: DataMode;
  simulated: boolean;
  detected_at: string;
  detected_at_iso: string;
}

export interface ServerConfig {
  /** This browser holds a valid owner session. */
  owner: boolean;
  /** OWNER_PASSCODE is configured on the server, so sign-in is possible. */
  ownerEnabled: boolean;
  /** Only ever true for the owner. */
  hasServerKey: boolean;
  defaultModel: string;
  /** Market data cache lifetime (unstable_cache revalidate), seconds. */
  marketRefreshSeconds: number;
}

export interface ApiError {
  error: string;
}

// ── Live prices and charts ──────────────────────────────────────────────────

export type ChartRange = "1d" | "5d" | "1m" | "3m" | "6m" | "1y";

/** Latest traded price for one symbol, refreshed every ~15 s on the server. */
export interface LiveQuote {
  price: number;
  /** Official previous close, so the change matches what brokers show. */
  prev_close: number;
  change_pct: number;
  day_high: number | null;
  day_low: number | null;
  /** When the exchange stamped the last trade (not when we fetched it). */
  market_time_iso: string;
  fetched_at_iso: string;
}

export interface QuotesResponse {
  as_of_iso: string;
  quotes: Record<string, LiveQuote>;
  /** Symbols that could not be loaded this time; clients keep their last value. */
  missing: string[];
}

export interface ChartPayload {
  symbol: string;
  range: ChartRange;
  interval: "1m" | "5m" | "1d";
  /** [epoch seconds, close] */
  points: Array<[number, number]>;
  /** Aligned with `points`; null while the average is still warming up. Daily ranges only. */
  ema20: Array<number | null> | null;
  ema50: Array<number | null> | null;
  /** Official previous close; 1D only. */
  previous_close: number | null;
  /** Regular-session window of the day shown, epoch seconds; 1D only. */
  session: { start: number; end: number } | null;
  fetched_at_iso: string;
}
