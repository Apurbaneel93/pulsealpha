"use client";

import { useEffect, useState } from "react";
import { isNseSessionOpen } from "@/lib/time";
import type { LiveQuote, QuotesResponse } from "@/lib/types";

const POLL_MS = 20_000;

/**
 * Latest prices for `symbols`, fetched at once and then every ~20 s while the
 * NSE session is open and the page is visible. Pausing when hidden or closed
 * keeps phones quiet and the server cache cold. A failed poll keeps the last
 * prices on screen.
 */
export function useLiveQuotes(symbols: readonly string[], enabled: boolean): Record<string, LiveQuote> {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const key = symbols.join(",");

  useEffect(() => {
    if (!enabled || !key) return;
    const ctrl = new AbortController();
    let lastAt = 0;

    const load = async () => {
      if (document.visibilityState !== "visible") return;
      lastAt = Date.now();
      try {
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(key)}`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as QuotesResponse;
        if (!ctrl.signal.aborted) setQuotes((prev) => ({ ...prev, ...data.quotes }));
      } catch {
        /* offline, aborted or rate-limited: keep what we have */
      }
    };

    void load();
    const timer = window.setInterval(() => {
      if (isNseSessionOpen(new Date())) void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastAt > 10_000) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ctrl.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, enabled]);

  return quotes;
}
