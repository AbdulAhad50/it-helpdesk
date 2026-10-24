import { z } from "zod";
import { LIMITS, TRANSFER_DIRECTIONS, TRANSFER_LIMITS, TRANSFER_STATUSES } from "@/lib/constants";
import { CONTACT_PATTERN, NAME_PATTERN, cleanMultiline, cleanSingleLine } from "@/lib/validation";
import { nullableText } from "@/lib/validation-admin";

/** Empty string → absent, so optional fields can be left blank in a form. */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const name = z
  .string({ error: "Enter the name." })
  .transform(cleanSingleLine)
  .pipe(
    z
      .string()
      .min(1, "Enter the name.")
      .min(LIMITS.userNameMin, `Name must be at least ${LIMITS.userNameMin} characters.`)
      .max(LIMITS.userNameMax, `Name must be ${LIMITS.userNameMax} characters or fewer.`)
      .regex(NAME_PATTERN, "Name can contain letters, numbers, spaces and . ' - , only."),
  );

const emailField = z
  .string({ error: "Enter an email address." })
  .transform((v) => cleanSingleLine(v).toLowerCase())
  .pipe(z.string().min(1, "Enter an email address.").max(TRANSFER_LIMITS.emailMax, "Email is too long.").pipe(z.email("Enter a valid email address.")));

const contactField = z
  .string({ error: "Enter a phone number or extension." })
  .transform(cleanSingleLine)
  .pipe(
    z
      .string()
      .min(1, "Enter a phone number or extension.")
      .max(LIMITS.contactMax, "Contact number is too long.")
      .regex(CONTACT_PATTERN, "Enter a phone number or extension, like 0300 1234567 or ext 204."),
  );

const description = z
  .string({ error: "Describe the item." })
  .transform(cleanMultiline)
  .pipe(
    z
      .string()
      .min(1, "Describe the item.")
      .min(TRANSFER_LIMITS.descriptionMin, `Describe the item in at least ${TRANSFER_LIMITS.descriptionMin} characters.`)
      .max(TRANSFER_LIMITS.descriptionMax, `Description must be ${TRANSFER_LIMITS.descriptionMax} characters or fewer.`),
  );

const outletField = (outlets: readonly string[]) =>
  z
    .string({ error: "Choose an outlet." })
    .min(1, "Choose an outlet.")
    .refine((v) => outlets.includes(v), "Choose an outlet from the list.");

/** What an outlet fills in on the public form (everything required). Direction is always "to IT". */
export function buildPublicTransferSchema(outlets: readonly string[]) {
  return z.object({ name, email: emailField, contact: contactField, outlet: outletField(outlets), description });
}
export type PublicTransferInput = z.output<ReturnType<typeof buildPublicTransferSchema>>;
export type PublicTransferFormInput = z.input<ReturnType<typeof buildPublicTransferSchema>>;

/** What IT fills in on the admin form: either direction; email and contact are optional. */
export function buildAdminTransferSchema(outlets: readonly string[]) {
  return z.object({
    direction: z.preprocess(blank, z.enum(TRANSFER_DIRECTIONS, { error: "Choose To IT or From IT." }).default("from_it")),
    name,
    email: z.preprocess(blank, emailField.optional()),
    contact: z.preprocess(blank, contactField.optional()),
    outlet: outletField(outlets),
    description,
  });
}
export type AdminTransferInput = z.output<ReturnType<typeof buildAdminTransferSchema>>;
export type AdminTransferFormInput = z.input<ReturnType<typeof buildAdminTransferSchema>>;

export const acceptTransferSchema = z.object({
  notes: nullableText(TRANSFER_LIMITS.notesMax, "Notes").optional(),
});
export type AcceptTransferInput = z.output<typeof acceptTransferSchema>;

// ── List query ──────────────────────────────────────────────────────────────

export const transferPageSizes = [10, 25, 50, 100] as const;

export const transferListQuerySchema = z.object({
  q: z.preprocess(blank, z.string().trim().max(100).optional()),
  direction: z.preprocess(blank, z.enum(TRANSFER_DIRECTIONS).optional()),
  status: z.preprocess(blank, z.enum(TRANSFER_STATUSES).optional()),
  outlet: z.preprocess(blank, z.string().max(100).optional()),
  page: z.preprocess(blank, z.coerce.number().int().min(1).max(100_000).optional()),
  pageSize: z.preprocess(blank, z.coerce.number().int().refine((n) => (transferPageSizes as readonly number[]).includes(n), "Unsupported page size.").optional()),
});

export interface TransferListQuery {
  q?: string;
  direction?: (typeof TRANSFER_DIRECTIONS)[number];
  status?: (typeof TRANSFER_STATUSES)[number];
  outlet?: string;
  page: number;
  pageSize: number;
}
export const DEFAULT_TRANSFER_QUERY: TransferListQuery = { page: 1, pageSize: 25 };

export function parseTransferListQuery(
  raw: Record<string, string | string[] | undefined>,
): { ok: true; query: TransferListQuery } | { ok: false; errors: Record<string, string[]>; query: TransferListQuery } {
  const first = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = transferListQuerySchema.safeParse(first);
  if (!parsed.success) {
    return { ok: false, errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>, query: DEFAULT_TRANSFER_QUERY };
  }
  const v = parsed.data;
  return { ok: true, query: { q: v.q || undefined, direction: v.direction, status: v.status, outlet: v.outlet, page: v.page ?? 1, pageSize: v.pageSize ?? 25 } };
}
