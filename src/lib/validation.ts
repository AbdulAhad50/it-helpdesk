import { z } from "zod";
import { COMPLAINT_PRIORITIES, LIMITS } from "@/lib/constants";

/** Strip control characters, normalise Unicode, trim. HTML is NOT stripped; it is escaped on render. */
export function cleanSingleLine(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Like cleanSingleLine but keeps line breaks (max two in a row). */
export function cleanMultiline(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const NAME_PATTERN = /^[\p{L}\p{M}\p{N} .'’\-_,]+$/u;
// Phone numbers ("+92 300 1234567", "(021) 3456-7890") or short extensions ("204", "ext 204", "x204").
export const CONTACT_PATTERN = /^(?:\+?\(?\d[\d\s().-]{1,24}\d|(?:ext\.?\s*|x\s*)?\d{2,8})$/i;

export interface FormOptions {
  departments: readonly string[];
  categories: readonly string[];
}

/**
 * The shared complaint schema, used by the browser form (React Hook Form) and the API route.
 * Departments and categories are configurable, so the schema is built from the current options.
 */
export function buildComplaintInputSchema(options: FormOptions) {
  return z.object({
    userName: z
      .string({ error: "Enter your name." })
      .transform(cleanSingleLine)
      .pipe(
        z
          .string()
          .min(1, "Enter your name.")
          .min(LIMITS.userNameMin, `Name must be at least ${LIMITS.userNameMin} characters.`)
          .max(LIMITS.userNameMax, `Name must be ${LIMITS.userNameMax} characters or fewer.`)
          .regex(NAME_PATTERN, "Name can contain letters, numbers, spaces and . ' - , only."),
      ),
    department: z
      .string({ error: "Choose your department." })
      .min(1, "Choose your department.")
      .refine((v) => options.departments.includes(v), "Choose a department from the list."),
    problemCategory: z
      .string({ error: "Choose a problem category." })
      .min(1, "Choose a problem category.")
      .refine((v) => options.categories.includes(v), "Choose a category from the list."),
    problemDescription: z
      .string({ error: "Describe the problem." })
      .transform(cleanMultiline)
      .pipe(
        z
          .string()
          .min(1, "Describe the problem.")
          .min(LIMITS.descriptionMin, `Describe the problem in at least ${LIMITS.descriptionMin} characters.`)
          .max(LIMITS.descriptionMax, `Description must be ${LIMITS.descriptionMax} characters or fewer.`),
      ),
    priority: z.preprocess(
      (v) => (v === undefined || v === null || v === "" ? "Normal" : v),
      z.enum(COMPLAINT_PRIORITIES, { error: "Choose Low, Normal, High or Critical." }),
    ),
    contactNumber: z.preprocess(
      (v) => (typeof v === "string" ? cleanSingleLine(v) || undefined : v),
      z
        .string()
        .max(LIMITS.contactMax, "Contact number is too long.")
        .regex(CONTACT_PATTERN, "Enter a phone number or extension, like 0300 1234567 or ext 204.")
        .optional(),
    ),
  });
}

export type ComplaintInput = z.infer<ReturnType<typeof buildComplaintInputSchema>>;
export type ComplaintFormInput = z.input<ReturnType<typeof buildComplaintInputSchema>>;

export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}
