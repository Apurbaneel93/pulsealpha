"use client";

import { ChevronDown } from "lucide-react";
import { LEVEL_MULTIPLIERS } from "@/lib/levels";
import { HARD_FILTER } from "@/lib/rules-engine";

const STEPS = [
  "Overnight S&P 500, Nasdaq and the Nifty 50 set the market regime.",
  `Momentum screen: RSI ${HARD_FILTER.rsiMin}–${HARD_FILTER.rsiMax}, price above the 20-day average but no more than ${HARD_FILTER.maxExtensionPct}% over it, yesterday's range within ${HARD_FILTER.maxCoilRatio}x ATR (a coil, not a spent move), ATR at least ${HARD_FILTER.minAtrPct}% of price and volume at least ${HARD_FILTER.volumeRatioMin}x average.`,
  "Survivors get the last 24 hours of Google News headlines with their timestamps.",
  "Gemini ranks the top 2–3 on unpriced catalysts: fresh orders, approvals and earnings released after the last close beat recaps of a move that already happened. It sees ratios and headlines, never a price.",
  `Gap Guard: if a stock is already up more than ${LEVEL_MULTIPLIERS.gapGuard} ATR it is a "wait for pullback", with the buy zone at the previous close + ${LEVEL_MULTIPLIERS.pullbackAnchor} ATR instead of the spike.`,
  `Code sets the buy zone (±${LEVEL_MULTIPLIERS.entryBand.toFixed(2)} ATR) and a stop at −${LEVEL_MULTIPLIERS.stop.toFixed(2)} ATR, with two exits: Target 1 at +${LEVEL_MULTIPLIERS.target1.toFixed(2)} ATR (book 60% and move the stop to breakeven) and Target 2 at +${LEVEL_MULTIPLIERS.target2.toFixed(2)} ATR (book the rest, or trail the 15-minute 9-EMA).`,
];

export function HowItWorks({ className = "mt-6" }: { className?: string }) {
  return (
    <details className={`group rounded-xl border border-line/70 bg-panel/60 ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-[13.5px] font-semibold text-fg [&::-webkit-details-marker]:hidden">
        How these picks are made
        <ChevronDown size={16} className="shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-3.5 pb-3.5">
        <ol className="list-decimal space-y-1.5 pl-5 text-[12.5px] leading-snug text-muted marker:text-faint">
          {STEPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <p className="mt-3 text-[12px] leading-snug text-faint">
          Prices come from Yahoo Finance and can lag the exchange by a few minutes. Market data is shared and refreshed
          about every 3 minutes. Your Signal History stays on this device.
        </p>
      </div>
    </details>
  );
}
