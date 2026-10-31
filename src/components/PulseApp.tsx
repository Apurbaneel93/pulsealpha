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
import { istDateKey, isNseSessionOpen } from "@/lib/time";
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
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const ownerRef = useRef(false);
  const lastRunRef = useRef(0);
  const owner = config?.owner === true;

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const adopt = useCallback((result: ScanResult) => {
    setScan(result);
    saveLastScan(result);
    setHistory(appendHistory(scanToHistory(result)));
  }, []);

  /**
   * Everyone: GET the shared scan (served from the server cache).
   * Signed-in owner with demo mode, a personal Gemini key or a model override:
   * POST, which the server only accepts with the owner cookie. Visitors never
   * send a key, so stale owner settings in their browser are ignored.
   */
  const runScan = useCallback(
    async (requested: Settings) => {
      const s = ownerRef.current ? requested : DEFAULT_SETTINGS;
      inflight.current?.abort();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      lastRunRef.current = Date.now();
      setScanning(true);
      setError(null);
      try {
        const shared = s.mode === "live" && !s.geminiKey && !s.model;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (s.geminiKey) headers["x-gemini-key"] = s.geminiKey;
        const getShared = () => fetch("/api/scan", { cache: "no-store", signal: ctrl.signal });
        let res = shared
          ? await getShared()
          : await fetch("/api/scan", {
              method: "POST",
              headers,
              body: JSON.stringify({ mode: s.mode, model: s.model || undefined }),
              signal: ctrl.signal,
            });
        if (res.status === 401 && !shared) {
          // Owner session expired or the passcode was changed: carry on as a visitor.
          ownerRef.current = false;
          setConfig((c) => (c ? { ...c, owner: false, hasServerKey: false } : c));
          setTab((t) => (t === "setup" ? "picks" : t));
          res = await getShared();
        }
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

  // Boot: paint the last scan instantly, then find out whether this browser is
  // the signed-in owner and refresh. A live refresh is cheap — the server
  // answers from its shared cache unless the data is due.
  useEffect(() => {
    let cancelled = false;
    const s = loadSettings();
    settingsRef.current = s;
    setSettings(s);
    setHistory(loadHistory());
    const cached = loadLastScan();
    if (cached && cached.mode === s.mode) setScan(cached);

    void (async () => {
      let cfg: ServerConfig | null = null;
      try {
        const r = await fetch("/api/config", { cache: "no-store" });
        if (r.ok) cfg = (await r.json()) as ServerConfig;
      } catch {
        /* offline or blocked: carry on as a visitor */
      }
      if (cancelled) return;
      ownerRef.current = cfg?.owner === true;
      setConfig(cfg);
      const effective = ownerRef.current ? s : DEFAULT_SETTINGS;
      const demoIsFresh =
        effective.mode === "demo" &&
        cached?.mode === "demo" &&
        istDateKey(new Date(cached.scanned_at_iso)) === istDateKey(new Date());
      if (!demoIsFresh) void runScan(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [runScan]);

  // Stay current without a manual tap: refresh when the app comes back to the
  // foreground (tab switch, phone unlock, home-screen app resumed) and, while
  // it stays open during NSE hours, about every 3 minutes — the server's
  // market-data cache window, so this never adds load on Yahoo.
  useEffect(() => {
    const maybeRefresh = (minGapMs: number) => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRunRef.current < minGapMs) return;
      void runScan(settingsRef.current);
    };
    const onVisible = () => maybeRefresh(60_000);
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) maybeRefresh(60_000);
    };
    const timer = window.setInterval(() => {
      const live = !ownerRef.current || settingsRef.current.mode === "live";
      if (live && isNseSessionOpen(new Date())) maybeRefresh(175_000);
    }, 30_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
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

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/owner", { method: "DELETE" });
    } catch {
      /* the cookie is checked server-side on every request regardless */
    }
    ownerRef.current = false;
    setConfig((c) => (c ? { ...c, owner: false, hasServerKey: false } : c));
    setTab("picks");
    window.scrollTo({ top: 0 });
    void runScan(DEFAULT_SETTINGS);
  }, [runScan]);

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
          <PicksFeed
            scan={scan}
            scanning={scanning}
            error={error}
            onScan={() => void runScan(settings)}
            showOwnerLink={config?.ownerEnabled === true && !owner}
          />
        ) : tab === "history" ? (
          <HistoryView
            entries={history}
            onClear={() => {
              clearHistory();
              setHistory([]);
            }}
            onGoToPicks={() => changeTab("picks")}
          />
        ) : owner ? (
          <SetupView settings={settings} config={config} onChange={updateSettings} onSignOut={() => void signOut()} />
        ) : null}
      </main>
      <BottomNav tab={tab} onChange={changeTab} owner={owner} />
    </div>
  );
}
