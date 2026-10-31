import { istDateKey } from "./time";
import type { HistoryEntry, ScanResult } from "./types";

/**
 * Flatten a scan into Signal History rows. The id is one per stock per IST
 * day (and per data source), so re-scans of the same setup don't flood the
 * log — the first detection of the day is the one that is kept.
 */
export function historyId(scan: { mode: ScanResult["mode"]; simulated: boolean }, symbol: string, detectedAtIso: string): string {
  const source = scan.mode === "demo" ? "demo" : scan.simulated ? "sim" : "live";
  return `${istDateKey(new Date(detectedAtIso))}:${source}:${symbol}`;
}

export function scanToHistory(scan: ScanResult): HistoryEntry[] {
  return scan.picks.map((p) => ({
    id: historyId(scan, p.symbol, p.detected_at_iso),
    scan_id: scan.id,
    symbol: p.symbol,
    name: p.name,
    entry_low: p.levels.entry_low,
    entry_high: p.levels.entry_high,
    target_price: p.levels.target_price,
    stop_loss: p.levels.stop_loss,
    conviction: p.conviction,
    catalyst: p.catalyst,
    mode: scan.mode,
    simulated: scan.simulated,
    detected_at: p.detected_at,
    detected_at_iso: p.detected_at_iso,
  }));
}
