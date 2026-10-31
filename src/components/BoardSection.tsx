"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { computeLevels } from "@/lib/levels";
import { plain, rupees, signedPct } from "@/lib/format";
import type { BoardRow } from "@/lib/types";

const INITIAL_ROWS = 12;

const CHECK_LABELS = {
  trend: "Above 20-day average",
  rsi: "RSI between 55 and 72",
  volume: "Volume above 1.5x average",
} as const;

function CheckDots({ row }: { row: BoardRow }) {
  const order = ["trend", "rsi", "volume"] as const;
  const passedNames = order.filter((k) => row.checks[k]).map((k) => CHECK_LABELS[k].toLowerCase());
  return (
    <span className="flex justify-end gap-1" role="img" aria-label={`Passes ${row.passed} of 3 checks: ${passedNames.join(", ")}`}>
      {order.map((k) => (
        <span
          key={k}
          className={`size-[7px] rounded-full ${row.checks[k] ? "bg-bull" : "border border-faint"}`}
          aria-hidden
        />
      ))}
    </span>
  );
}

function Detail({ row }: { row: BoardRow }) {
  const missing = (["rsi", "volume"] as const).filter((k) => !row.checks[k]);
  const values = {
    trend: `${signedPct(row.pct_above_ema20, 1)} vs 20-day average`,
    rsi: `RSI ${row.rsi14.toFixed(1)}`,
    volume: `${row.volume_ratio.toFixed(2)}x average volume`,
  };
  const lv = computeLevels(row.price, row.atr14);
  return (
    <div className="px-3.5 pb-3.5">
      <ul className="space-y-1.5">
        {(["trend", "rsi", "volume"] as const).map((k) => (
          <li key={k} className="flex items-start gap-2 text-[12.5px] leading-snug">
            {row.checks[k] ? (
              <Check size={14} className="mt-px shrink-0 text-bull" aria-label="Pass" />
            ) : (
              <X size={14} className="mt-px shrink-0 text-bear" aria-label="Not yet" />
            )}
            <span className="min-w-0">
              <span className="text-fg">{CHECK_LABELS[k]}</span>
              <span className="text-muted">: {values[k]}</span>
            </span>
          </li>
        ))}
      </ul>
      {row.passed === 3 ? (
        <div className="mt-3 grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-ink/55 text-center">
          {[
            ["Buy zone", plain(lv.entry_low), `to ${plain(lv.entry_high)}`, "text-fg"],
            ["Target", plain(lv.target_price), signedPct(lv.target_pct), "text-bull"],
            ["Stop-loss", plain(lv.stop_loss), signedPct(lv.stop_pct), "text-bear"],
          ].map(([label, value, sub, color]) => (
            <div key={label} className="min-w-0 px-1.5 py-2">
              <p className="text-[10.5px] text-muted">{label}</p>
              <p className={`num mt-0.5 truncate text-[12px] font-semibold ${color}`}>{value}</p>
              <p className="num truncate text-[11px] text-muted">{sub}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2.5 text-[12px] leading-snug text-muted">
          Not a full setup yet. Still needs{" "}
          {missing.map((k) => CHECK_LABELS[k].toLowerCase()).join(" and ")}.
        </p>
      )}
      <p className="mt-2 text-[11.5px] text-faint">
        {row.sector}. 20-day average {row.ema20_above_ema50 ? "above" : "below"} the 50-day.
      </p>
    </div>
  );
}

function Row({ row, rank, isPick }: { row: BoardRow; rank: number; isPick: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const up = row.change_pct >= 0;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <span className="num w-5 shrink-0 text-[12px] text-faint">{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-ticker truncate text-[18px] font-bold leading-none text-fg">{row.symbol}</span>
            {isPick ? (
              <span className="shrink-0 rounded bg-bull/15 px-1.5 py-px text-[10.5px] font-semibold text-bull">Top pick</span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-[12px] text-muted">{row.name}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="num block text-[13.5px] font-semibold text-fg">{rupees(row.price)}</span>
          <span className={`num block text-[11.5px] ${up ? "text-bull" : "text-bear"}`}>{signedPct(row.change_pct)}</span>
        </span>
        <span className="w-[44px] shrink-0 text-right">
          <CheckDots row={row} />
          <span className="num mt-1.5 block text-[11px] text-muted">{row.score}</span>
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={id}>
          <Detail row={row} />
        </div>
      ) : null}
    </li>
  );
}

export function BoardSection({ board, scanned, pickSymbols }: { board: BoardRow[]; scanned: number; pickSymbols: Set<string> }) {
  const [showAll, setShowAll] = useState(false);
  if (board.length === 0) return null;
  const rows = showAll ? board : board.slice(0, INITIAL_ROWS);
  const full = board.filter((r) => r.passed === 3).length;
  return (
    <section className="mt-8" aria-labelledby="board-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="board-title" className="text-[17px] font-semibold tracking-[-0.01em] text-fg">
          Bullish ranking
        </h2>
        <span className="num shrink-0 text-[12px] text-muted">
          {board.length} of {scanned} stocks
        </span>
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-muted">
        Every stock above its 20-day average, ranked by setup checks passed, then bullish score.{" "}
        {full} pass all three. Tap a stock for details.
      </p>
      <div className="mt-2 flex items-center justify-end gap-3 text-[11px] text-faint" aria-hidden>
        <span className="flex items-center gap-1">
          <span className="size-[7px] rounded-full bg-bull" /> Check passed
        </span>
        <span>Score 1–99</span>
      </div>
      <ol className="mt-2 divide-y divide-line/70 overflow-hidden rounded-xl border border-line/70 bg-panel">
        {rows.map((r, i) => (
          <Row key={r.symbol} row={r} rank={i + 1} isPick={pickSymbols.has(r.symbol)} />
        ))}
      </ol>
      {board.length > INITIAL_ROWS ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 w-full rounded-xl border border-line px-4 py-2.5 text-[13px] font-semibold text-fg"
        >
          {showAll ? "Show fewer" : `Show all ${board.length}`}
        </button>
      ) : null}
    </section>
  );
}
