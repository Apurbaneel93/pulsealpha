"use client";

import { CircleAlert, Clock, FlaskConical, RefreshCw, SearchX } from "lucide-react";
import { BoardSection } from "./BoardSection";
import { HowItWorks } from "./HowItWorks";
import { PickCard } from "./PickCard";
import { StockChart } from "./StockChart";
import { Ticking } from "./LivePrice";
import { useIsDesktop } from "./useIsDesktop";
import { rupees, signedPct } from "@/lib/format";
import { formatDayHeading, istDateKey, isNseSessionOpen } from "@/lib/time";
import { planStatus, quoteLagSeconds } from "@/lib/live-pure";
import { HARD_FILTER } from "@/lib/rules-engine";
import type { LiveQuote, ScanResult } from "@/lib/types";

interface Props {
  scan: ScanResult | null;
  scanning: boolean;
  error: string | null;
  onScan: () => void;
  /** Owner sign-in is configured and this visitor isn't signed in: show the quiet footer link. */
  showOwnerLink: boolean;
  /** Live prices by symbol (picks, top of the ranking, ^NSEI). Empty when closed or simulated. */
  quotes: Record<string, LiveQuote>;
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-line/60 bg-panel p-4" aria-hidden>
      <div className="flex justify-between">
        <div className="space-y-2">
          <div className="h-7 w-28 rounded bg-line/70" />
          <div className="h-3.5 w-40 rounded bg-line/50" />
        </div>
        <div className="h-6 w-28 rounded-md bg-line/60" />
      </div>
      <div className="mt-4 h-5 w-32 rounded bg-line/50" />
      <div className="mt-4 h-[74px] rounded-xl bg-line/40" />
      <div className="mt-3 h-9 rounded-lg bg-line/40" />
    </div>
  );
}

