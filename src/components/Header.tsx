"use client";

import { Globe, RefreshCw } from "lucide-react";
import { Logo } from "./Logo";
import { formatLastScan } from "@/lib/time";
import type { Regime } from "@/lib/types";

const REGIME_STYLE: Record<Regime, { dot: string; text: string; ring: string }> = {
  Bullish: { dot: "bg-bull", text: "text-bull", ring: "border-bull/35 bg-bull/10" },
  Neutral: { dot: "bg-caution", text: "text-caution", ring: "border-caution/35 bg-caution/10" },
  Bearish: { dot: "bg-bear", text: "text-bear", ring: "border-bear/35 bg-bear/10" },
};

interface Props {
  scanning: boolean;
  scannedAtIso: string | null;
  regime: Regime | null;
  onScan: () => void;
}

export function Header({ scanning, scannedAtIso, regime, onScan }: Props) {
  const style = regime ? REGIME_STYLE[regime] : null;
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-ink/90 pt-safe backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <Logo />
        <button
          type="button"
          onClick={onScan}
          disabled={scanning}
          aria-label={scanning ? "Scanning the market" : "Scan Market Now"}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-bull px-3.5 text-[13px] font-semibold text-ink transition-[transform,opacity] active:scale-95 disabled:opacity-70 max-[359px]:px-3"
        >
          <RefreshCw size={15} strokeWidth={2.5} className={scanning ? "animate-spin" : ""} aria-hidden />
          {scanning ? (
            "Scanning…"
          ) : (
            <>
              <span className="max-[359px]:hidden">Scan Market Now</span>
              <span className="hidden max-[359px]:inline">Scan Now</span>
            </>
          )}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 pb-2.5">
        <p className="min-w-0 truncate text-[12px] text-muted max-[359px]:text-[11px]">
          Last Scan:{" "}
          <span className="num text-fg">{scannedAtIso ? formatLastScan(new Date(scannedAtIso)) : "—"}</span>
        </p>
        {style && regime ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${style.ring} ${style.text}`}
            title="US (S&P 500, Nasdaq) + Nifty 50 sentiment"
          >
            <Globe size={12} strokeWidth={2.5} aria-hidden />
            {regime}
          </span>
        ) : null}
      </div>

      {/* The one ambient motion in the app: a pulse that sweeps while a scan runs. */}
      <div className="relative h-0.5 overflow-hidden" aria-hidden>
        {scanning ? (
          <div className="absolute inset-y-0 left-0 w-2/5 animate-sweep bg-gradient-to-r from-transparent via-bull to-transparent" />
        ) : null}
      </div>
    </header>
  );
}
