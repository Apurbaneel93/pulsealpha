"use client";

import type { DataMode, HistoryEntry, ScanResult } from "./types";

/** Every localStorage access is wrapped: private mode, quota and disabled storage must never break the app. */

const KEYS = {
  settings: "pulsealpha:settings:v1",
  lastScan: "pulsealpha:last-scan:v2",
  history: "pulsealpha:history:v2",
} as const;

const HISTORY_CAP = 300;

export interface Settings {
  mode: DataMode;
  geminiKey: string;
  model: string;
}

export const DEFAULT_SETTINGS: Settings = { mode: "live", geminiKey: "", model: "" };

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>(KEYS.settings);
  return {
    mode: s?.mode === "demo" ? "demo" : "live",
    geminiKey: typeof s?.geminiKey === "string" ? s.geminiKey : "",
    model: typeof s?.model === "string" ? s.model : "",
  };
}

export const saveSettings = (s: Settings) => write(KEYS.settings, s);

export function loadLastScan(): ScanResult | null {
  const s = read<ScanResult>(KEYS.lastScan);
  return s && Array.isArray(s.picks) && typeof s.scanned_at_iso === "string" ? s : null;
}

export const saveLastScan = (s: ScanResult) => write(KEYS.lastScan, s);

export function loadHistory(): HistoryEntry[] {
  const h = read<HistoryEntry[]>(KEYS.history);
  return Array.isArray(h) ? h : [];
}

/** Merge new rows into the device log, keeping the earliest detection for each id. */
export function appendHistory(entries: HistoryEntry[]): HistoryEntry[] {
  const byId = new Map<string, HistoryEntry>();
  for (const e of [...loadHistory(), ...entries]) {
    const prev = byId.get(e.id);
    if (!prev || e.detected_at_iso < prev.detected_at_iso) byId.set(e.id, e);
  }
  const merged = [...byId.values()]
    .sort((a, b) => b.detected_at_iso.localeCompare(a.detected_at_iso))
    .slice(0, HISTORY_CAP);
  write(KEYS.history, merged);
  return merged;
}

export function clearHistory(): void {
  write(KEYS.history, []);
}

export { scanToHistory } from "./history";
