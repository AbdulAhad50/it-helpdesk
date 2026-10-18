// Single source of truth for fixed vocabularies shared by client, server and DB validators.

export const COMPLAINT_STATUSES = ["Pending", "Resolved"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_PRIORITIES = ["Low", "Normal", "High", "Critical"] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

/** Numeric rank stored on each complaint so the table can sort by priority in the database. */
export const PRIORITY_RANK: Record<ComplaintPriority, number> = {
  Low: 1,
  Normal: 2,
  High: 3,
  Critical: 4,
};

export const PRIORITY_HELP: Record<ComplaintPriority, string> = {
  Low: "Minor issue. Work can continue as normal.",
  Normal: "Standard request. Work is affected but there is a workaround.",
  High: "Your work is significantly slowed or blocked.",
  Critical: "A team or business-critical system is down.",
};

export const DEFAULT_DEPARTMENTS = [
  "IT",
  "HR",
  "Marketing",
  "Finance & Accounts",
  "Sales",
  "Operations",
  "E-commerce",
  "Supply Chain",
  "Administration",
  "Other",
] as const;

export const DEFAULT_CATEGORIES = [
  "Computer / Laptop",
  "Internet / Wi-Fi / Network",
  "Printer / Scanner",
  "Email / Outlook",
  "Software / Application",
  "POS / G-TECH System",
  "CCTV / Camera",
  "Shared Folder / Access",
  "Hardware / Accessories",
  "User Account / Password",
  "Other",
] as const;

export const LIMITS = {
  userNameMin: 2,
  userNameMax: 100,
  descriptionMin: 10,
  descriptionMax: 3000,
  contactMax: 30,
  /** Hard cap on the raw request body for public submissions. */
  maxBodyBytes: 16 * 1024,
} as const;

export const DISPLAY_TIMEZONE = "Asia/Karachi";

/** Public submission rate limit: N submissions per window, per hashed client IP. */
export const SUBMISSION_RATE_LIMIT = { limit: 8, windowSeconds: 15 * 60 } as const;
