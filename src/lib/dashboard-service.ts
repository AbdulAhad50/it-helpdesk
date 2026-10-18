import type { Db } from "mongodb";
import { DISPLAY_TIMEZONE } from "@/lib/constants";
import { listDays, type DateRange } from "@/lib/range";
import { complaintsCollection } from "@/models/Complaint";

export interface DayPoint {
  day: string; // YYYY-MM-DD (Karachi)
  received: number;
  pending: number;
  resolved: number;
  /** Average solve minutes of complaints received that day and since resolved, or null. */
  avgResolutionMinutes: number | null;
}

export interface DashboardMetrics {
  total: number;
  pending: number;
  resolved: number;
  highCritical: number;
  /** Arithmetic mean over RESOLVED complaints only, in whole minutes; null if none are resolved. */
  avgResolutionMinutes: number | null;
  overTime: DayPoint[];
  byDepartment: { name: string; count: number }[];
  byCategory: { name: string; count: number }[];
}

const isResolvedWithDuration = {
  $and: [{ $eq: ["$status", "Resolved"] }, { $ne: ["$solveDurationMinutes", null] }],
};
const count = (cond: unknown) => ({ $sum: { $cond: [cond, 1, 0] } });
const durationSum = { $sum: { $cond: [isResolvedWithDuration, "$solveDurationMinutes", 0] } };
const durationCount = count(isResolvedWithDuration);

interface Totals { total: number; pending: number; resolved: number; highCritical: number; durationSum: number; durationCount: number }
interface DayRow { _id: string; received: number; pending: number; resolved: number; durationSum: number; durationCount: number }

const mean = (sum: number, n: number) => (n > 0 ? Math.round(sum / n) : null);

/** Zero-fill so charts show every day in the range, including days with no complaints. */
export function fillDays(range: Pick<DateRange, "from" | "days">, rows: DayRow[]): DayPoint[] {
  const byDay = new Map(rows.map((r) => [r._id, r]));
  return listDays(range).map((day) => {
    const r = byDay.get(day);
    return {
      day,
      received: r?.received ?? 0,
      pending: r?.pending ?? 0,
      resolved: r?.resolved ?? 0,
      avgResolutionMinutes: r ? mean(r.durationSum, r.durationCount) : null,
    };
  });
}

/**
 * All dashboard numbers come from ONE aggregation on the server, filtered by the Karachi-day range
 * on receivedAt. Nothing is fetched into the browser to be counted there.
 */
export async function getDashboardMetrics(db: Db, range: DateRange): Promise<DashboardMetrics> {
  const [facets] = await complaintsCollection(db)
    .aggregate<{ totals: Totals[]; overTime: DayRow[]; byDepartment: { _id: string; count: number }[]; byCategory: { _id: string; count: number }[] }>([
      { $match: { receivedAt: { $gte: range.from, $lt: range.to } } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                pending: count({ $eq: ["$status", "Pending"] }),
                resolved: count({ $eq: ["$status", "Resolved"] }),
                highCritical: count({ $gte: ["$priorityRank", 3] }),
                durationSum,
                durationCount,
              },
            },
          ],
          overTime: [
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$receivedAt", timezone: DISPLAY_TIMEZONE } },
                received: { $sum: 1 },
                pending: count({ $eq: ["$status", "Pending"] }),
                resolved: count({ $eq: ["$status", "Resolved"] }),
                durationSum,
                durationCount,
              },
            },
          ],
          byDepartment: [{ $group: { _id: "$department", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 12 }],
          byCategory: [{ $group: { _id: "$problemCategory", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 12 }],
        },
      },
    ])
    .toArray();

  const t = facets?.totals[0];
  return {
    total: t?.total ?? 0,
    pending: t?.pending ?? 0,
    resolved: t?.resolved ?? 0,
    highCritical: t?.highCritical ?? 0,
    avgResolutionMinutes: t ? mean(t.durationSum, t.durationCount) : null,
    overTime: fillDays(range, facets?.overTime ?? []),
    byDepartment: (facets?.byDepartment ?? []).map((r) => ({ name: r._id, count: r.count })),
    byCategory: (facets?.byCategory ?? []).map((r) => ({ name: r._id, count: r.count })),
  };
}