function IndexStrip({ scan, quotes }: { scan: ScanResult; quotes: Record<string, LiveQuote> }) {
  return (
    <dl className="mt-4 grid grid-cols-3 gap-2 lg:mt-3 lg:grid-cols-1 lg:gap-0">
      {scan.market.indices.map((i) => {
        const live = quotes[i.symbol];
        const pct = live?.change_pct ?? i.changePct;
        return (
          <div
            key={i.symbol}
            className="min-w-0 rounded-xl border border-line/70 px-3 py-2 lg:flex lg:items-center lg:justify-between lg:gap-3 lg:rounded-none lg:border-0 lg:border-b lg:border-line/60 lg:px-0 lg:py-2.5 lg:last:border-b-0"
          >
            <dt className="truncate text-[11px] text-muted lg:text-[13px]">{i.label}</dt>
            <dd className={`num mt-0.5 text-[15px] font-semibold lg:mt-0 lg:text-[15px] ${pct >= 0 ? "text-bull" : "text-bear"}`}>
              {signedPct(pct)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Scroll to a pick card from the sidebar, without the symbol ever touching a URL fragment. */
function jumpToPick(symbol: string) {
  const el = document.getElementById(`pick-${symbol}`);
  if (!el) return;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
}

/**
 * Phone: just the three index tiles. Desktop: a sticky sidebar that keeps the
 * market and the day's picks in view while the long pick cards scroll past.
 */
function MarketPanel({ scan, quotes }: { scan: ScanResult; quotes: Record<string, LiveQuote> }) {
  const desktop = useIsDesktop();
  const realPrices = scan.mode === "live" && !scan.simulated;
  return (
    <aside
      aria-label="Market overview"
      className="lg:sticky lg:top-24 lg:col-span-4 lg:col-start-9 lg:row-span-3 lg:row-start-1 lg:max-h-[calc(100dvh-7.5rem)] lg:self-start lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-line/80 lg:bg-panel lg:p-4"
    >
      <h2 className="hidden text-[13px] font-semibold text-fg lg:block">Market now</h2>
      <IndexStrip scan={scan} quotes={quotes} />

      {desktop && realPrices ? (
        <div className="mt-3 border-t border-line/60 pt-3">
          <p className="text-[12px] text-muted">Nifty 50</p>
          <StockChart symbol="^NSEI" live={quotes["^NSEI"]} height={150} />
        </div>
      ) : null}

      {desktop && scan.picks.length > 0 ? (
        <div className="mt-3 border-t border-line/60 pt-3">
          <h2 className="text-[13px] font-semibold text-fg">Today&apos;s picks</h2>
          <ul className="mt-1.5">
            {scan.picks.map((p) => {
              const live = quotes[p.symbol];
              const price = live?.price ?? p.current_price;
              const change = live?.change_pct ?? p.day_change_pct;
              const status = live ? planStatus(live.price, p.levels) : null;
              return (
                <li key={p.symbol}>
                  <button
                    type="button"
                    onClick={() => jumpToPick(p.symbol)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ink/60"
                    aria-label={`Go to ${p.symbol}`}
                  >
                    <span className="min-w-0">
                      <span className="font-ticker block truncate text-[18px] font-bold leading-none text-fg">{p.symbol}</span>
                      {status ? <span className="mt-1 block truncate text-[11.5px] text-muted">{status.label}</span> : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-[13.5px] font-semibold text-fg">
                        <Ticking value={price}>{rupees(price)}</Ticking>
                      </span>
                      <span className={`num block text-[11.5px] ${change >= 0 ? "text-bull" : "text-bear"}`}>{signedPct(change)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

/** Which NSE session the data reflects, in plain words. */
function sessionNote(scan: ScanResult, now = new Date()): string {
  const nifty = scan.market.indices.find((i) => i.symbol === "^NSEI");
  const session = nifty ? new Date(nifty.sessionDate) : new Date(scan.scanned_at_iso);
  const sessionIsToday = istDateKey(session) === istDateKey(now);
  if (isNseSessionOpen(now)) {
    return sessionIsToday
      ? "NSE is open."
      : `No trading data for today yet (holiday or delayed feed). Showing the ${formatDayHeading(session)} session.`;
  }
  return `NSE is closed. Showing the ${formatDayHeading(session)} session.`;
}

function engineLabel(scan: ScanResult): string {
  if (scan.engine === "gemini") {
    const m = scan.model ?? "Gemini";
    return `Ranked by ${m.replace(/^gemini-/, "Gemini ").replace(/-/g, " ")}`;
  }
  return "Ranked by the rules engine";
}

export function PicksFeed({ scan, scanning, error, onScan, showOwnerLink, quotes }: Props) {
  const showSkeleton = scanning && !scan;
  const isDemo = scan?.mode === "demo";
  const isSimulated = scan?.simulated === true;
  const niftyLive = quotes["^NSEI"];

  return (
    <section className="px-4 pt-5 lg:px-0 lg:pt-8" aria-busy={scanning}>
      <div className="lg:grid lg:grid-cols-12 lg:gap-x-8">
        <div className="lg:col-span-8">
          <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.01em] text-fg lg:text-[28px]">
            Today&apos;s High-Conviction Picks
          </h1>
          {scan ? (
            <p className="mt-1 text-[13px] leading-snug text-muted lg:text-[14px]">
              {scan.shortlist_size} of {scan.universe_size} stocks cleared the momentum screen. {engineLabel(scan)}.
              {scan.cache ? ` Market data refreshes every ${Math.round(scan.cache.refresh_seconds / 60)} min.` : null}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-muted lg:text-[14px]">
              {scanning ? "Reading global cues and scanning the watchlist…" : "Run a scan to see today's setups."}
            </p>
          )}

          {scan?.regime_summary ? (
            <p className="mt-2 text-[13px] leading-snug text-fg lg:text-[14px]">
              <span className="font-semibold text-muted">Market read: </span>
              {scan.regime_summary}
            </p>
          ) : null}

          {scan && !isDemo ? (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-muted lg:text-[12.5px]">
              <Clock size={13} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {sessionNote(scan)}
                {isNseSessionOpen(new Date())
                  ? Object.keys(quotes).length > 0
                    ? " Prices update about every 20 seconds from Yahoo Finance."
                    : " Prices come from Yahoo Finance and can trail the exchange."
                  : ""}
              </span>
            </p>
          ) : null}
          {scan && !isDemo && niftyLive && isNseSessionOpen(new Date()) && quoteLagSeconds(niftyLive, new Date()) > 300 ? (
            <p className="mt-1.5 text-[12px] leading-snug text-caution">
              Yahoo Finance is about {Math.round(quoteLagSeconds(niftyLive, new Date()) / 60)} minutes behind the exchange right
              now, so prices here trail Groww or your broker by that much.
            </p>
          ) : null}
        </div>

        {scan ? <MarketPanel scan={scan} quotes={quotes} /> : null}

        <div className="lg:col-span-8">
          {isDemo || isSimulated ? (
            <div className="mt-4 flex gap-2.5 rounded-xl border border-caution/30 bg-caution/10 px-3.5 py-3 text-[13px] leading-snug">
              <FlaskConical size={16} className="mt-0.5 shrink-0 text-caution" aria-hidden />
              <div className="min-w-0">
                <p className="text-fg">
                  {isDemo
                    ? "Demo mode: prices are simulated, not live quotes. Switch to live data in API Setup."
                    : "Live feed was unavailable, so these cards use simulated prices. Do not trade on them."}
                </p>
                {isSimulated && scan?.notice ? (
                  <p className="mt-1 break-words text-[12px] text-muted">{scan.notice}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {scan?.notice && !isDemo && !isSimulated ? (
            <div className="mt-3 flex gap-2.5 rounded-xl border border-line px-3.5 py-3 text-[12.5px] leading-snug text-muted">
              <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              <p>{scan.notice}</p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 flex gap-2.5 rounded-xl border border-bear/35 bg-bear/10 px-3.5 py-3 text-[13px] leading-snug" role="alert">
              <CircleAlert size={16} className="mt-0.5 shrink-0 text-bear" aria-hidden />
              <p className="text-fg">{error}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-4 space-y-4 lg:col-span-8 lg:space-y-5">
          {showSkeleton ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : null}

          {scan && scan.picks.length > 0
            ? scan.picks.map((p, i) => <PickCard key={`${scan.id}-${p.symbol}`} pick={p} engine={scan.engine} index={i} live={quotes[p.symbol]} />)
            : null}

          {scan && scan.picks.length === 0 && !scanning ? (
            <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
              <SearchX size={28} className="mx-auto text-faint" aria-hidden />
              <p className="mt-3 text-[15px] font-semibold text-fg">No stock cleared today&apos;s screen</p>
              <p className="mx-auto mt-1.5 max-w-[34ch] text-[13px] leading-snug text-muted lg:max-w-[52ch]">
                The screen wants a stock just above its 20-day average (not more than {HARD_FILTER.maxExtensionPct}% over it), RSI between{" "}
                {HARD_FILTER.rsiMin} and {HARD_FILTER.rsiMax}, a quiet prior day, enough volatility and {HARD_FILTER.volumeRatioMin}x volume.
                Some days nothing qualifies, and no pick is better than a forced one. Try again after the next session.
              </p>
              <button
                type="button"
                onClick={onScan}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[13px] font-semibold text-fg"
              >
                <RefreshCw size={14} aria-hidden />
                Scan Market Now
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {scan?.board && scan.board.length > 0 ? (
        <BoardSection
          board={scan.board}
          scanned={scan.board_scanned ?? scan.universe_size}
          pickSymbols={new Set(scan.picks.map((p) => p.symbol))}
          quotes={quotes}
        />
      ) : null}

      <div className="lg:mt-10 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
        <HowItWorks className="mt-6 lg:mt-0" />

        <p className="mt-6 pb-2 text-[11.5px] leading-relaxed text-faint lg:mt-0 lg:text-[12px]">
          PulseAlpha is a screening tool for research and education, not investment advice or a SEBI-registered research
          service. Setups can fail; size positions so a stop-loss hit is affordable, and verify prices with your broker
          before trading.
          {showOwnerLink ? (
            <>
              {" "}
              <a href="/owner" className="underline decoration-line underline-offset-2">
                Owner sign-in
              </a>
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}
