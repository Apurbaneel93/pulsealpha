"use client";

import { useId, useState } from "react";
import { Activity, ChevronDown, Clock, ExternalLink, Globe, Newspaper, Zap } from "lucide-react";
import { Sparkline } from "./Sparkline";
import { plain, rupees, signedPct } from "@/lib/format";
import { formatBadge, formatClock } from "@/lib/time";
import type { Engine, Pick } from "@/lib/types";

interface Props {
  pick: Pick;
  engine: Engine;
  index: number;
}

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

export function PickCard({ pick, engine, index }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const detected = new Date(pick.detected_at_iso);
  const { levels, metrics } = pick;
  const up = pick.day_change_pct >= 0;

  const bullets = [
    { icon: Globe, title: "Global & sector cues", body: pick.breakdown.global_cue },
    { icon: Activity, title: "Technical trigger", body: pick.breakdown.technical_trigger },
    { icon: Newspaper, title: "News catalyst", body: pick.breakdown.news_catalyst },
  ];

  return (
    <article
      className="animate-rise overflow-hidden rounded-2xl border border-line/80 bg-panel"
      style={{ animationDelay: `${index * 70}ms` }}
      aria-label={`${pick.symbol}, ${pick.name}`}
    >
      <div className="px-4 pt-4">
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

        {/* Price + trend */}
        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="num text-[18px] font-semibold leading-none text-fg">
            {rupees(pick.current_price)}{" "}
            <span className={`text-[13px] font-medium ${up ? "text-bull" : "text-bear"}`}>
              {signedPct(pick.day_change_pct)}
            </span>
          </p>
          <Sparkline values={pick.spark} className="h-[31px] w-24 shrink-0 overflow-visible" />
        </div>
      </div>

      {/* Trade plan: one segmented box so it reads as a single plan */}
      <div className="mx-4 mt-3.5 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-ink/55">
        <Level label="Buy zone" value={rupees(levels.entry_low)} sub={`to ${plain(levels.entry_high)}`} tone="neutral" />
        <Level label="Target" value={rupees(levels.target_price)} sub={signedPct(levels.target_pct)} tone="bull" />
        <Level label="Safe stop-loss" shortLabel="Stop-loss" value={rupees(levels.stop_loss)} sub={signedPct(levels.stop_pct)} tone="bear" />
      </div>

      {/* Catalyst */}
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-bull/25 bg-bull/10 px-3 py-2">
        <Zap size={14} className="shrink-0 text-bull" fill="currentColor" aria-hidden />
        <p className="truncate text-[13px] font-medium text-fg" title={pick.catalyst}>
          {pick.catalyst}
        </p>
      </div>

      {/* Collapsible research */}
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

      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden" inert={!open}>
          <ul className="space-y-3 px-4 pb-1">
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

          <dl className="mx-4 mt-3.5 grid grid-cols-4 gap-px overflow-hidden rounded-lg bg-line text-center">
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
            <ul className="mx-4 mt-3 space-y-1.5">
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

          <p className="mx-4 mb-4 mt-3 text-[11.5px] leading-snug text-faint">
            Levels are computed in code from the price and 14-day ATR: buy zone up to +0.15 ATR, target +2.5 ATR,
            stop −1.5 ATR.
          </p>
        </div>
      </div>
    </article>
  );
}
