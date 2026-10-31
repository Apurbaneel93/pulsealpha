/**
 * Pure, dependency-free technical indicators.
 * All series are ordered oldest → newest. Functions return `null` when the
 * input is too short to produce a stable value, never NaN.
 */

import type { Candle } from "./types";

/** Exponential moving average series, seeded with the SMA of the first `period` values. */
export function emaSeries(values: readonly number[], period: number): number[] {
  if (period <= 0 || values.length < period) return [];
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i] ?? 0;
  let prev = seed / period;
  const out: number[] = [prev];
  for (let i = period; i < values.length; i++) {
    const v = values[i] ?? prev;
    prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function ema(values: readonly number[], period: number): number | null {
  const s = emaSeries(values, period);
  return s.length ? (s[s.length - 1] ?? null) : null;
}

/** Wilder's RSI. Needs at least period + 1 closes. */
export function rsi(closes: readonly number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** True range of candle i (needs the previous close). */
function trueRange(c: Candle, prevClose: number): number {
  return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
}

/** Wilder's ATR. Needs at least period + 1 candles. */
export function atr(candles: readonly Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    if (!c || !p) continue;
    trs.push(trueRange(c, p.close));
  }
  if (trs.length < period) return null;
  let value = 0;
  for (let i = 0; i < period; i++) value += trs[i] ?? 0;
  value /= period;
  for (let i = period; i < trs.length; i++) {
    value = (value * (period - 1) + (trs[i] ?? 0)) / period;
  }
  return value;
}

/**
 * Latest session volume divided by the average of the `lookback` sessions
 * *before* it. Excluding the latest bar keeps a breakout spike from diluting
 * its own baseline.
 */
export function volumeRatio(
  volumes: readonly number[],
  lookback = 20,
): { ratio: number; latest: number; average: number } | null {
  if (volumes.length < lookback + 1) return null;
  const latest = volumes[volumes.length - 1] ?? 0;
  const window = volumes.slice(-(lookback + 1), -1);
  const average = window.reduce((a, b) => a + b, 0) / window.length;
  if (average <= 0) return null;
  return { ratio: latest / average, latest, average };
}

export function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}
