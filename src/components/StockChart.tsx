"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CHART_RANGES, RANGE_LABELS, niceTicks } from "@/lib/live-pure";
import { plain, signedPct } from "@/lib/format";
import { formatAxisDate, formatAxisMonth, formatAxisTime, isNseSessionOpen, istDateKey } from "@/lib/time";
import type { ChartPayload, ChartRange, LiveQuote, PriceLevels } from "@/lib/types";

type Plan = Pick<PriceLevels, "entry_low" | "entry_high" | "target_1" | "target_2" | "stop_loss">;

interface Props {
  symbol: string;
  /** Draw the buy zone, both targets and the stop-loss on the chart. */
  levels?: Plan;
  /** Latest quote; extends the 1D line to the current price between chart refreshes. */
  live?: LiveQuote;
  height?: number;
}

const PAD = { top: 10, right: 50, bottom: 20, left: 2 } as const;
const INTRADAY_POLL_MS = 30_000;

const fmtAxis = (v: number, span: number) =>
  v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: span < 8 ? 2 : span < 40 ? 1 : 0 });

/** Path through `values`, lifting the pen over nulls. */
function gappedPath(xs: number[], ys: Array<number | null>): string {
  let d = "";
  let pen = false;
  ys.forEach((y, i) => {
    const x = xs[i];
    if (y == null || x == null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function StockChart({ symbol, levels, live, height = 172 }: Props) {
  const [range, setRange] = useState<ChartRange>("1d");
  const [byRange, setByRange] = useState<Partial<Record<ChartRange, ChartPayload>>>({});
  const [failed, setFailed] = useState<ChartRange | null>(null);
  const [retry, setRetry] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const gradId = `g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // ── Data ──────────────────────────────────────────────────────────────────
  const haveRange = byRange[range] !== undefined;
  useEffect(() => {
    const ctrl = new AbortController();
    const load = async (first: boolean) => {
      if (!first && document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as ChartPayload;
        if (ctrl.signal.aborted) return;
        setByRange((m) => ({ ...m, [range]: payload }));
        setFailed(null);
      } catch {
        if (!ctrl.signal.aborted && first) setFailed(range);
      }
    };
    void load(!haveRange);
    // The 1D line keeps growing while the market is open.
    const timer =
      range === "1d"
        ? window.setInterval(() => {
            if (isNseSessionOpen(new Date())) void load(false);
          }, INTRADAY_POLL_MS)
        : undefined;
    return () => {
      ctrl.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };
    // `haveRange` is deliberately read once per range change.
  }, [symbol, range, retry]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(Math.floor(el.clientWidth));
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const data = byRange[range] ?? null;

  // ── Series (with the live price appended to a 1D line) ────────────────────
  const series = useMemo(() => {
    if (!data) return null;
    const pts: Array<[number, number]> = data.points.slice();
    const liveT = live ? Math.floor(Date.parse(live.market_time_iso) / 1000) : NaN;
    const lastT = pts[pts.length - 1]?.[0] ?? 0;
    if (
      live &&
      data.range === "1d" &&
      data.session &&
      Number.isFinite(liveT) &&
      liveT > lastT &&
      liveT >= data.session.start &&
      liveT <= data.session.end
    ) {
      pts.push([liveT, live.price]);
    }
    return pts;
  }, [data, live]);

  // ── Geometry ──────────────────────────────────────────────────────────────
  const geo = useMemo(() => {
    if (!data || !series || series.length === 0 || width < 80) return null;
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const closes = series.map(([, c]) => c);
    const values = closes.slice();
    if (data.previous_close != null) values.push(data.previous_close);
    for (const arr of [data.ema20, data.ema50]) arr?.forEach((v) => v != null && values.push(v));
    const lo0 = Math.min(...values);
    const hi0 = Math.max(...values);
    const span0 = hi0 - lo0 || hi0 * 0.01 || 1;
    // Show a level only when it sits near the price action; otherwise flag it at the edge.
    const near = (v: number) => v >= lo0 - span0 * 0.6 && v <= hi0 + span0 * 0.6;
    const shown: number[] = [];
    if (levels) {
      for (const v of [levels.target_1, levels.target_2, levels.stop_loss]) if (near(v)) shown.push(v);
      if (near(levels.entry_low) || near(levels.entry_high)) shown.push(levels.entry_low, levels.entry_high);
    }
    const lo1 = Math.min(lo0, ...shown);
    const hi1 = Math.max(hi0, ...shown);
    const pad = (hi1 - lo1 || 1) * 0.07;
    const yMin = lo1 - pad;
    const yMax = hi1 + pad;
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    const n = series.length;
    const xs = series.map(([t], i) =>
      data.session
        ? PAD.left + Math.min(1, Math.max(0, (t - data.session.start) / (data.session.end - data.session.start))) * plotW
        : PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW),
    );
    const ys = closes.map(y);
    const first = data.previous_close ?? closes[0] ?? 0;
    const last = closes[closes.length - 1] ?? 0;
    return { plotW, plotH, y, yMin, yMax, xs, ys, closes, first, last, up: last >= first, lo: Math.min(...closes), hi: Math.max(...closes) };
  }, [data, series, width, height, levels]);

  // ── Hover ─────────────────────────────────────────────────────────────────
  const pointAt = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (!geo || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < geo.xs.length; i++) {
        const d = Math.abs((geo.xs[i] as number) - px);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      window.clearTimeout(hoverTimer.current);
      setHover(best);
    },
    [geo],
  );
  const endHover = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    window.clearTimeout(hoverTimer.current);
    if (e.pointerType === "mouse") setHover(null);
    else hoverTimer.current = window.setTimeout(() => setHover(null), 1500);
  }, []);

  // ── Labels ────────────────────────────────────────────────────────────────
  const xLabels = useMemo(() => {
    if (!data || !series || !geo || series.length < 2) return [];
    const fmtAt = (t: number) => {
      const d = new Date(t * 1000);
      return data.range === "1d" ? formatAxisTime(d) : data.range === "5d" || data.range === "1m" || data.range === "3m" ? formatAxisDate(d) : formatAxisMonth(d);
    };
    if (data.session) {
      const at = (t: number) => PAD.left + ((t - data.session!.start) / (data.session!.end - data.session!.start)) * geo.plotW;
      return [
        { x: at(data.session.start), text: "9:15 AM", anchor: "start" as const },
        { x: at(data.session.start + 3.25 * 3600), text: "12:30 PM", anchor: "middle" as const },
        { x: at(data.session.end), text: "3:30 PM", anchor: "end" as const },
      ];
    }
    if (data.range === "5d") {
      // One label at the start of each session.
      const out: Array<{ x: number; text: string; anchor: "start" | "middle" | "end" }> = [];
      let prevDay = "";
      series.forEach(([t], i) => {
        const day = istDateKey(new Date(t * 1000));
        if (day !== prevDay) out.push({ x: geo.xs[i] as number, text: fmtAt(t), anchor: out.length === 0 ? "start" : "middle" });
        prevDay = day;
      });
      return out;
    }
    const idx = [0, Math.round((series.length - 1) / 3), Math.round(((series.length - 1) * 2) / 3), series.length - 1];
    return idx.map((i, k) => ({ x: geo.xs[i] as number, text: fmtAt((series[i] as [number, number])[0]), anchor: k === 0 ? ("start" as const) : k === idx.length - 1 ? ("end" as const) : ("middle" as const) }));
  }, [data, series, geo]);

  // ── Render ────────────────────────────────────────────────────────────────
  const tone = geo?.up === false ? "var(--color-bear)" : "var(--color-bull)";
  const hovered = geo && hover != null && series ? { i: hover, t: series[hover]![0], c: series[hover]![1] } : null;
  const ref = geo?.first ?? 0;
  const shownPrice = hovered ? hovered.c : (geo?.last ?? 0);
  const shownChange = ref ? ((shownPrice - ref) / ref) * 100 : 0;
  const rangeWord = range === "1d" ? "today" : RANGE_LABELS[range];
  const summary = geo
    ? `${symbol} ${RANGE_LABELS[range]} price chart, ${plain(geo.closes[0] ?? 0)} to ${plain(geo.last)}, low ${plain(geo.lo)}, high ${plain(geo.hi)}`
    : `${symbol} price chart`;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label="Chart range" className="flex gap-1">
          {CHART_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === range}
              onClick={() => {
                setRange(r);
                setHover(null);
                setFailed(null);
              }}
              className={`h-7 min-w-9 rounded-md px-1.5 text-[12px] font-semibold transition-colors ${
                r === range ? "bg-line text-fg" : "text-muted"
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <p className="num mt-2 flex h-[18px] items-baseline gap-2 text-[12px] text-muted" aria-live="off">
        {geo ? (
          hovered ? (
            <>
              <span className="font-semibold text-fg">₹{plain(hovered.c)}</span>
              <span>{range === "1d" || range === "5d" ? `${formatAxisDate(new Date(hovered.t * 1000))}, ${formatAxisTime(new Date(hovered.t * 1000))}` : formatAxisDate(new Date(hovered.t * 1000))}</span>
              <span className={shownChange >= 0 ? "text-bull" : "text-bear"}>{signedPct(shownChange)}</span>
            </>
          ) : (
            <>
              <span className={geo.up ? "text-bull" : "text-bear"}>
                {signedPct(shownChange)} {rangeWord}
              </span>
              <span>
                Low {plain(geo.lo)} · High {plain(geo.hi)}
              </span>
            </>
          )
        ) : (
          <span className="text-faint">{failed === range ? "" : " "}</span>
        )}
      </p>

      <div ref={wrapRef} className="relative mt-1.5 w-full" style={{ height }}>
        {geo && data && series ? (
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={summary}
            className="block touch-pan-y select-none"
            onPointerDown={pointAt}
            onPointerMove={pointAt}
            onPointerUp={endHover}
            onPointerLeave={endHover}
            onPointerCancel={endHover}
          >
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
                <stop offset="100%" stopColor={tone} stopOpacity="0" />
              </linearGradient>
              <clipPath id={`${gradId}c`}>
                <rect x={PAD.left} y={PAD.top} width={geo.plotW} height={geo.plotH} />
              </clipPath>
            </defs>

            {/* grid + price axis */}
            {niceTicks(geo.yMin, geo.yMax, 3).map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={PAD.left + geo.plotW} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--color-line)" strokeWidth="1" opacity="0.55" />
                <text x={PAD.left + geo.plotW + 6} y={geo.y(v) + 3.5} fontSize="10.5" fill="var(--color-faint)" className="num">
                  {fmtAxis(v, geo.yMax - geo.yMin)}
                </text>
              </g>
            ))}

            <g clipPath={`url(#${gradId}c)`}>
              {/* buy zone, target, stop-loss */}
              {levels && geo.y(levels.entry_high) < PAD.top + geo.plotH && geo.y(levels.entry_low) > PAD.top ? (
                <rect x={PAD.left} width={geo.plotW} y={Math.min(geo.y(levels.entry_high), geo.y(levels.entry_low))} height={Math.max(2, Math.abs(geo.y(levels.entry_low) - geo.y(levels.entry_high)))} fill="var(--color-bull)" opacity="0.14" />
              ) : null}
              {levels
                ? ([
                    [levels.target_2, "var(--color-bull)", "T2"],
                    [levels.target_1, "var(--color-bull)", "T1"],
                    [levels.stop_loss, "var(--color-bear)", "Stop"],
                  ] as const).map(([v, color, label]) => {
                    const yy = geo.y(v);
                    if (yy < PAD.top || yy > PAD.top + geo.plotH) return null;
                    return (
                      <g key={label}>
                        <line x1={PAD.left} x2={PAD.left + geo.plotW} y1={yy} y2={yy} stroke={color} strokeWidth="1" strokeDasharray="4 3" opacity="0.8" />
                        <text x={PAD.left + 4} y={yy - 3} fontSize="10" fill={color} className="num">
                          {label} {plain(v)}
                        </text>
                      </g>
                    );
                  })
                : null}

              {data.previous_close != null ? (
                <line x1={PAD.left} x2={PAD.left + geo.plotW} y1={geo.y(data.previous_close)} y2={geo.y(data.previous_close)} stroke="var(--color-muted)" strokeWidth="1" strokeDasharray="2 4" opacity="0.7" />
              ) : null}

              {/* moving averages (daily ranges) */}
              {data.ema50 ? <path d={gappedPath(geo.xs, data.ema50.map((v) => (v == null ? null : geo.y(v))))} fill="none" stroke="var(--color-muted)" strokeWidth="1.25" opacity="0.9" /> : null}
              {data.ema20 ? <path d={gappedPath(geo.xs, data.ema20.map((v) => (v == null ? null : geo.y(v))))} fill="none" stroke="var(--color-caution)" strokeWidth="1.25" opacity="0.95" /> : null}

              {/* price */}
              {series.length > 1 ? (
                <>
                  <path
                    d={`${gappedPath(geo.xs, geo.ys)}L${(geo.xs[geo.xs.length - 1] as number).toFixed(1)},${PAD.top + geo.plotH}L${(geo.xs[0] as number).toFixed(1)},${PAD.top + geo.plotH}Z`}
                    fill={`url(#${gradId})`}
                  />
                  <path d={gappedPath(geo.xs, geo.ys)} fill="none" stroke={tone} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
                </>
              ) : null}
            </g>

            {/* levels that sit outside the visible price range */}
            {levels
              ? ([
                  [levels.target_2, "var(--color-bull)", "T2"],
                  [levels.target_1, "var(--color-bull)", "T1"],
                  [levels.stop_loss, "var(--color-bear)", "Stop"],
                ] as const).map(([v, color, label], idx) => {
                  const yy = geo.y(v);
                  const above = yy < PAD.top;
                  const below = yy > PAD.top + geo.plotH;
                  if (!above && !below) return null;
                  // Several off-chart labels share an edge, so stack them instead of overprinting.
                  return (
                    <text key={label} x={PAD.left + geo.plotW - 2} y={above ? PAD.top + 9 + idx * 11 : PAD.top + geo.plotH - 3 - (2 - idx) * 11} textAnchor="end" fontSize="10" fill={color} className="num">
                      {above ? "▲" : "▼"} {label} {plain(v)}
                    </text>
                  );
                })
              : null}

            {/* last point marker */}
            {series.length > 0 ? <circle cx={geo.xs[geo.xs.length - 1]} cy={geo.ys[geo.ys.length - 1]} r="3" fill={tone} /> : null}

            {/* time axis */}
            {xLabels.map((l, i) => (
              <text key={`${l.text}-${i}`} x={l.x} y={height - 5} textAnchor={l.anchor} fontSize="10.5" fill="var(--color-faint)" className="num">
                {l.text}
              </text>
            ))}

            {/* crosshair */}
            {hovered ? (
              <g pointerEvents="none">
                <line x1={geo.xs[hovered.i]} x2={geo.xs[hovered.i]} y1={PAD.top} y2={PAD.top + geo.plotH} stroke="var(--color-fg)" strokeWidth="1" opacity="0.45" />
                <circle cx={geo.xs[hovered.i]} cy={geo.ys[hovered.i]} r="4" fill={tone} stroke="var(--color-panel)" strokeWidth="2" />
              </g>
            ) : null}
          </svg>
        ) : failed === range && !data ? (
          <div className="grid h-full place-items-center rounded-lg border border-dashed border-line text-center">
            <div>
              <p className="text-[12.5px] text-muted">Chart unavailable right now.</p>
              <button
                type="button"
                onClick={() => {
                  setFailed(null);
                  setRetry((n) => n + 1);
                }}
                className="mt-1.5 rounded-full border border-line px-3 py-1 text-[12px] font-semibold text-fg"
              >
                Retry
              </button>
            </div>
          </div>
        ) : data && series && series.length === 0 ? (
          <div className="grid h-full place-items-center rounded-lg border border-dashed border-line px-4 text-center text-[12.5px] text-muted">
            No trades to chart yet.
          </div>
        ) : (
          <div className="h-full animate-pulse rounded-lg bg-line/35" aria-hidden />
        )}
      </div>

      {geo && data ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint">
          {data.ema20 ? (
            <>
              <span className="inline-flex items-center gap-1">
                <i className="inline-block h-0.5 w-3 rounded bg-caution" /> 20-day avg
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="inline-block h-0.5 w-3 rounded bg-muted" /> 50-day avg
              </span>
            </>
          ) : null}
          {levels ? (
            <>
              <span className="inline-flex items-center gap-1">
                <i className="inline-block size-2 rounded-sm bg-bull/40" /> Buy zone
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="inline-block h-0.5 w-3 rounded bg-bull" /> Target
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="inline-block h-0.5 w-3 rounded bg-bear" /> Stop
              </span>
            </>
          ) : null}
          {data.previous_close != null ? (
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-0 w-3 border-t border-dotted border-muted" /> Prev close {plain(data.previous_close)}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
