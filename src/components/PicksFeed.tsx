"use client";

import { CircleAlert, Clock, FlaskConical, RefreshCw, SearchX } from "lucide-react";
import { BoardSection } from "./BoardSection";
import { PickCard } from "./PickCard";
import { signedPct } from "@/lib/format";
import { formatDayHeading, istDateKey, isNseSessionOpen } from "@/lib/time";
import type { ScanResult } from "@/lib/types";

interface Props {
  scan: ScanResult | null;
  scanning: boolean;
  error: string | null;
  onScan: () => void;
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

function IndexStrip({ scan }: { scan: ScanResult }) {
  return (
    <dl className="mt-4 grid grid-cols-3 gap-2">
      {scan.market.indices.map((i) => (
        <div key={i.symbol} className="min-w-0 rounded-xl border border-line/70 px-3 py-2">
          <dt className="truncate text-[11px] text-muted">{i.label}</dt>
          <dd className={`num mt-0.5 text-[15px] font-semibold ${i.changePct >= 0 ? "text-bull" : "text-bear"}`}>
            {signedPct(i.changePct)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Which NSE session the data reflects, in plain words. */
function sessionNote(scan: ScanResult, now = new Date()): string {
  const nifty = scan.market.indices.find((i) => i.symbol === "^NSEI");
  const session = nifty ? new Date(nifty.sessionDate) : new Date(scan.scanned_at_iso);
  const sessionIsToday = istDateKey(session) === istDateKey(now);
  if (isNseSessionOpen(now)) {
    return sessionIsToday
      ? "NSE is open. Prices are live and can lag the exchange by a few minutes."
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

export function PicksFeed({ scan, scanning, error, onScan }: Props) {
  const showSkeleton = scanning && !scan;
  const isDemo = scan?.mode === "demo";
  const isSimulated = scan?.simulated === true;

  return (
    <section className="px-4 pt-5" aria-busy={scanning}>
      <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.01em] text-fg">
        Today&apos;s High-Conviction Picks
      </h1>
      {scan ? (
        <p className="mt-1 text-[13px] leading-snug text-muted">
          {scan.shortlist_size} of {scan.universe_size} stocks cleared the filter. {engineLabel(scan)}.
          {scan.cache ? ` Market data refreshes every ${Math.round(scan.cache.refresh_seconds / 60)} min.` : null}
        </p>
      ) : (
        <p className="mt-1 text-[13px] text-muted">
          {scanning ? "Reading global cues and scanning the watchlist…" : "Run a scan to see today's setups."}
        </p>
      )}

      {scan && !isDemo ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
          <Clock size={13} className="shrink-0" aria-hidden />
          {sessionNote(scan)}
        </p>
      ) : null}

      {scan ? <IndexStrip scan={scan} /> : null}

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

      <div className="mt-4 space-y-4">
        {showSkeleton ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : null}

        {scan && scan.picks.length > 0
          ? scan.picks.map((p, i) => <PickCard key={`${scan.id}-${p.symbol}`} pick={p} engine={scan.engine} index={i} />)
          : null}

        {scan && scan.picks.length === 0 && !scanning ? (
          <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
            <SearchX size={28} className="mx-auto text-faint" aria-hidden />
            <p className="mt-3 text-[15px] font-semibold text-fg">No stock cleared today&apos;s filter</p>
            <p className="mx-auto mt-1.5 max-w-[30ch] text-[13px] leading-snug text-muted">
              The screen needs price above the 20-EMA, RSI between 55 and 72 and volume above 1.5x. Try again after the
              next session closes.
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

      {scan?.board && scan.board.length > 0 ? (
        <BoardSection
          board={scan.board}
          scanned={scan.board_scanned ?? scan.universe_size}
          pickSymbols={new Set(scan.picks.map((p) => p.symbol))}
        />
      ) : null}

      <p className="mt-6 pb-2 text-[11.5px] leading-relaxed text-faint">
        PulseAlpha is a screening tool for research and education, not investment advice or a SEBI-registered research
        service. Setups can fail; size positions so a stop-loss hit is affordable, and verify prices with your broker
        before trading.
      </p>
    </section>
  );
}
