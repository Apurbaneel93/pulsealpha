/**
 * Deterministic screen, ranking and copy. Used when no Gemini key is
 * configured, when the AI call fails, in demo mode, and to sanitise or top-up
 * AI output.
 */
import { LEVEL_MULTIPLIERS } from "./levels";
import { istDateKey } from "./time";
import { NASDAQ_SENSITIVE } from "./watchlist";
import { CHECK_KEYS } from "./types";
import type {
  BoardRow,
  CatalystCategory,
  CatalystFreshness,
  CheckKey,
  MarketCues,
  NewsItem,
  ResearchBreakdown,
  TechnicalSnapshot,
} from "./types";

/**
 * The momentum screen. A stock must clear all of it:
 *   - trade above its 20-day average, but not more than 4.5% above it
 *   - RSI(14) 52–65: trending, not yet overbought
 *   - yesterday's range at most 1.25x ATR: a coiled spring, not a spent move
 *   - ATR at least 2.2% of price: enough movement to pay for costs
 *   - relative volume at least 1.5x
 */
export const HARD_FILTER = {
  rsiMin: 52,
  rsiMax: 65,
  maxExtensionPct: 4.5,
  maxCoilRatio: 1.25,
  minAtrPct: 2.2,
  volumeRatioMin: 1.5,
} as const;

/** Each of the six checks on its own, so the board can show which one a stock misses. */
export function checksFor(s: TechnicalSnapshot): Record<CheckKey, boolean> {
  return {
    trend: s.current_price > s.sma20,
    extension: s.sma20_extension_pct <= HARD_FILTER.maxExtensionPct,
    rsi: s.rsi14 >= HARD_FILTER.rsiMin && s.rsi14 <= HARD_FILTER.rsiMax,
    coil: s.coil_ratio <= HARD_FILTER.maxCoilRatio,
    volatility: s.atr_pct >= HARD_FILTER.minAtrPct,
    volume: s.volume_ratio >= HARD_FILTER.volumeRatioMin,
  };
}

