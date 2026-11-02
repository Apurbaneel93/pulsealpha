"use client";

import { useEffect, useRef, useState } from "react";
import { quoteLagSeconds } from "@/lib/live-pure";
import { formatClockSeconds, isNseSessionOpen } from "@/lib/time";
import type { LiveQuote } from "@/lib/types";

/** "up" or "down" for ~1 s after `value` changes, so a moving price is visible at a glance. */
export function useTickDirection(value: number): "up" | "down" | null {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value === prev.current) return;
    setDir(value > prev.current ? "up" : "down");
    prev.current = value;
    const t = window.setTimeout(() => setDir(null), 1100);
    return () => window.clearTimeout(t);
  }, [value]);
  return dir;
}

/** The price text with a green/red flash on every tick. */
export function Ticking({ value, className = "", children }: { value: number; className?: string; children: React.ReactNode }) {
  const dir = useTickDirection(value);
  return (
    <span
      key={dir ? `${dir}-${value}` : "idle"}
      className={`rounded px-0.5 -mx-0.5 ${dir === "up" ? "animate-flash-up" : dir === "down" ? "animate-flash-down" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

/** "Live · 11:31:05 AM", "As of 03:30:00 PM", or how late the feed is. */
export function LiveBadge({ quote, className = "" }: { quote: LiveQuote; className?: string }) {
  const now = new Date();
  const open = isNseSessionOpen(now);
  const lag = quoteLagSeconds(quote, now);
  const stamp = formatClockSeconds(new Date(quote.market_time_iso));
  const late = open && lag > 180;
  const text = !open ? `As of ${stamp}` : late ? `${stamp} · ${Math.round(lag / 60)} min behind` : `Live · ${stamp}`;
  const dot = !open ? "bg-faint" : late ? "bg-caution" : "bg-bull animate-live";
  return (
    <span className={`num inline-flex items-center gap-1.5 text-[11.5px] text-muted ${className}`} title="Time of the last trade reported by Yahoo Finance, in IST">
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  );
}
