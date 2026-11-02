import type { GapStatus, PriceLevels } from "./types";

/** NSE equity tick size. */
export const TICK = 0.05;

/** Every multiple is in units of ATR(14). */
export const LEVEL_MULTIPLIERS = {
  /** Above this, the stock has already run: don't chase it. */
  gapGuard: 0.75,
  /** After a spike, the plan is anchored this far above the previous close. */
  pullbackAnchor: 0.35,
  /** The buy zone is the base entry ± this. */
  entryBand: 0.1,
  stop: 0.9,
  target1: 1.15,
  target2: 2.0,
} as const;

/** Share of the position sold at each target. */
export const EXIT_SPLIT = { target1: 0.6, target2: 0.4 } as const;

/** How each exit is managed. Shown on the card next to the target. */
export const EXIT_PLAN = {
  target1: "Book 60% & Trail SL to Breakeven",
  target2: "Book 40% or Trail 15m 9-EMA",
} as const;

export function roundToTick(value: number, tick = TICK): number {
  return Math.round(Math.round(value / tick) * tick * 100) / 100;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** How many ATRs the price has already moved since the previous close. */
export function openingGapAtr(currentPrice: number, previousClose: number, atr: number): number {
  return atr > 0 ? (currentPrice - previousClose) / atr : 0;
}

/**
 * Deterministic ATR price levels. The only inputs are the current price, the
 * previous close and ATR(14) — nothing produced by the AI layer reaches this.
 *
 *   gap = (price − previous close) ÷ ATR
 *   gap > 0.75  → WAIT_FOR_PULLBACK, base entry = previous close + 0.35 ATR
 *   otherwise   → ACTIVE_BUY_ZONE,   base entry = current price
 *   buy zone = base ± 0.10 ATR · stop = base − 0.90 ATR
 *   T1 = base + 1.15 ATR · T2 = base + 2.00 ATR
 */
export function computeLevels(currentPrice: number, previousClose: number, atr: number): PriceLevels {
  const gap = openingGapAtr(currentPrice, previousClose, atr);
  const gap_status: GapStatus = gap > LEVEL_MULTIPLIERS.gapGuard ? "WAIT_FOR_PULLBACK" : "ACTIVE_BUY_ZONE";
  const base = gap_status === "WAIT_FOR_PULLBACK" ? previousClose + LEVEL_MULTIPLIERS.pullbackAnchor * atr : currentPrice;
  const base_entry = roundToTick(base);
  const target_1 = roundToTick(base + LEVEL_MULTIPLIERS.target1 * atr);
  const target_2 = roundToTick(base + LEVEL_MULTIPLIERS.target2 * atr);
  const stop_loss = roundToTick(base - LEVEL_MULTIPLIERS.stop * atr);
  const pct = (level: number) => round2(((level - base_entry) / base_entry) * 100);
  return {
    gap_status,
    opening_gap_atr: round2(gap),
    base_entry,
    entry_low: roundToTick(base - LEVEL_MULTIPLIERS.entryBand * atr),
    entry_high: roundToTick(base + LEVEL_MULTIPLIERS.entryBand * atr),
    stop_loss,
    target_1,
    target_2,
    target_1_pct: pct(target_1),
    target_2_pct: pct(target_2),
    stop_pct: pct(stop_loss),
  };
}
