"use client";

import { Fragment, useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, Search, X } from "lucide-react";
import { computeLevels } from "@/lib/levels";
import { Ticking } from "./LivePrice";
import { StockChart } from "./StockChart";
import { plain, rupees, signedPct } from "@/lib/format";
import type { BoardRow, LiveQuote } from "@/lib/types";

export const CHECK_LABELS = {
  trend: "Above 20-day average",
  rsi: "RSI between 55 and 72",
  volume: "Volume above 1.5x average",
} as const;

const SHORT = { trend: "Trend", rsi: "RSI", volume: "Volume" } as const;
const CHECK_ORDER = ["trend", "rsi", "volume"] as const;

const INITIAL_ROWS = 15;

type SortKey = "rank" | "symbol" | "price" | "change" | "score" | "checks" | "rsi" | "volume" | "trend";
type Dir = "asc" | "desc";

interface Entry {
  row: BoardRow;
  rank: number;
}

const VALUE: Record<SortKey, (e: Entry, live?: LiveQuote) => number | string> = {
  rank: (e) => e.rank,
  symbol: (e) => e.row.symbol,
  price: (e, l) => l?.price ?? e.row.price,
  change: (e, l) => l?.change_pct ?? e.row.change_pct,
  score: (e) => e.row.score,
  checks: (e) => e.row.passed,
  rsi: (e) => e.row.rsi14,
  volume: (e) => e.row.volume_ratio,
  trend: (e) => e.row.pct_above_ema20,
};

/** What a first click on a column should do: text and rank ascend, everything else shows the biggest first. */
const FIRST_DIR: Record<SortKey, Dir> = {
  rank: "asc",
  symbol: "asc",
  price: "desc",
  change: "desc",
  score: "desc",
  checks: "desc",
  rsi: "desc",
  volume: "desc",
  trend: "desc",
};

