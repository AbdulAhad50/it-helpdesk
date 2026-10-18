import { DISPLAY_TIMEZONE } from "@/lib/constants";

/**
 * All timestamps are stored in UTC (JS Date / BSON date) and rendered in Asia/Karachi.
 * Every duration is derived from the canonical fields receivedAt and solvedAt.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function karachiParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: Number(get("month")),
    day: get("day"),
    hour: Number(get("hour")) % 24,
    minute: get("minute"),
  };
}

/** "18-Oct-2026" */
export function formatDate(date: Date): string {
  const p = karachiParts(date);
  return `${p.day}-${MONTHS[p.month - 1]}-${p.year}`;
}

/** "10:30 AM" */
export function formatTime(date: Date): string {
  const p = karachiParts(date);
  const suffix = p.hour >= 12 ? "PM" : "AM";
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${p.minute} ${suffix}`;
}

/** "YYYYMMDD" in the display timezone, used inside complaint IDs. */
export function dateStamp(date: Date): string {
  const p = karachiParts(date);
  return `${p.year}${String(p.month).padStart(2, "0")}${p.day}`;
}

/**
 * Solve duration in whole minutes: (solvedAt − receivedAt), rounded to the NEAREST minute,
 * halves rounding up, never negative. The same rule is used everywhere
 * (the Mongo resolve pipeline in Phase 5 uses floor(minutes + 0.5) to match).
 */
export function computeSolveDurationMinutes(receivedAt: Date, solvedAt: Date): number {
  const minutes = (solvedAt.getTime() - receivedAt.getTime()) / 60_000;
  return Math.max(0, Math.floor(minutes + 0.5));
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** 45 → "45 minutes", 135 → "2 hours 15 minutes", 1620 → "1 day 3 hours" */
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return plural(m, "minute");
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem === 0 ? plural(h, "hour") : `${plural(h, "hour")} ${plural(rem, "minute")}`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return h === 0 ? plural(d, "day") : `${plural(d, "day")} ${plural(h, "hour")}`;
}

/** "2026-10-18": the calendar day in the display timezone. Used for day buckets and range filters. */
export function karachiYmd(date: Date): string {
  const p = karachiParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${p.day}`;
}

/** "2026-10-18" → "18 Oct" (chart axis labels). */
export function shortDayLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ""}`;
}
