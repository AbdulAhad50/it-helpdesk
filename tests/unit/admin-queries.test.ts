import { describe, expect, it } from "vitest";
import { karachiMidnightUtc, listDays, resolveRange, startOfKarachiDay } from "@/lib/range";
import { buildListFilter, buildListSort, escapeRegex } from "@/lib/complaint-admin-service";
import { fillDays } from "@/lib/dashboard-service";
import { buildQuery } from "@/lib/url";
import { complaintEditSchema, parseListQuery, resolveSchema } from "@/lib/validation-admin";

const NOW = new Date("2026-10-18T10:00:00Z"); // 3:00 PM Sunday in Karachi

describe("Karachi day boundaries", () => {
  it("midnight in Karachi is 19:00 UTC the day before", () => {
    expect(karachiMidnightUtc("2026-10-18")!.toISOString()).toBe("2026-10-17T19:00:00.000Z");
  });
  it("rejects impossible dates", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "26-10-18", "2026-10-1", "", "abc"]) expect(karachiMidnightUtc(bad)).toBeNull();
    expect(karachiMidnightUtc("2028-02-29")).not.toBeNull();
  });
  it("a complaint at 00:30 Karachi belongs to the new day, one at 23:59 to the old", () => {
    expect(startOfKarachiDay(new Date("2026-10-17T19:30:00Z")).toISOString()).toBe("2026-10-17T19:00:00.000Z");
    expect(startOfKarachiDay(new Date("2026-10-17T18:59:00Z")).toISOString()).toBe("2026-10-16T19:00:00.000Z");
  });
});

