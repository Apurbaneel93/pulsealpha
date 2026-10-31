/**
 * Deterministic ranking + copy. Used when no Gemini key is configured, when
 * the AI call fails, in demo mode, and to sanitise or top-up AI output.
 */
import { NASDAQ_SENSITIVE } from "./watchlist";
import type { BoardRow, MarketCues, NewsItem, ResearchBreakdown, TechnicalSnapshot } from "./types";

export const HARD_FILTER = {
  rsiMin: 55,
  rsiMax: 72,
  volumeRatioMin: 1.5,
} as const;

export function passesHardFilter(s: TechnicalSnapshot): boolean {
  return (
    s.current_price > s.ema20 &&
    s.rsi14 >= HARD_FILTER.rsiMin &&
    s.rsi14 <= HARD_FILTER.rsiMax &&
    s.volume_ratio > HARD_FILTER.volumeRatioMin
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const signed = (n: number, digits = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

function indexChange(market: MarketCues, symbol: "^GSPC" | "^IXIC" | "^NSEI"): number | null {
  return market.indices.find((i) => i.symbol === symbol)?.changePct ?? null;
}

export function pctAboveEma20(s: TechnicalSnapshot): number {
  return ((s.current_price - s.ema20) / s.ema20) * 100;
}

/** Score in [1, 99]. Rewards volume expansion, a mid-band RSI, a rising EMA stack and supportive macro. */
export function convictionScore(s: TechnicalSnapshot, market: MarketCues, newsCount = 0): number {
  let score = 0;
  score += (clamp(s.volume_ratio, 0, 4) / 4) * 35;
  score += clamp(1 - Math.abs(s.rsi14 - 63) / 9, 0, 1) * 20;
  if (s.ema20 > s.ema50) score += 15;
  const stretchAtr = (s.current_price - s.ema20) / s.atr14;
  if (stretchAtr > 0 && stretchAtr <= 1.5) score += 10;
  else if (stretchAtr > 2.5) score -= 5;
  if (s.day_change_pct > 0) score += 5;
  score += market.regime === "Bullish" ? 10 : market.regime === "Bearish" ? -10 : 0;
  const ndx = indexChange(market, "^IXIC");
  if (NASDAQ_SENSITIVE.has(s.sector) && ndx !== null && ndx > 0.5) score += 5;
  if (newsCount > 0) score += 5;
  return Math.round(clamp(score, 1, 99));
}

export function rulesCatalyst(s: TechnicalSnapshot, market: MarketCues): string {
  const ndx = indexChange(market, "^IXIC");
  const parts: string[] = [];
  if (NASDAQ_SENSITIVE.has(s.sector) && ndx !== null && ndx > 0.3) parts.push("Nasdaq IT tailwind");
  else if (market.regime === "Bullish") parts.push("Supportive global cues");
  else if (s.ema20 > s.ema50) parts.push("Rising 20/50-EMA trend");
  else parts.push(`${s.sector} relative strength`);
  parts.push(`${s.volume_ratio.toFixed(1)}x volume breakout`);
  return parts.join(" + ");
}

export function rulesBreakdown(s: TechnicalSnapshot, market: MarketCues, news: NewsItem[]): ResearchBreakdown {
  const spx = indexChange(market, "^GSPC");
  const ndx = indexChange(market, "^IXIC");
  const nifty = indexChange(market, "^NSEI");
  const us =
    spx !== null && ndx !== null
      ? `S&P 500 ${signed(spx)} and Nasdaq ${signed(ndx)} in the last US session`
      : "US cues unavailable";
  const home = nifty !== null ? `Nifty ${signed(nifty)}` : "Nifty change unavailable";
  const sectorNote = NASDAQ_SENSITIVE.has(s.sector)
    ? " IT exporters tend to track overnight US tech sentiment."
    : "";
  const global_cue = `${us}; ${home}. Regime reads ${market.regime.toLowerCase()}.${sectorNote}`;

  const stack = s.ema20 > s.ema50 ? "with the 20-EMA above the 50-EMA" : "though the 20-EMA is still below the 50-EMA";
  const technical_trigger = `Trading ${pctAboveEma20(s).toFixed(1)}% above its 20-EMA ${stack}; RSI ${s.rsi14.toFixed(
    1,
  )} and volume ${s.volume_ratio.toFixed(1)}x the 20-day average.`;

  const top = news[0];
  const news_catalyst = top
    ? `Latest headline${top.source ? ` (${top.source})` : ""}: ${truncate(top.title, 110)}`
    : "No company-specific headlines in the last 24 hours, so this setup is technical and sector-driven.";

  return { global_cue, technical_trigger, news_catalyst };
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
      conviction: convictionScore(snapshot, market, newsBySymbol.get(snapshot.symbol)?.length ?? 0),
    }))
    .sort((a, b) => b.conviction - a.conviction || b.snapshot.volume_ratio - a.snapshot.volume_ratio);
}

/**
 * Full bullish ranking: every stock trading above its 20-EMA, ordered by how
 * many of the three hard-filter checks it passes, then by bullish score.
 * Stocks below the 20-EMA are left out — they are not in an uptrend.
 */
export function buildBoard(snapshots: readonly TechnicalSnapshot[], market: MarketCues): BoardRow[] {
  return snapshots
    .filter((s) => s.current_price > s.ema20)
    .map((s): BoardRow => {
      const checks = {
        trend: true,
        rsi: s.rsi14 >= HARD_FILTER.rsiMin && s.rsi14 <= HARD_FILTER.rsiMax,
        volume: s.volume_ratio > HARD_FILTER.volumeRatioMin,
      };
      return {
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        price: s.current_price,
        change_pct: s.day_change_pct,
        rsi14: s.rsi14,
        volume_ratio: s.volume_ratio,
        pct_above_ema20: Math.round(pctAboveEma20(s) * 100) / 100,
        ema20_above_ema50: s.ema20 > s.ema50,
        atr14: s.atr14,
        checks,
        passed: 1 + Number(checks.rsi) + Number(checks.volume),
        score: convictionScore(s, market),
      };
    })
    .sort((a, b) => b.passed - a.passed || b.score - a.score || b.volume_ratio - a.volume_ratio);
}
