"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BottomNav, type Tab } from "./BottomNav";
import { Header } from "./Header";
import { HistoryView } from "./HistoryView";
import { PicksFeed } from "./PicksFeed";
import { SetupView } from "./SetupView";
import {
  DEFAULT_SETTINGS,
  appendHistory,
  clearHistory,
  loadHistory,
  loadLastScan,
  loadSettings,
  saveLastScan,
  saveSettings,
  scanToHistory,
  type Settings,
} from "@/lib/client-store";
import { istDateKey } from "@/lib/time";
import type { ApiError, HistoryEntry, ScanResult, ServerConfig } from "@/lib/types";

function isApiError(v: unknown): v is ApiError {
  return typeof v === "object" && v !== null && typeof (v as { error?: unknown }).error === "string";
}

function isScan(v: unknown): v is ScanResult {
  return typeof v === "object" && v !== null && Array.isArray((v as { picks?: unknown }).picks);
}

export function PulseApp() {
  const [tab, setTab] = useState<Tab>("picks");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const adopt = useCallback((result: ScanResult) => {
    setScan(result);
    saveLastScan(result);
    setHistory(appendHistory(scanToHistory(result)));
  }, []);

  /**
   * Live without a personal key → GET the shared scan (served from the server cache).
   * Demo mode or a personal Gemini key → POST, which still reuses cached market data.
   */
  const runScan = useCallback(
    async (s: Settings) => {
      inflight.current?.abort();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      setScanning(true);
      setError(null);
      try {
        const shared = s.mode === "live" && !s.geminiKey && !s.model;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (s.geminiKey) headers["x-gemini-key"] = s.geminiKey;
        const res = shared
          ? await fetch("/api/scan", { cache: "no-store", signal: ctrl.signal })
          : await fetch("/api/scan", {
              method: "POST",
              headers,
              body: JSON.stringify({ mode: s.mode, model: s.model || undefined }),
              signal: ctrl.signal,
            });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok || !isScan(data)) {
          throw new Error(isApiError(data) ? data.error : `Server responded ${res.status}`);
        }
        adopt(data);
      } catch (err: unknown) {
        if (ctrl.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(`The scan didn't finish (${msg}). The last saved scan is still shown; tap Scan Market Now to retry.`);
      } finally {
        if (inflight.current === ctrl) {
          inflight.current = null;
          setScanning(false);
        }
      }
    },
    [adopt],
  );

  // Boot: paint the last scan instantly, then refresh. A live refresh is cheap —
  // the server answers from its shared cache unless the data is due.
  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setHistory(loadHistory());
    const cached = loadLastScan();
    if (cached && cached.mode === s.mode) setScan(cached);

    fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ServerConfig>) : null))
      .then(setConfig)
      .catch(() => setConfig(null));

    const demoIsFresh =
      s.mode === "demo" && cached?.mode === "demo" && istDateKey(new Date(cached.scanned_at_iso)) === istDateKey(new Date());
    if (!demoIsFresh) void runScan(s);
  }, [runScan]);

  const updateSettings = useCallback(
    (next: Settings) => {
      const modeChanged = next.mode !== settings.mode;
      setSettings(next);
      saveSettings(next);
      if (modeChanged) void runScan(next);
    },
    [settings.mode, runScan],
  );

  const changeTab = useCallback((t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-md bg-ink sm:border-x sm:border-line/60">
      <Header
        scanning={scanning}
        scannedAtIso={scan?.scanned_at_iso ?? null}
        regime={scan?.market.regime ?? null}
        onScan={() => void runScan(settings)}
      />
      <main className="pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {tab === "picks" ? (
          <PicksFeed scan={scan} scanning={scanning} error={error} onScan={() => void runScan(settings)} />
        ) : tab === "history" ? (
          <HistoryView
            entries={history}
            onClear={() => {
              clearHistory();
              setHistory([]);
            }}
            onGoToPicks={() => changeTab("picks")}
          />
        ) : (
          <SetupView settings={settings} config={config} onChange={updateSettings} />
        )}
      </main>
      <BottomNav tab={tab} onChange={changeTab} />
    </div>
  );
}