function Detail({ row, live, id }: { row: BoardRow; live?: LiveQuote; id: string }) {
  const missing = (["rsi", "volume"] as const).filter((k) => !row.checks[k]);
  const values = {
    trend: `${signedPct(row.pct_above_ema20, 1)} vs 20-day average`,
    rsi: `RSI ${row.rsi14.toFixed(1)}`,
    volume: `${row.volume_ratio.toFixed(2)}x average volume`,
  };
  const lv = computeLevels(row.price, row.atr14);
  const full = row.passed === 3;
  return (
    <div id={id} className="grid grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-8 border-t border-line/50 bg-ink/40 px-6 py-5">
      <div className="min-w-0">
        <ul className="space-y-2">
          {CHECK_ORDER.map((k) => (
            <li key={k} className="flex items-start gap-2 text-[13px] leading-snug">
              {row.checks[k] ? (
                <Check size={15} className="mt-px shrink-0 text-bull" aria-label="Pass" />
              ) : (
                <X size={15} className="mt-px shrink-0 text-bear" aria-label="Not yet" />
              )}
              <span className="min-w-0">
                <span className="text-fg">{CHECK_LABELS[k]}</span>
                <span className="text-muted">: {values[k]}</span>
              </span>
            </li>
          ))}
        </ul>
        {full ? (
          <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-ink/55 text-center">
            {[
              ["Buy zone", plain(lv.entry_low), `to ${plain(lv.entry_high)}`, "text-fg"],
              ["Target", plain(lv.target_price), signedPct(lv.target_pct), "text-bull"],
              ["Stop-loss", plain(lv.stop_loss), signedPct(lv.stop_pct), "text-bear"],
            ].map(([label, value, sub, color]) => (
              <div key={label} className="min-w-0 px-2 py-2.5">
                <p className="text-[11px] text-muted">{label}</p>
                <p className={`num mt-0.5 truncate text-[13px] font-semibold ${color}`}>{value}</p>
                <p className="num truncate text-[11.5px] text-muted">{sub}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] leading-snug text-muted">
            Not a full setup yet. Still needs {missing.map((k) => CHECK_LABELS[k].toLowerCase()).join(" and ")}.
          </p>
        )}
        <p className="mt-3 text-[12px] text-faint">
          {row.sector}. 20-day average {row.ema20_above_ema50 ? "above" : "below"} the 50-day.
        </p>
      </div>
      <div className="min-w-0">
        <StockChart symbol={row.symbol} levels={full ? lv : undefined} live={live} height={210} />
      </div>
    </div>
  );
}

function Checks({ row }: { row: BoardRow }) {
  return (
    <span
      className="inline-flex items-center gap-1"
      role="img"
      aria-label={`Passes ${row.passed} of 3 checks: ${CHECK_ORDER.filter((k) => row.checks[k])
        .map((k) => CHECK_LABELS[k].toLowerCase())
        .join(", ")}`}
    >
      {CHECK_ORDER.map((k) => (
        <span
          key={k}
          aria-hidden
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
            row.checks[k] ? "border-bull/30 bg-bull/10 text-bull" : "border-line text-faint"
          }`}
        >
          {row.checks[k] ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={2.5} />}
          {SHORT[k]}
        </span>
      ))}
    </span>
  );
}

interface Props {
  board: BoardRow[];
  pickSymbols: Set<string>;
  quotes: Record<string, LiveQuote>;
}

/** Desktop version of the bullish ranking: sortable, filterable, with a chart under any row. */
export function BoardTable({ board, pickSymbols, quotes }: Props) {
  const baseId = useId();
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "rank", dir: "asc" });
  const [query, setQuery] = useState("");
  const [fullOnly, setFullOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const entries = useMemo<Entry[]>(() => board.map((row, i) => ({ row, rank: i + 1 })), [board]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = entries.filter((e) => {
      if (fullOnly && e.row.passed !== 3) return false;
      if (!q) return true;
      return [e.row.symbol, e.row.name, e.row.sector].some((t) => t.toLowerCase().includes(q));
    });
    const get = VALUE[sort.key];
    const sign = sort.dir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      const av = get(a, quotes[a.row.symbol]);
      const bv = get(b, quotes[b.row.symbol]);
      const c = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
      return c !== 0 ? c * sign : a.rank - b.rank;
    });
    return list;
  }, [entries, query, fullOnly, sort, quotes]);

  const filtering = query.trim() !== "" || fullOnly;
  const rows = filtering || showAll ? visible : visible.slice(0, INITIAL_ROWS);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: FIRST_DIR[key] }));
  }

  function toggleOpen(symbol: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  // A plain function, not a component: a component declared here would remount on
  // every render and drop keyboard focus from the sort button that was just used.
  const th = (k: SortKey, label: string, align: "left" | "right" = "right", className = "") => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th
        key={k}
        scope="col"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`px-3 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`}
      >
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded transition-colors hover:text-fg ${active ? "text-fg" : ""}`}
        >
          {label}
          <Icon size={12} className={active ? "text-bull" : "text-faint"} aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex h-9 w-72 items-center gap-2 rounded-lg border border-line bg-panel px-3 focus-within:border-bull/60">
          <Search size={15} className="shrink-0 text-faint" aria-hidden />
          <span className="sr-only">Filter the ranking</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or sector"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none pointer-coarse:text-[16px]"
          />
        </label>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
            <input
              type="checkbox"
              checked={fullOnly}
              onChange={(e) => setFullOnly(e.target.checked)}
              className="size-4 accent-bull"
            />
            Full setups only
          </label>
          <span className="num text-[12px] text-muted" aria-live="polite">
            {filtering || showAll || visible.length <= INITIAL_ROWS
              ? `${visible.length} ${visible.length === 1 ? "stock" : "stocks"}`
              : `${rows.length} of ${visible.length}`}
          </span>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-line/70 bg-panel">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Bullish ranking. Column headers sort the table; activate a row to see its chart.</caption>
          <thead>
            <tr className="border-b border-line/70 text-[12px] text-muted">
              {th("rank", "#", "left", "w-14")}
              {th("symbol", "Stock", "left")}
              <th scope="col" className="px-3 py-2.5 text-left font-medium">
                Sector
              </th>
              {th("price", "Price")}
              {th("change", "Change")}
              {th("checks", "Setup checks", "left")}
              {th("rsi", "RSI")}
              {th("volume", "Volume")}
              {th("trend", "vs 20-day")}
              {th("score", "Score")}
              <th scope="col" className="w-10 px-3 py-2.5">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-[13px] text-muted">
                  No stock matches that filter.
                </td>
              </tr>
            ) : null}
            {rows.map(({ row, rank }) => {
              const live = quotes[row.symbol];
              const price = live?.price ?? row.price;
              const change = live?.change_pct ?? row.change_pct;
              const isOpen = open.has(row.symbol);
              const detailId = `${baseId}-${row.symbol}`;
              return (
                <Fragment key={row.symbol}>
                  <tr
                    onClick={() => toggleOpen(row.symbol)}
                    className={`cursor-pointer transition-colors hover:bg-panel-2/70 ${isOpen ? "bg-panel-2/50" : ""}`}
                  >
                    <td className="num px-3 py-3 text-[12.5px] text-faint">{rank}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? detailId : undefined}
                        className="block min-w-0 text-left"
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-ticker text-[19px] font-bold leading-none text-fg">{row.symbol}</span>
                          {pickSymbols.has(row.symbol) ? (
                            <span className="shrink-0 rounded bg-bull/15 px-1.5 py-px text-[10.5px] font-semibold text-bull">Top pick</span>
                          ) : null}
                        </span>
                        <span className="mt-1 block max-w-[220px] truncate text-[12px] text-muted">{row.name}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-muted">{row.sector}</td>
                    <td className="num px-3 py-3 text-right text-[13.5px] font-semibold text-fg">
                      <Ticking value={price}>{rupees(price)}</Ticking>
                    </td>
                    <td className={`num px-3 py-3 text-right text-[13px] ${change >= 0 ? "text-bull" : "text-bear"}`}>{signedPct(change)}</td>
                    <td className="px-3 py-3">
                      <Checks row={row} />
                    </td>
                    <td className="num px-3 py-3 text-right text-[13px] text-fg">{row.rsi14.toFixed(1)}</td>
                    <td className="num px-3 py-3 text-right text-[13px] text-fg">{row.volume_ratio.toFixed(2)}x</td>
                    <td className="num px-3 py-3 text-right text-[13px] text-fg">{signedPct(row.pct_above_ema20, 1)}</td>
                    <td className="num px-3 py-3 text-right text-[13px] font-semibold text-fg">{row.score}</td>
                    <td className="px-3 py-3 text-right">
                      <ChevronDown
                        size={16}
                        className={`inline text-faint transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                        aria-hidden
                      />
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={11} className="p-0">
                        <Detail row={row} live={live} id={detailId} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!filtering && visible.length > INITIAL_ROWS ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 w-full rounded-xl border border-line px-4 py-2.5 text-[13px] font-semibold text-fg transition-colors hover:bg-panel"
        >
          {showAll ? "Show fewer" : `Show all ${visible.length}`}
        </button>
      ) : null}
    </div>
  );
}
