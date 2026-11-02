"use client";

import { Globe, RefreshCw } from "lucide-react";
import { visibleTabs, type Tab } from "./BottomNav";
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
  tab: Tab;
  onTabChange: (t: Tab) => void;
  owner: boolean;
}

/**
 * Phone: logo and scan button on one row, last-scan time and market regime on the
 * next, with the tabs in the bottom bar. Desktop (lg): one row — logo, tabs, then
 * last scan, regime and the scan button on the right. The two phone rows use
 * `lg:contents` so their children become items of the one desktop row.
 */
export function Header({ scanning, scannedAtIso, regime, onScan, tab, onTabChange, owner }: Props) {
  const style = regime ? REGIME_STYLE[regime] : null;
  const tabs = visibleTabs(owner);
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-ink/90 pt-safe backdrop-blur-md">
      <div className="mx-auto lg:flex lg:h-16 lg:max-w-[1320px] lg:items-center lg:gap-6 lg:px-8 xl:gap-8">
        <div className="flex h-14 items-center justify-between gap-3 px-4 lg:contents">
          <div className="lg:order-1">
            <Logo />
          </div>
          <button
            type="button"
            onClick={onScan}
            disabled={scanning}
            aria-label={scanning ? "Scanning the market" : "Scan Market Now"}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-bull px-3.5 text-[13px] font-semibold text-ink transition-[transform,opacity] hover:brightness-110 active:scale-95 disabled:opacity-70 max-[359px]:px-3 lg:order-5 lg:px-4"
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

        <nav className="hidden lg:order-2 lg:flex lg:items-center lg:gap-1" aria-label="Primary">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = id === tab;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onTabChange(id)}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-[13.5px] font-medium transition-colors ${
                  active ? "bg-bull/10 text-bull" : "text-muted hover:bg-panel hover:text-fg"
                }`}
              >
                <Icon size={16} strokeWidth={active ? 2.4 : 1.9} aria-hidden />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center justify-between gap-2 px-4 pb-2.5 lg:contents">
          <p className="min-w-0 truncate text-[12px] text-muted max-[359px]:text-[11px] lg:order-3 lg:ml-auto lg:flex lg:flex-col lg:items-end lg:overflow-visible lg:whitespace-nowrap lg:leading-tight">
            <span className="lg:text-[11px]">Last Scan:</span>{" "}
            <span className="num text-fg lg:text-[12.5px]">{scannedAtIso ? formatLastScan(new Date(scannedAtIso)) : "—"}</span>
          </p>
          {style && regime ? (
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold lg:order-4 ${style.ring} ${style.text}`}
              title="US (S&P 500, Nasdaq) + Nifty 50 sentiment"
            >
              <Globe size={12} strokeWidth={2.5} aria-hidden />
              {regime}
            </span>
          ) : null}
        </div>
      </div>

      {/* The one ambient motion in the app: a pulse that sweeps while a scan runs. */}
      <div className="relative h-0.5 overflow-hidden lg:absolute lg:inset-x-0 lg:bottom-0" aria-hidden>
        {scanning ? (
          <div className="absolute inset-y-0 left-0 w-2/5 animate-sweep bg-gradient-to-r from-transparent via-bull to-transparent" />
        ) : null}
      </div>
    </header>
  );
}
