"use client";

import { useMemo, useState } from "react";
import { History, Trash2 } from "lucide-react";
import { plain, rupees } from "@/lib/format";
import { formatClock, formatDayHeading, istDateKey } from "@/lib/time";
import type { HistoryEntry } from "@/lib/types";

interface Props {
  entries: HistoryEntry[];
  onClear: () => void;
  onGoToPicks: () => void;
}

export function HistoryView({ entries, onClear, onGoToPicks }: Props) {
  const [confirming, setConfirming] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const e of entries) {
      const key = istDateKey(new Date(e.detected_at_iso));
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);

  return (
    <section className="px-4 pt-5">
      <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.01em] text-fg">Signal History</h1>
      <p className="mt-1 text-[13px] leading-snug text-muted">
        {entries.length === 0
          ? "Every pick is logged here with its detection time and entry price."
          : `${entries.length} signal${entries.length === 1 ? "" : "s"} saved on this device. Each stock is logged once per day, at its first detection.`}
      </p>

      {entries.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-line px-5 py-10 text-center">
          <History size={28} className="mx-auto text-faint" aria-hidden />
          <p className="mt-3 text-[15px] font-semibold text-fg">No signals logged yet</p>
          <p className="mx-auto mt-1.5 max-w-[28ch] text-[13px] leading-snug text-muted">
            Picks from each scan appear here, newest first.
          </p>
          <button
            type="button"
            onClick={onGoToPicks}
            className="mt-4 rounded-full bg-bull px-4 py-2 text-[13px] font-semibold text-ink"
          >
            View today&apos;s picks
          </button>
        </div>
      ) : (
        <>
          {groups.map(([day, list]) => (
            <div key={day} className="mt-5">
              <h2 className="mb-2 text-[12.5px] font-semibold text-muted">
                {formatDayHeading(new Date(list[0]?.detected_at_iso ?? day))}
              </h2>
              <ul className="divide-y divide-line/80 overflow-hidden rounded-xl border border-line/70 bg-panel">
                {list.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-3.5 py-3">
                    <time dateTime={e.detected_at_iso} className="num w-[62px] shrink-0 text-[12px] text-muted" title={e.detected_at}>
                      {formatClock(new Date(e.detected_at_iso))}
                    </time>
                    <div className="min-w-0 flex-1">
                      <p className="font-ticker truncate text-[19px] font-bold leading-none text-fg">{e.symbol}</p>
                      <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                        <span className="truncate">{e.name}</span>
                        {e.mode === "demo" || e.simulated ? (
                          <span className="shrink-0 rounded bg-caution/15 px-1.5 py-px text-[10.5px] font-semibold text-caution">
                            {e.mode === "demo" ? "Demo" : "Simulated"}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num text-[14px] font-semibold text-fg">{rupees(e.entry_low)}</p>
                      <p className="num mt-0.5 text-[11.5px]">
                        <span className="text-bull">T {plain(e.target_price)}</span>{" "}
                        <span className="text-bear">SL {plain(e.stop_loss)}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <button
              type="button"
              onClick={() => {
                if (confirming) {
                  onClear();
                  setConfirming(false);
                } else {
                  setConfirming(true);
                  window.setTimeout(() => setConfirming(false), 4000);
                }
              }}
              className={`mt-6 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-semibold ${
                confirming ? "border-bear/50 bg-bear/10 text-bear" : "border-line text-muted"
              }`}
            >
              <Trash2 size={14} aria-hidden />
              {confirming ? "Tap again to clear history" : "Clear history"}
            </button>
        </>
      )}
    </section>
  );
}
