/**
 * IST formatting helpers. Every formatter pins `timeZone: "Asia/Kolkata"`
 * so output is identical on the server, on Vercel, and on any phone.
 */

const TZ = "Asia/Kolkata";

function parts(date: Date, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts }).formatToParts(date)) {
    out[p.type] = p.value;
  }
  return out;
}

function clock(date: Date, withSeconds: boolean): string {
  const p = parts(date, {
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: true,
  });
  const period = (p.dayPeriod ?? "").toUpperCase();
  const hh = (p.hour ?? "00").padStart(2, "0");
  return withSeconds ? `${hh}:${p.minute}:${p.second} ${period}` : `${hh}:${p.minute} ${period}`;
}

function dayMonth(date: Date): { day: string; month: string; year: string } {
  const p = parts(date, { day: "2-digit", month: "short", year: "numeric" });
  return { day: p.day ?? "", month: p.month ?? "", year: p.year ?? "" };
}

/** "01 Nov 2026 • 08:30:12 AM IST" */
export function formatDetectedAt(date: Date): string {
  const { day, month, year } = dayMonth(date);
  return `${day} ${month} ${year} • ${clock(date, true)} IST`;
}

/** "01 Nov 2026, 08:30 AM IST" */
export function formatLastScan(date: Date): string {
  const { day, month, year } = dayMonth(date);
  return `${day} ${month} ${year}, ${clock(date, false)} IST`;
}

/** "01 Nov • 08:30 AM" */
export function formatBadge(date: Date): string {
  const { day, month } = dayMonth(date);
  return `${day} ${month} • ${clock(date, false)}`;
}

/** "08:30 AM" */
export function formatClock(date: Date): string {
  return clock(date, false);
}

/** "Sun, 01 Nov 2026" */
export function formatDayHeading(date: Date): string {
  const p = parts(date, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** "2026-11-01" — the IST calendar date, used to bucket scans by trading day. */
export function istDateKey(date: Date): string {
  const p = parts(date, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Minutes since IST midnight and IST weekday (0 = Sunday). */
export function istClock(date: Date): { minutes: number; weekday: number } {
  const p = parts(date, { hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(p.hour ?? 0) % 24;
  return { minutes: hour * 60 + Number(p.minute ?? 0), weekday: map[p.weekday ?? "Sun"] ?? 0 };
}

/** NSE cash session: Mon–Fri, 09:15–15:30 IST (exchange holidays not modelled). */
export function isNseSessionOpen(date: Date): boolean {
  const { minutes, weekday } = istClock(date);
  return weekday >= 1 && weekday <= 5 && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30;
}
