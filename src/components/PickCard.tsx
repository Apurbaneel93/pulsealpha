"use client";

import { useId, useState } from "react";
import { Activity, ChevronDown, Clock, ExternalLink, Globe, Lightbulb, ShieldAlert, ShieldCheck, TriangleAlert, Zap } from "lucide-react";
import { LiveBadge, Ticking } from "./LivePrice";
import { StockChart } from "./StockChart";
import { EXIT_PLAN, LEVEL_MULTIPLIERS } from "@/lib/levels";
import { planStatus } from "@/lib/live-pure";
import { plain, rupees, signedPct } from "@/lib/format";
import { useIsWide } from "./useIsDesktop";
import { formatBadge, formatClock } from "@/lib/time";
import type { CatalystFreshness, Engine, LiveQuote, Pick } from "@/lib/types";

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

const FRESHNESS_STYLE: Record<CatalystFreshness, string> = {
  "Unpriced Post-Market": "border-bull/35 bg-bull/10 text-bull",
  "Ongoing Multi-Day": "border-line bg-ink/40 text-muted",
  "Priced-In Recap": "border-caution/35 bg-caution/10 text-caution",
};

function PlanCell({
  label,
  value,
  sub,
  note,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  /** How this level is managed, e.g. "Book 60% & Trail SL to Breakeven". */
  note?: string;
  tone: "neutral" | "bull" | "bear";
}) {
  const color = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-fg";
  return (
    <div className="min-w-0 px-3 py-2.5 max-[359px]:px-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`num mt-1 truncate text-[15px] font-semibold leading-tight max-[359px]:text-[13.5px] ${color}`}>{value}</p>
      <p className={`num mt-0.5 truncate text-[11.5px] ${tone === "neutral" ? "text-muted" : `${color} opacity-85`}`}>{sub}</p>
      {note ? <p className="mt-1 text-[11px] leading-snug text-muted">{note}</p> : null}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="num inline-flex items-baseline gap-1 rounded-md border border-line bg-ink/40 px-2 py-1 text-[12px] leading-none">
      <span className="text-[10.5px] text-muted">{label}</span>
      <span className="font-semibold text-fg">{value}</span>
    </span>
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

  const waiting = levels.gap_status === "WAIT_FOR_PULLBACK";
  const gapText = `${levels.opening_gap_atr >= 0 ? "+" : "−"}${Math.abs(levels.opening_gap_atr).toFixed(2)} ATR`;

  const bullets = [
    { icon: Globe, title: "Market regime", body: pick.breakdown.global_cue },
    { icon: Activity, title: "Technical trigger", body: pick.breakdown.technical_trigger },
    { icon: Lightbulb, title: "Why it can expand today", body: pick.breakdown.thesis },
    { icon: TriangleAlert, title: "Execution risk", body: pick.execution_risk },
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


        {/* Gap Guard: is this a buy now, or a wait for a pullback? */}
        <div
          className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 ${
            waiting ? "border-caution/35 bg-caution/10" : "border-bull/30 bg-bull/[0.07]"
          }`}
        >
          {waiting ? (
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-caution" aria-hidden />
          ) : (
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-bull" aria-hidden />
          )}
          <div className="min-w-0">
            <p className={`text-[12.5px] font-semibold ${waiting ? "text-caution" : "text-bull"}`}>
              {waiting ? "Wait for pullback" : "Active buy zone"}
              <span className="num ml-1.5 inline-block whitespace-nowrap font-medium text-muted">Gap Guard · {gapText}</span>
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">
              {waiting
                ? `Already up more than ${LEVEL_MULTIPLIERS.gapGuard} ATR since the previous close. Don't chase: the buy zone sits at the previous close + ${LEVEL_MULTIPLIERS.pullbackAnchor} ATR, so wait for a dip into it.`
                : `Within ${LEVEL_MULTIPLIERS.gapGuard} ATR of the previous close, so the buy zone is built around the current price.`}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Setup metrics">
          <Pill label="ATR%" value={`${metrics.atr_pct.toFixed(1)}%`} />
          <Pill label="RVOL" value={`${metrics.volume_ratio.toFixed(1)}x`} />
          <Pill label="Coil Ratio" value={metrics.coil_ratio.toFixed(2)} />
        </div>

        <StockChart symbol={pick.symbol} levels={levels} live={live} height={wide ? 300 : 172} />
      </div>

      {/* Phone: this block simply continues the card. Desktop: it is the right-hand column. */}
      <div className="xl:flex xl:min-w-0 xl:flex-col xl:border-l xl:border-line/80">
      {/* Trade plan: one segmented box so it reads as a single plan */}
      <div className="mx-4 mt-3.5 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-xl border border-line bg-ink/55 xl:mx-5 xl:mt-5 [&>*:nth-child(-n+2)]:border-t-0">
        <PlanCell
          label={waiting ? "Buy zone (on pullback)" : "Buy zone"}
          value={rupees(levels.entry_low)}
          sub={`to ${plain(levels.entry_high)}`}
          tone="neutral"
        />
        <PlanCell label="Safe stop-loss" value={rupees(levels.stop_loss)} sub={`${signedPct(levels.stop_pct)} · −${LEVEL_MULTIPLIERS.stop.toFixed(2)} ATR`} tone="bear" />
        <PlanCell
          label="Target 1"
          value={rupees(levels.target_1)}
          sub={`${signedPct(levels.target_1_pct)} · +${LEVEL_MULTIPLIERS.target1.toFixed(2)} ATR`}
          note={EXIT_PLAN.target1}
          tone="bull"
        />
        <PlanCell
          label="Target 2"
          value={rupees(levels.target_2)}
          sub={`${signedPct(levels.target_2_pct)} · +${LEVEL_MULTIPLIERS.target2.toFixed(2)} ATR`}
          note={EXIT_PLAN.target2}
          tone="bull"
        />
      </div>

      {/* Catalyst */}
      <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-bull/25 bg-bull/10 px-3 py-2 xl:mx-5">
        <Zap size={14} className="shrink-0 text-bull" fill="currentColor" aria-hidden />
        <p className="min-w-0 text-[13px] font-medium text-fg">{pick.catalyst_category}</p>
        <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${FRESHNESS_STYLE[pick.catalyst_freshness]}`}>
          {pick.catalyst_freshness}
        </span>
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

          <dl className="mx-4 mt-3.5 grid grid-cols-4 gap-px overflow-hidden rounded-lg bg-line text-center xl:mx-5">
            {[
              ["RSI 14", metrics.rsi14.toFixed(1)],
              ["vs 20-DMA", `${metrics.sma20_extension_pct >= 0 ? "+" : ""}${metrics.sma20_extension_pct.toFixed(1)}%`],
              ["20-DMA", plain(metrics.sma20)],
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
            Levels are computed in code from the price, previous close and 14-day ATR: buy zone ±{LEVEL_MULTIPLIERS.entryBand.toFixed(2)} ATR, stop
            −{LEVEL_MULTIPLIERS.stop.toFixed(2)} ATR, Target 1 +{LEVEL_MULTIPLIERS.target1.toFixed(2)} ATR, Target 2 +
            {LEVEL_MULTIPLIERS.target2.toFixed(2)} ATR.
          </p>
        </div>
      </div>
      </div>
    </article>
  );
}
