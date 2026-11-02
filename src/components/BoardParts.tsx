"use client";

import { Check, X } from "lucide-react";
import { EXIT_PLAN, LEVEL_MULTIPLIERS, computeLevels } from "@/lib/levels";
import { HARD_FILTER } from "@/lib/rules-engine";
import { plain, signedPct } from "@/lib/format";
import { CHECK_KEYS, type BoardRow, type CheckKey, type PriceLevels } from "@/lib/types";

/** The six screening checks, worded from the same constants the screen runs on. */
export const CHECK_LABELS: Record<CheckKey, string> = {
  trend: "Above the 20-day average",
  extension: `No more than ${HARD_FILTER.maxExtensionPct}% above it`,
  rsi: `RSI between ${HARD_FILTER.rsiMin} and ${HARD_FILTER.rsiMax}`,
  coil: `Yesterday's range at most ${HARD_FILTER.maxCoilRatio}x ATR`,
  volatility: `ATR at least ${HARD_FILTER.minAtrPct}% of price`,
  volume: `Volume at least ${HARD_FILTER.volumeRatioMin}x average`,
};

/** Short names for the chips and for sentences like "Still needs RSI and volume". */
export const CHECK_SHORT: Record<CheckKey, string> = {
  trend: "Trend",
  extension: "Extension",
  rsi: "RSI",
  coil: "Coil",
  volatility: "ATR%",
  volume: "RVOL",
};

export function checkValues(row: BoardRow): Record<CheckKey, string> {
  return {
    trend: `${signedPct(row.sma20_extension_pct, 1)} vs 20-day average`,
    extension: `${signedPct(row.sma20_extension_pct, 1)} above`,
    rsi: `RSI ${row.rsi14.toFixed(1)}`,
    coil: `${row.coil_ratio.toFixed(2)}x ATR`,
    volatility: `${row.atr_pct.toFixed(1)}% of price`,
    volume: `${row.volume_ratio.toFixed(2)}x average`,
  };
}

export function missingChecks(row: BoardRow): CheckKey[] {
  return CHECK_KEYS.filter((k) => !row.checks[k]);
}

/** "RSI and ATR%" / "RSI, coil and ATR%". */
export function joinNames(keys: readonly CheckKey[]): string {
  const names = keys.map((k) => CHECK_SHORT[k]);
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function levelsForRow(row: BoardRow): PriceLevels {
  return computeLevels(row.price, row.prev_close, row.atr14);
}

export function CheckList({ row, size = 14 }: { row: BoardRow; size?: number }) {
  const values = checkValues(row);
  return (
    <ul className="space-y-1.5">
      {CHECK_KEYS.map((k) => (
        <li key={k} className="flex items-start gap-2 text-[12.5px] leading-snug lg:text-[13px]">
          {row.checks[k] ? (
            <Check size={size} className="mt-px shrink-0 text-bull" aria-label="Pass" />
          ) : (
            <X size={size} className="mt-px shrink-0 text-bear" aria-label="Not yet" />
          )}
          <span className="min-w-0">
            <span className="text-fg">{CHECK_LABELS[k]}</span>
            <span className="text-muted">: {values[k]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The trade plan for a full setup, in a compact 2×2 box. */
export function MiniPlan({ lv }: { lv: PriceLevels }) {
  const waiting = lv.gap_status === "WAIT_FOR_PULLBACK";
  const cells: Array<[string, string, string, string]> = [
    [waiting ? "Buy zone (pullback)" : "Buy zone", plain(lv.entry_low), `to ${plain(lv.entry_high)}`, "text-fg"],
    ["Stop-loss", plain(lv.stop_loss), signedPct(lv.stop_pct), "text-bear"],
    ["Target 1", plain(lv.target_1), `${signedPct(lv.target_1_pct)} · +${LEVEL_MULTIPLIERS.target1.toFixed(2)} ATR`, "text-bull"],
    ["Target 2", plain(lv.target_2), `${signedPct(lv.target_2_pct)} · +${LEVEL_MULTIPLIERS.target2.toFixed(2)} ATR`, "text-bull"],
  ];
  return (
    <div>
      <p className={`mb-1.5 text-[12px] font-semibold ${waiting ? "text-caution" : "text-bull"}`}>
        {waiting ? "Wait for pullback — don't chase" : "Active buy zone"}
        <span className="num ml-1.5 font-medium text-muted">gap {lv.opening_gap_atr.toFixed(2)} ATR</span>
      </p>
      <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-ink/55 text-center [&>*:nth-child(-n+2)]:border-t-0">
        {cells.map(([label, value, sub, color]) => (
          <div key={label} className="min-w-0 px-2 py-2">
            <p className="text-[10.5px] text-muted">{label}</p>
            <p className={`num mt-0.5 truncate text-[12.5px] font-semibold ${color}`}>{value}</p>
            <p className="num truncate text-[11px] text-muted">{sub}</p>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-faint">
        T1: {EXIT_PLAN.target1}. T2: {EXIT_PLAN.target2}.
      </p>
    </div>
  );
}
