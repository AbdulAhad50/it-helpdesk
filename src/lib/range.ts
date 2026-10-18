import { karachiYmd } from "@/lib/time";

// Pakistan has no daylight saving (abolished 2009), so Asia/Karachi is a fixed UTC+5.
// That makes "start of a Karachi day" simple arithmetic and keeps boundaries exact.
const DAY_MS = 86_400_000;
const KARACHI_OFFSET_MS = 5 * 3_600_000;
export const MAX_RANGE_DAYS = 366;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isYmd = (v: string) => karachiMidnightUtc(v) !== null;

/** "2026-10-18" → the UTC instant of 00:00 that day in Karachi, or null if it isn't a real date. */
export function karachiMidnightUtc(ymd: string): Date | null {
  const m = YMD.exec(ymd);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = Date.UTC(y, mo - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return new Date(utc - KARACHI_OFFSET_MS);
}

export function startOfKarachiDay(date: Date): Date {
  return new Date(Math.floor((date.getTime() + KARACHI_OFFSET_MS) / DAY_MS) * DAY_MS - KARACHI_OFFSET_MS);
}

/** Inclusive-day range `[from, to)` in UTC instants, aligned to Karachi midnights. */
export interface DateRange {
  preset: RangePreset;
  from: Date;
  /** Exclusive upper bound (the Karachi midnight after the last day). */
  to: Date;
  fromYmd: string;
  /** The last day included. */
  toYmd: string;
  days: number;
}

export const RANGE_PRESETS = ["today", "7d", "30d", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const DEFAULT_PRESET: RangePreset = "30d";

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  custom: "Custom range",
};

function build(preset: RangePreset, from: Date, to: Date): DateRange {
  return { preset, from, to, fromYmd: karachiYmd(from), toYmd: karachiYmd(new Date(to.getTime() - 1)), days: Math.round((to.getTime() - from.getTime()) / DAY_MS) };
}

/**
 * Today = today. Last 7 days = today and the 6 days before it. Last 30 days = today and the 29 before.
 * Custom = both dates inclusive, at most 366 days.
 */
export function resolveRange(
  input: { preset?: string; from?: string; to?: string },
  now: Date = new Date(),
): { ok: true; range: DateRange } | { ok: false; error: string } {
  const preset = (input.preset || DEFAULT_PRESET) as RangePreset;
  if (!RANGE_PRESETS.includes(preset)) return { ok: false, error: "Unknown date range." };

  const todayStart = startOfKarachiDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);

  if (preset === "today") return { ok: true, range: build(preset, todayStart, tomorrowStart) };
  if (preset === "7d") return { ok: true, range: build(preset, new Date(todayStart.getTime() - 6 * DAY_MS), tomorrowStart) };
  if (preset === "30d") return { ok: true, range: build(preset, new Date(todayStart.getTime() - 29 * DAY_MS), tomorrowStart) };

  if (!input.from || !input.to) return { ok: false, error: "Choose both a start and an end date." };
  const from = karachiMidnightUtc(input.from);
  const toDay = karachiMidnightUtc(input.to);
  if (!from || !toDay) return { ok: false, error: "Enter valid dates." };
  if (toDay < from) return { ok: false, error: "The end date can't be before the start date." };
  const to = new Date(toDay.getTime() + DAY_MS);
  if ((to.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) return { ok: false, error: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.` };
  return { ok: true, range: build("custom", from, to) };
}

/** Every Karachi calendar day in the range, as "YYYY-MM-DD", oldest first. */
export function listDays(range: Pick<DateRange, "from" | "days">): string[] {
  return Array.from({ length: range.days }, (_, i) => karachiYmd(new Date(range.from.getTime() + i * DAY_MS)));
}
