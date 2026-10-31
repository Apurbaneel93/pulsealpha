"use client";

import { ChevronDown } from "lucide-react";

const STEPS = [
  "Overnight S&P 500, Nasdaq and the Nifty 50 set the market regime.",
  "Each stock must trade above its 20-day average with RSI 55–72 and volume above 1.5x its 20-day average.",
  "Survivors get the last 24 hours of Google News headlines.",
  "Gemini ranks the top 2–3 without ever seeing or writing a price.",
  "Code sets the buy zone (price to +0.15 ATR), target (+2.5 ATR) and stop-loss (−1.5 ATR).",
];

export function HowItWorks() {
  return (
    <details className="group mt-6 rounded-xl border border-line/70 bg-panel/60">
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
