import { z } from "zod";
import { COMPLAINT_PRIORITIES, COMPLAINT_STATUSES } from "@/lib/constants";
import { isYmd } from "@/lib/range";
import { cleanMultiline } from "@/lib/validation";

export const WORK_STUCK_MAX = 1000;
export const RESOLUTION_NOTES_MAX = 3000;

const nullableText = (max: number, label: string) =>
  z
    .union([z.string(), z.null()])
    .transform((v) => (v === null ? null : cleanMultiline(v)))
    .refine((v) => v === null || v.length <= max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => (v === "" ? null : v));

/** Ordinary admin edit. Immutable fields (ID, names, description, received time, status) are not accepted at all. */
export const complaintEditSchema = z
  .object({
    /** The version the admin was looking at. A mismatch means someone else changed it first. */
    version: z.coerce.number().int().min(1),
    priority: z.enum(COMPLAINT_PRIORITIES, { error: "Choose a priority." }).optional(),
    department: z.string().trim().min(1, "Choose a department.").max(100).optional(),
    problemCategory: z.string().trim().min(1, "Choose a category.").max(100).optional(),
    workStuckReason: nullableText(WORK_STUCK_MAX, "Work stuck reason").optional(),
    resolutionNotes: nullableText(RESOLUTION_NOTES_MAX, "Resolution notes").optional(),
  })
  .refine((v) => Object.entries(v).some(([k, val]) => k !== "version" && val !== undefined), {
    message: "Change at least one field.",
  });
export type ComplaintEditInput = z.output<typeof complaintEditSchema>;

export const resolveSchema = z.object({
  workStuckReason: nullableText(WORK_STUCK_MAX, "Work stuck reason").optional(),
  resolutionNotes: nullableText(RESOLUTION_NOTES_MAX, "Resolution notes").optional(),
});
export type ResolveInput = z.output<typeof resolveSchema>;

// ── Complaint list query ────────────────────────────────────────────────────

export const SORT_FIELDS = ["received", "priority", "status"] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export const PAGE_SIZES = [10, 25, 50, 100] as const;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const ymd = z.preprocess(blank, z.string().refine(isYmd, "Enter a valid date.").optional());

export const listQuerySchema = z
  .object({
    q: z.preprocess(blank, z.string().trim().max(100).optional()),
    status: z.preprocess(blank, z.enum(COMPLAINT_STATUSES).optional()),
    priority: z.preprocess(blank, z.enum(COMPLAINT_PRIORITIES).optional()),
    department: z.preprocess(blank, z.string().max(100).optional()),
    category: z.preprocess(blank, z.string().max(100).optional()),
    from: ymd,
    to: ymd,
    sort: z.preprocess(blank, z.enum(SORT_FIELDS).optional()),
    dir: z.preprocess(blank, z.enum(["asc", "desc"]).optional()),
    page: z.preprocess(blank, z.coerce.number().int().min(1).max(100_000).optional()),
    pageSize: z.preprocess(
      blank,
      z.coerce.number().int().refine((n) => (PAGE_SIZES as readonly number[]).includes(n), "Unsupported page size.").optional(),
    ),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { path: ["to"], message: "The end date can't be before the start date." });

export interface ListQuery {
  q?: string;
  status?: (typeof COMPLAINT_STATUSES)[number];
  priority?: (typeof COMPLAINT_PRIORITIES)[number];
  department?: string;
  category?: string;
  from?: string;
  to?: string;
  sort: SortField;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** Default view: Pending first (so open work is on top), newest first within each group. */
export const DEFAULT_LIST_QUERY: ListQuery = { sort: "status", dir: "asc", page: 1, pageSize: 25 };

export type RawParams = Record<string, string | string[] | undefined>;
const firstValues = (raw: RawParams) =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

export function parseListQuery(
  raw: RawParams,
): { ok: true; query: ListQuery } | { ok: false; errors: Record<string, string[]>; query: ListQuery } {
  const parsed = listQuerySchema.safeParse(firstValues(raw));
  if (!parsed.success) {
    return { ok: false, errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>, query: DEFAULT_LIST_QUERY };
  }
  const v = parsed.data;
  const sort = v.sort ?? DEFAULT_LIST_QUERY.sort;
  return {
    ok: true,
    query: {
      q: v.q || undefined,
      status: v.status,
      priority: v.priority,
      department: v.department,
      category: v.category,
      from: v.from,
      to: v.to,
      sort,
      dir: v.dir ?? (sort === "status" ? "asc" : "desc"),
      page: v.page ?? 1,
      pageSize: v.pageSize ?? DEFAULT_LIST_QUERY.pageSize,
    },
  };
}
