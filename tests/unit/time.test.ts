import { describe, expect, it } from "vitest";
import { computeSolveDurationMinutes, dateStamp, formatDate, formatDuration, formatTime } from "@/lib/time";

describe("Asia/Karachi display formatting (UTC+5, no DST)", () => {
  it("formats date and time", () => {
    const d = new Date("2026-10-18T05:30:00Z"); // 10:30 AM in Karachi
    expect(formatDate(d)).toBe("18-Oct-2026");
    expect(formatTime(d)).toBe("10:30 AM");
  });
  it("handles midnight, noon and day rollover", () => {
    expect(formatTime(new Date("2026-10-17T19:05:00Z"))).toBe("12:05 AM"); // 00:05 on the 18th
    expect(formatDate(new Date("2026-10-17T19:05:00Z"))).toBe("18-Oct-2026");
    expect(formatTime(new Date("2026-10-18T07:00:00Z"))).toBe("12:00 PM");
    expect(formatTime(new Date("2026-10-18T18:59:00Z"))).toBe("11:59 PM");
  });
  it("builds the ID date stamp in Karachi time", () => {
    expect(dateStamp(new Date("2026-10-17T19:30:00Z"))).toBe("20261018");
  });
});

describe("solve duration", () => {
  const received = new Date("2026-10-18T05:00:00Z");
  it("rounds to the nearest minute, halves up", () => {
    expect(computeSolveDurationMinutes(received, new Date("2026-10-18T05:45:00Z"))).toBe(45);
    expect(computeSolveDurationMinutes(received, new Date("2026-10-18T05:00:29.999Z"))).toBe(0);
    expect(computeSolveDurationMinutes(received, new Date("2026-10-18T05:00:30Z"))).toBe(1);
    expect(computeSolveDurationMinutes(received, new Date("2026-10-18T05:01:29.999Z"))).toBe(1);
  });
  it("never returns a negative duration", () => {
    expect(computeSolveDurationMinutes(received, new Date("2026-10-18T04:00:00Z"))).toBe(0);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0 minutes"],
    [1, "1 minute"],
    [45, "45 minutes"],
    [60, "1 hour"],
    [135, "2 hours 15 minutes"],
    [1440, "1 day"],
    [1620, "1 day 3 hours"],
    [2880 + 5, "2 days"],
  ])("%i minutes → %s", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});
