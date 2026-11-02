"use client";

import { useId, useState } from "react";
import { Activity, ChevronDown, Clock, ExternalLink, Globe, Newspaper, Zap } from "lucide-react";
import { LiveBadge, Ticking } from "./LivePrice";
import { StockChart } from "./StockChart";
import { planStatus } from "@/lib/live-pure";
import { plain, rupees, signedPct } from "@/lib/format";
import { useIsWide } from "./useIsDesktop";
import { formatBadge, formatClock } from "@/lib/time";
import type { Engine, LiveQuote, Pick } from "@/lib/types";

interface Props {
  pick: Pick;
  engine: Engine;
  index: number;
  /** Latest price, refreshed every ~20 s while the market is open. */
  live?: LiveQuote;
}

const STATUS_STYLE = {
  bull: "border-bull/35 bg-bull/10 text-bull",
  bear: "border-bear/35 bg-bear/10 text-bear",
  caution: "border-caution/35 bg-caution/10 text-caution",
  neutral: "border-line bg-ink/40 text-muted",
} as const;

function Level({
  label,
  shortLabel,
  value,
  sub,
  tone,
}: {
  label: string;
  shortLabel?: string;
  value: string;
  sub: string;
  tone: "neutral" | "bull" | "bear";
}) {
  const color = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-fg";
  return (
    <div className="min-w-0 px-2.5 py-2.5 max-[359px]:px-2">
      <p className="truncate text-[11px] text-muted">
        <span className={shortLabel ? "max-[359px]:hidden" : ""}>{label}</span>
        {shortLabel ? <span className="hidden max-[359px]:inline">{shortLabel}</span> : null}
      </p>
      <p className={`num mt-1 truncate text-[14px] font-semibold leading-tight max-[359px]:text-[12.5px] ${color}`}>
        {value}
      </p>
      <p className={`num mt-0.5 truncate text-[11.5px] ${tone === "neutral" ? "text-muted" : color} ${tone === "neutral" ? "" : "opacity-85"}`}>
        {sub}
      </p>
    </div>
  );
}

