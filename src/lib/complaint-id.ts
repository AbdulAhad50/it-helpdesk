import { randomInt } from "node:crypto";
import { dateStamp } from "@/lib/time";

// 31 characters: no 0/O, 1/I/L, so IDs are easy to read out over the phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SUFFIX_LENGTH = 4;

export const COMPLAINT_ID_PATTERN = /^IT-\d{8}-[A-HJKMNP-Z2-9]{4}$/;

/**
 * "IT-20261018-A7K2": date (Asia/Karachi) + 4 cryptographically random characters.
 * The date and random part only make collisions unlikely. UNIQUENESS is guaranteed by the
 * unique index on complaints.complaintId; createComplaint retries on a duplicate-key error.
 */
export function generateComplaintId(now: Date = new Date()): string {
  return `IT-${dateStamp(now)}-${randomSuffix()}`;
}

function randomSuffix(): string {
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return suffix;
}

export const TRANSFER_ID_PATTERN = /^TR-\d{8}-[A-HJKMNP-Z2-9]{4}$/;

/** "TR-20261018-B3M9": the same scheme as complaint IDs, with a TR prefix. Uniqueness comes from the unique index. */
export function generateTransferId(now: Date = new Date()): string {
  return `TR-${dateStamp(now)}-${randomSuffix()}`;
}

export function isValidTransferId(value: string): boolean {
  return TRANSFER_ID_PATTERN.test(value);
}

export function isValidComplaintId(value: string): boolean {
  return COMPLAINT_ID_PATTERN.test(value);
}