describe("resolveRange", () => {
  const ok = (input: object) => {
    const r = resolveRange(input, NOW);
    if (!r.ok) throw new Error(r.error);
    return r.range;
  };
  it("today is exactly the current Karachi day", () => {
    const r = ok({ preset: "today" });
    expect(r).toMatchObject({ fromYmd: "2026-10-18", toYmd: "2026-10-18", days: 1 });
    expect(r.to.getTime() - r.from.getTime()).toBe(86_400_000);
  });
  it("last 7 / 30 days include today and the days before it", () => {
    expect(ok({ preset: "7d" })).toMatchObject({ fromYmd: "2026-10-12", toYmd: "2026-10-18", days: 7 });
    expect(ok({ preset: "30d" })).toMatchObject({ fromYmd: "2026-09-19", toYmd: "2026-10-18", days: 30 });
  });
  it("defaults to 30 days", () => expect(ok({}).preset).toBe("30d"));
  it("custom range is inclusive of both days", () => {
    const r = ok({ preset: "custom", from: "2026-10-01", to: "2026-10-03" });
    expect(r).toMatchObject({ days: 3, fromYmd: "2026-10-01", toYmd: "2026-10-03" });
    expect(listDays(r)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });
  it("rejects bad custom ranges", () => {
    for (const input of [{ preset: "custom" }, { preset: "custom", from: "2026-10-05", to: "2026-10-01" }, { preset: "custom", from: "x", to: "y" }, { preset: "custom", from: "2024-01-01", to: "2026-01-01" }, { preset: "decade" }]) {
      expect(resolveRange(input, NOW).ok).toBe(false);
    }
  });
});

describe("fillDays", () => {
  it("zero-fills empty days and averages durations per day", () => {
    const range = (resolveRange({ preset: "custom", from: "2026-10-01", to: "2026-10-03" }, NOW) as { ok: true; range: any }).range;
    const pts = fillDays(range, [{ _id: "2026-10-02", received: 3, pending: 1, resolved: 2, durationSum: 90, durationCount: 2 }]);
    expect(pts.map((p) => p.received)).toEqual([0, 3, 0]);
    expect(pts[1]).toMatchObject({ pending: 1, resolved: 2, avgResolutionMinutes: 45 });
    expect(pts[0]!.avgResolutionMinutes).toBeNull();
  });
});

describe("buildListFilter", () => {
  const q = (o: object) => {
    const r = parseListQuery(o as Record<string, string>);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.query;
  };
  it("builds exact-match filters", () => {
    expect(buildListFilter(q({ status: "Pending", priority: "High", department: "Sales", category: "Other" }))).toEqual({
      status: "Pending", priority: "High", department: "Sales", problemCategory: "Other",
    });
  });
  it("includes the whole end day of the received-date filter, in Karachi time", () => {
    const f = buildListFilter(q({ from: "2026-10-01", to: "2026-10-03" })) as { receivedAt: { $gte: Date; $lt: Date } };
    expect(f.receivedAt.$gte.toISOString()).toBe("2026-09-30T19:00:00.000Z");
    expect(f.receivedAt.$lt.toISOString()).toBe("2026-10-03T19:00:00.000Z");
  });
  it("searches name and ID with escaped text, never as a pattern", () => {
    const f = buildListFilter(q({ q: ".*(a|b)+$" })) as { $or: { userName?: { $regex: string }; complaintId?: { $regex: string } }[] };
    expect(f.$or[0]!.userName!.$regex).toBe(escapeRegex(".*(a|b)+$"));
    expect(f.$or[0]!.userName!.$regex).toBe("\\.\\*\\(a\\|b\\)\\+\\$");
    expect(new RegExp(f.$or[0]!.userName!.$regex).test("anything")).toBe(false);
  });
  it("uppercases ID searches", () => {
    const f = buildListFilter(q({ q: "a7k2" })) as { $or: { complaintId?: { $regex: string } }[] };
    expect(f.$or[1]!.complaintId!.$regex).toBe("A7K2");
  });
  it("adds no filter when nothing is selected", () => expect(buildListFilter(q({}))).toEqual({}));
});

describe("buildListSort", () => {
  const q = (o: object) => (parseListQuery(o as Record<string, string>) as { query: any }).query;
  it("always ends with unique tie-breakers", () => {
    for (const sort of ["received", "priority", "status"]) {
      const keys = Object.keys(buildListSort(q({ sort })) as object);
      expect(keys.at(-1)).toBe("_id");
    }
  });
  it("default view is Pending first, newest first within a group", () => {
    expect(buildListSort(q({}))).toEqual({ status: 1, receivedAt: -1, _id: -1 });
  });
  it("priority sorts highest first by default", () => {
    expect(buildListSort(q({ sort: "priority" }))).toMatchObject({ priorityRank: -1 });
    expect(buildListSort(q({ sort: "priority", dir: "asc" }))).toMatchObject({ priorityRank: 1 });
  });
});

describe("parseListQuery", () => {
  it("applies defaults", () => {
    expect(parseListQuery({})).toMatchObject({ ok: true, query: { sort: "status", dir: "asc", page: 1, pageSize: 25 } });
  });
  it("treats blank fields as absent and takes the first of repeated params", () => {
    const r = parseListQuery({ q: "  ", status: ["Resolved", "Pending"], department: "" }) as { query: any };
    expect(r.query.q).toBeUndefined();
    expect(r.query.status).toBe("Resolved");
    expect(r.query.department).toBeUndefined();
  });
  it("rejects unknown enums, bad dates, bad page sizes and inverted ranges", () => {
    for (const bad of [{ status: "Closed" }, { priority: "Urgent" }, { sort: "name" }, { page: "0" }, { page: "abc" }, { pageSize: "1000" }, { from: "2026-02-31" }, { from: "2026-10-05", to: "2026-10-01" }]) {
      const r = parseListQuery(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it("falls back to the default query when invalid, so a pasted bad URL still renders", () => {
    expect((parseListQuery({ status: "x" }) as { query: any }).query).toMatchObject({ sort: "status", page: 1 });
  });
});

describe("edit and resolve schemas", () => {
  it("requires a version and at least one change", () => {
    expect(complaintEditSchema.safeParse({ priority: "High" }).success).toBe(false);
    expect(complaintEditSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(complaintEditSchema.safeParse({ version: 1, priority: "High" }).success).toBe(true);
  });
  it("turns blank text into null (clearing a field) and keeps absent fields absent", () => {
    const r = complaintEditSchema.parse({ version: "2", workStuckReason: "   ", resolutionNotes: " Fixed \n\n\n\n it " });
    expect(r.version).toBe(2);
    expect(r.workStuckReason).toBeNull();
    expect(r.resolutionNotes).toBe("Fixed\n\nit");
    expect(r.priority).toBeUndefined();
  });
  it("silently drops immutable fields", () => {
    const r = complaintEditSchema.parse({ version: 1, priority: "Low", complaintId: "IT-X", receivedAt: "2001-01-01", status: "Resolved", solvedAt: "2001-01-01", userName: "Eve" }) as Record<string, unknown>;
    for (const k of ["complaintId", "receivedAt", "status", "solvedAt", "userName"]) expect(r[k]).toBeUndefined();
  });
  it("enforces text length limits", () => {
    expect(complaintEditSchema.safeParse({ version: 1, workStuckReason: "x".repeat(1001) }).success).toBe(false);
    expect(resolveSchema.safeParse({ resolutionNotes: "x".repeat(3001) }).success).toBe(false);
    expect(resolveSchema.safeParse({}).success).toBe(true);
  });
});

describe("buildQuery", () => {
  it("drops empty values and applies overrides", () => {
    expect(buildQuery({ a: "1", b: "", c: undefined, page: 3 }, { page: 1, d: "x y" })).toBe("?a=1&page=1&d=x+y");
    expect(buildQuery({})).toBe("");
  });
});