export function PickCard({ pick, engine, index, live }: Props) {
  const [open, setOpen] = useState(false);
  const wide = useIsWide();
  // On a wide screen there is room for the research next to the chart, so it is simply shown.
  const expanded = open || wide;
  const panelId = useId();
  const detected = new Date(pick.detected_at_iso);
  const { levels, metrics } = pick;
  const price = live?.price ?? pick.current_price;
  const change = live?.change_pct ?? pick.day_change_pct;
  const up = change >= 0;
  const status = live ? planStatus(live.price, levels) : null;

  const bullets = [
    { icon: Globe, title: "Global & sector cues", body: pick.breakdown.global_cue },
    { icon: Activity, title: "Technical trigger", body: pick.breakdown.technical_trigger },
    { icon: Newspaper, title: "News catalyst", body: pick.breakdown.news_catalyst },
  ];

  return (
    <article
      id={`pick-${pick.symbol}`}
      className="animate-rise scroll-mt-24 overflow-hidden rounded-2xl border border-line/80 bg-panel xl:grid xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
      style={{ animationDelay: `${index * 70}ms` }}
      aria-label={`${pick.symbol}, ${pick.name}`}
    >
      <div className="px-4 pt-4 xl:min-w-0 xl:p-5">
        {/* Top row: ticker, name, detection badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3
              className="font-ticker truncate text-[30px] font-bold leading-none tracking-[0.01em] text-fg"
              aria-label={`Rank ${pick.rank}: ${pick.symbol}`}
            >
              {pick.symbol}
            </h3>
            <p className="mt-1.5 truncate text-[13px] text-muted">
              {pick.name} <span className="text-faint">/ {pick.sector}</span>
            </p>
          </div>
          <time
            dateTime={pick.detected_at_iso}
            title={pick.detected_at}
            className="num inline-flex shrink-0 items-center gap-1 rounded-md bg-paper px-2 py-1 text-[12px] font-semibold text-ink"
          >
            <Clock size={12} strokeWidth={2.5} aria-hidden />
            {formatBadge(detected)}
          </time>
        </div>

        {/* Live price */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <p className="num text-[22px] font-semibold leading-none text-fg">
            <Ticking value={price}>{rupees(price)}</Ticking>{" "}
            <span className={`text-[14px] font-medium ${up ? "text-bull" : "text-bear"}`}>{signedPct(change)}</span>
          </p>
          {live ? (
            <LiveBadge quote={live} />
          ) : (
            <span className="num text-[11.5px] text-faint">Price at detection</span>
          )}
        </div>
        {status ? (
          <p className={`mt-2 inline-flex items-center rounded-md border px-2 py-0.5 text-[12px] font-semibold ${STATUS_STYLE[status.tone]}`}>
            {status.label}
          </p>
        ) : null}

        <StockChart symbol={pick.symbol} levels={levels} live={live} height={wide ? 250 : 172} />
      </div>

      {/* Phone: this block simply continues the card. Desktop: it is the right-hand column. */}
      <div className="xl:flex xl:min-w-0 xl:flex-col xl:border-l xl:border-line/80">
      {/* Trade plan: one segmented box so it reads as a single plan */}
      <div className="mx-4 mt-3.5 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-ink/55 xl:mx-5 xl:mt-5">
        <Level label="Buy zone" value={rupees(levels.entry_low)} sub={`to ${plain(levels.entry_high)}`} tone="neutral" />
        <Level label="Target" value={rupees(levels.target_price)} sub={signedPct(levels.target_pct)} tone="bull" />
        <Level label="Safe stop-loss" shortLabel="Stop-loss" value={rupees(levels.stop_loss)} sub={signedPct(levels.stop_pct)} tone="bear" />
      </div>

      {/* Catalyst */}
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-bull/25 bg-bull/10 px-3 py-2 xl:mx-5 xl:items-start">
        <Zap size={14} className="shrink-0 text-bull xl:mt-0.5" fill="currentColor" aria-hidden />
        <p className="truncate text-[13px] font-medium text-fg xl:overflow-visible xl:whitespace-normal" title={pick.catalyst}>
          {pick.catalyst}
        </p>
      </div>

      {/* Collapsible research (always open on desktop) */}
      {wide ? (
        <div className="mt-4 flex w-full items-center justify-between gap-3 border-t border-line/80 px-5 pb-1 pt-4">
          <h4 className="text-[13px] font-semibold text-fg">{engine === "gemini" ? "AI Research Breakdown" : "Research Breakdown"}</h4>
          <span className="num text-[12px] text-muted">Conviction {pick.conviction}</span>
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="mt-3 flex w-full items-center justify-between gap-3 border-t border-line/80 px-4 py-3 text-left"
        >
          <span className="text-[13px] font-semibold text-fg">
            {engine === "gemini" ? "AI Research Breakdown" : "Research Breakdown"}
          </span>
          <span className="flex items-center gap-2 text-[12px] text-muted">
            <span className="num">Conviction {pick.conviction}</span>
            <ChevronDown
              size={16}
              className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
          </span>
        </button>
      )}

      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden" inert={!expanded}>
          <ul className="space-y-3 px-4 pb-1 xl:px-5 xl:pt-1.5">
            {bullets.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-2.5">
                <Icon size={15} className="mt-0.5 shrink-0 text-bull" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-muted">{title}</p>
                  <p className="mt-0.5 text-[13.5px] leading-snug text-fg">{body}</p>
                </div>
              </li>
            ))}
          </ul>

          <dl className="mx-4 mt-3.5 grid grid-cols-4 xl:mx-5 gap-px overflow-hidden rounded-lg bg-line text-center">
            {[
              ["RSI 14", metrics.rsi14.toFixed(1)],
              ["Volume", `${metrics.volume_ratio.toFixed(2)}x`],
              ["20-EMA", plain(metrics.ema20)],
              ["ATR 14", plain(metrics.atr14)],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0 bg-panel-2 px-1 py-2">
                <dt className="text-[10.5px] text-muted">{k}</dt>
                <dd className="num mt-0.5 truncate text-[12.5px] font-semibold text-fg">{v}</dd>
              </div>
            ))}
          </dl>

          {pick.news.length > 0 ? (
            <ul className="mx-4 mt-3 space-y-1.5 xl:mx-5">
              {pick.news.slice(0, 3).map((n) => (
                <li key={n.link}>
                  <a
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-1.5 text-[12.5px] leading-snug text-muted hover:text-fg"
                  >
                    <ExternalLink size={12} className="mt-0.5 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                      {n.title}
                      <span className="text-faint">
                        {" "}
                        — {n.source || "Google News"}, {formatClock(new Date(n.publishedAt))}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mx-4 mb-4 mt-3 text-[11.5px] leading-snug text-faint xl:mx-5 xl:mb-0">
            Levels are computed in code from the price and 14-day ATR: buy zone up to +0.15 ATR, target +2.5 ATR,
            stop −1.5 ATR.
          </p>
        </div>
      </div>
      </div>
    </article>
  );
}
