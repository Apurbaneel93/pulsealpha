import type { PriceLevels } from "./types";

/** NSE equity tick size. */
export const TICK = 0.05;

export const LEVEL_MULTIPLIERS = {
  entryBand: 0.15,
  target: 2.5,
  stop: 1.5,
} as const;

export function roundToTick(value: number, tick = TICK): number {
  return Math.round(Math.round(value / tick) * tick * 100) / 100;
}

/**
 * Deterministic ATR price levels. The only inputs are `current_price` and
 * `atr` — nothing produced by the AI layer ever reaches this function.
 */
export function computeLevels(currentPrice: number, atr: number): PriceLevels {
  const entry_low = roundToTick(currentPrice);
  const entry_high = roundToTick(currentPrice + LEVEL_MULTIPLIERS.entryBand * atr);
  const target_price = roundToTick(currentPrice + LEVEL_MULTIPLIERS.target * atr);
  const stop_loss = roundToTick(currentPrice - LEVEL_MULTIPLIERS.stop * atr);
  return {
    entry_low,
    entry_high,
    target_price,
    stop_loss,
    target_pct: round2(((target_price - currentPrice) / currentPrice) * 100),
    stop_pct: round2(((stop_loss - currentPrice) / currentPrice) * 100),
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
