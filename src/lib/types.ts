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
  ema20: number;
  ema50: number;
  rsi14: number;
  atr14: number;
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

export interface PriceLevels {
  entry_low: number;
  entry_high: number;
  target_price: number;
  stop_loss: number;
  target_pct: number;
  stop_pct: number;
}

export interface ResearchBreakdown {
  global_cue: string;
  technical_trigger: string;
  news_catalyst: string;
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
    ema20: number;
    ema50: number;
    rsi14: number;
    atr14: number;
    volume_ratio: number;
  };
  spark: number[];
  conviction: number;
  catalyst: string;
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
  /** Every stock above its 20-EMA, ranked: checks passed, then score. */
  board: BoardRow[];
}

/** One row of the full bullish ranking: every scanned stock trading above its 20-EMA. */
export interface BoardRow {
  symbol: string;
  name: string;
  sector: Sector;
  price: number;
  change_pct: number;
  rsi14: number;
  volume_ratio: number;
  pct_above_ema20: number;
  ema20_above_ema50: boolean;
  atr14: number;
  /** The three hard-filter checks. `trend` is always true on the board. */
  checks: { trend: boolean; rsi: boolean; volume: boolean };
  /** How many of the three checks pass (3 = a full setup). */
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
  target_price: number;
  stop_loss: number;
  conviction: number;
  catalyst: string;
  mode: DataMode;
  simulated: boolean;
  detected_at: string;
  detected_at_iso: string;
}

export interface ServerConfig {
  hasServerKey: boolean;
  defaultModel: string;
  /** Market data cache lifetime (unstable_cache revalidate), seconds. */
  marketRefreshSeconds: number;
}

export interface ApiError {
  error: string;
}