export function passesHardFilter(s: TechnicalSnapshot): boolean {
  const checks = checksFor(s);
  return CHECK_KEYS.every((k) => checks[k]);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const signed = (n: number, digits = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

function indexChange(market: MarketCues, symbol: "^GSPC" | "^IXIC" | "^NSEI"): number | null {
  return market.indices.find((i) => i.symbol === symbol)?.changePct ?? null;
}

// ── Headlines: how fresh is the catalyst, and what kind is it? ──────────────

/** Headlines that explain a move that already happened: by the time they run, institutions are selling into it. */
const RECAP =
  /\b(surg(?:e|es|ed|ing)|jump(?:s|ed|ing)?|rall(?:y|ies|ied|ying)|soar(?:s|ed|ing)?|zoom(?:s|ed|ing)?|spik(?:e|es|ed|ing)|52[- ]?week high|all[- ]time high|record high|top gainers?|gainers|why\b.{0,40}\b(?:up|higher|rising|climb))\b/i;

const CATEGORY_RULES: ReadonlyArray<readonly [CatalystCategory, RegExp]> = [
  ["Regulatory", /\b(usfda|fda|sebi|approval|approves?|approved|clearance|cleared|pli|drdo|ministry of defence|licen[cs]e)\b/i],
  ["Order Win", /\b(orders?|contracts?|bags|wins?|secures?|awarded|letter of award|l1 bidder)\b/i],
  ["Earnings Beat", /\b(results?|q[1-4]|profit|earnings|ebitda|margins?|beats?)\b/i],
  ["Sector Tailwind", /\b(policy|tariffs?|budget|government|govt|ministry|subsidy|duty|stimulus)\b/i],
];

/** IST 15:30 on the day of the last completed session, in epoch ms. */
export function sessionCloseMs(asOfSession: string): number {
  const key = istDateKey(new Date(asOfSession));
  return Date.parse(`${key}T15:30:00+05:30`);
}

/**
 * Deterministic version of what the AI is asked to judge: a recap of yesterday's
 * move is "Priced-In Recap"; a non-recap headline published after the last close
 * is "Unpriced Post-Market"; anything else, including no news, is "Ongoing Multi-Day".
 */
export function classifyCatalyst(
  news: readonly NewsItem[],
  asOfSession: string,
): { category: CatalystCategory; freshness: CatalystFreshness; lead: NewsItem | null } {
  if (news.length === 0) return { category: "Technical Coil Breakout", freshness: "Ongoing Multi-Day", lead: null };
  const closeMs = sessionCloseMs(asOfSession);
  const fresh = news.filter((n) => !RECAP.test(n.title));
  const lead = fresh[0] ?? news[0] ?? null;
  if (fresh.length === 0) return { category: "Technical Coil Breakout", freshness: "Priced-In Recap", lead };
  const postClose = fresh.find((n) => Date.parse(n.publishedAt) > closeMs);
  const subject = postClose ?? fresh[0] ?? null;
  const category = CATEGORY_RULES.find(([, re]) => subject && re.test(subject.title))?.[0] ?? "Technical Coil Breakout";
  return { category, freshness: postClose ? "Unpriced Post-Market" : "Ongoing Multi-Day", lead: subject };
}

// ── Conviction ──────────────────────────────────────────────────────────────

/** 1 inside the 54–63 sweet spot, fading to 0 two points outside it. */
const rsiFit = (rsi: number) => (rsi < 54 ? clamp(1 - (54 - rsi) / 2, 0, 1) : rsi > 63 ? clamp(1 - (rsi - 63) / 2, 0, 1) : 1);
/** 1 for a very tight prior day (≤1.0x ATR), 0.5 at the 1.25x cap, 0 from 1.5x. */
const coilFit = (coil: number) => clamp(1 - (coil - 1.0) / 0.5, 0, 1);

/** Score in [1, 99]. Rewards volume, a coiled prior day, a mid-band RSI, volatility, a rising EMA stack and fresh news. */
export function convictionScore(
  s: TechnicalSnapshot,
  market: MarketCues,
  news: readonly NewsItem[] = [],
): number {
  let score = 0;
  score += (clamp(s.volume_ratio, 0, 4) / 4) * 28;
  score += rsiFit(s.rsi14) * 18;
  score += coilFit(s.coil_ratio) * 16;
  score += clamp((s.atr_pct - HARD_FILTER.minAtrPct) / 1.3, 0, 1) * 8;
  if (s.ema20 > s.ema50) score += 10;
  if (s.sma20_extension_pct > 0 && s.sma20_extension_pct <= 3) score += 6;
  else if (s.sma20_extension_pct > HARD_FILTER.maxExtensionPct) score -= 5;
  // Already ran past the gap guard: the entry is a pullback, not a breakout.
  if (s.opening_gap_atr > LEVEL_MULTIPLIERS.gapGuard) score -= 6;
  score += market.regime === "Bullish" ? 10 : market.regime === "Bearish" ? -10 : 0;
  const ndx = indexChange(market, "^IXIC");
  if (NASDAQ_SENSITIVE.has(s.sector) && ndx !== null && ndx > 0.5) score += 5;
  if (news.length > 0) {
    const { freshness } = classifyCatalyst(news, s.as_of_session);
    score += freshness === "Unpriced Post-Market" ? 10 : freshness === "Ongoing Multi-Day" ? 4 : -6;
  }
  return Math.round(clamp(score, 1, 99));
}

// ── Copy ────────────────────────────────────────────────────────────────────

/** One-sentence market read, from the same indices the regime is built on. */
export function regimeSummary(market: MarketCues): string {
  const spx = indexChange(market, "^GSPC");
  const ndx = indexChange(market, "^IXIC");
  const nifty = indexChange(market, "^NSEI");
  const us =
    spx !== null && ndx !== null
      ? `S&P 500 ${signed(spx)} and Nasdaq ${signed(ndx)} in the last US session`
      : "US cues unavailable";
  const home = nifty !== null ? `Nifty ${signed(nifty)}` : "Nifty change unavailable";
  return `${us}; ${home}. Regime reads ${market.regime.toLowerCase()}.`;
}

/** What the numbers say about the setup. Always built in code, so every figure is exact. */
export function technicalTrigger(s: TechnicalSnapshot): string {
  const tight = s.coil_ratio <= 1.15 ? "tightly coiled" : "compact";
  return (
    `Yesterday's range was ${s.coil_ratio.toFixed(2)}x ATR (${tight}); RSI ${s.rsi14.toFixed(1)}, ` +
    `volume ${s.volume_ratio.toFixed(1)}x its 20-day average, ${s.sma20_extension_pct.toFixed(1)}% above the 20-DMA, ` +
    `and ATR is ${s.atr_pct.toFixed(1)}% of price.`
  );
}

export function rulesBreakdown(s: TechnicalSnapshot, market: MarketCues, news: NewsItem[]): ResearchBreakdown {
  const sectorNote = NASDAQ_SENSITIVE.has(s.sector) ? " IT exporters tend to track overnight US tech sentiment." : "";
  const { freshness, lead } = classifyCatalyst(news, s.as_of_session);
  const thesis =
    lead && freshness === "Unpriced Post-Market"
      ? `Fresh headline after the last close: ${truncate(lead.title, 100)}. A tight prior day on ${s.volume_ratio.toFixed(1)}x volume leaves room for buyers to push it higher today.`
      : lead && freshness === "Ongoing Multi-Day"
        ? `Ongoing story: ${truncate(lead.title, 100)}. The tight prior day on ${s.volume_ratio.toFixed(1)}x volume is the trigger to watch.`
        : `No fresh company news, so this is a technical setup: a tight prior day on ${s.volume_ratio.toFixed(1)}x volume could expand today.`;
  return { global_cue: `${regimeSummary(market)}${sectorNote}`, technical_trigger: technicalTrigger(s), thesis };
}

/** What would invalidate the setup, in one short phrase. */
export function rulesExecutionRisk(s: TechnicalSnapshot): string {
  return s.opening_gap_atr > LEVEL_MULTIPLIERS.gapGuard
    ? "Wait for a pullback into the buy zone; skip if it never trades down to it"
    : `Skip if the opening gap exceeds ${LEVEL_MULTIPLIERS.gapGuard} ATR`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

/** Rank the shortlist deterministically (descending conviction, then volume ratio). */
export function rankByRules(
  shortlist: readonly TechnicalSnapshot[],
  market: MarketCues,
  newsBySymbol: ReadonlyMap<string, NewsItem[]>,
): Array<{ snapshot: TechnicalSnapshot; conviction: number }> {
  return shortlist
    .map((snapshot) => ({
      snapshot,
      conviction: convictionScore(snapshot, market, newsBySymbol.get(snapshot.symbol) ?? []),
    }))
    .sort((a, b) => b.conviction - a.conviction || b.snapshot.volume_ratio - a.snapshot.volume_ratio);
}

/**
 * Full bullish ranking: every stock trading above its 20-DMA, ordered by how
 * many of the six screening checks it passes, then by bullish score. Stocks
 * below the 20-DMA are left out — they are not in an uptrend.
 */
export function buildBoard(snapshots: readonly TechnicalSnapshot[], market: MarketCues): BoardRow[] {
  return snapshots
    .filter((s) => s.current_price > s.sma20)
    .map((s): BoardRow => {
      const checks = checksFor(s);
      return {
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        price: s.current_price,
        prev_close: s.prev_close,
        change_pct: s.day_change_pct,
        rsi14: s.rsi14,
        volume_ratio: s.volume_ratio,
        atr_pct: s.atr_pct,
        coil_ratio: s.coil_ratio,
        sma20_extension_pct: s.sma20_extension_pct,
        ema20_above_ema50: s.ema20 > s.ema50,
        atr14: s.atr14,
        checks,
        passed: CHECK_KEYS.filter((k) => checks[k]).length,
        score: convictionScore(s, market),
      };
    })
    .sort((a, b) => b.passed - a.passed || b.score - a.score || b.volume_ratio - a.volume_ratio);
}
