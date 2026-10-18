import type { ComplaintPriority, ComplaintStatus } from "@/lib/constants";
import { formatDate, formatDuration, formatTime } from "@/lib/time";
import type { AuditLogDoc } from "@/models/AuditLog";
import type { ComplaintDoc, SyncState } from "@/models/Complaint";
import type { SyncJobDoc } from "@/models/SyncJob";

/** Plain, serialisable shapes for pages and APIs. Dates are pre-formatted in Asia/Karachi on the server. */

export interface ComplaintListItem {
  complaintId: string;
  receivedDate: string;
  receivedTime: string;
  userName: string;
  department: string;
  problemCategory: string;
  descriptionPreview: string;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  solveDuration: string | null;
  workStuckReason: string | null;
  syncState: SyncState;
}

const PREVIEW = 140;

export function toListItem(c: ComplaintDoc): ComplaintListItem {
  const flat = c.problemDescription.replace(/\s+/g, " ");
  return {
    complaintId: c.complaintId,
    receivedDate: formatDate(c.receivedAt),
    receivedTime: formatTime(c.receivedAt),
    userName: c.userName,
    department: c.department,
    problemCategory: c.problemCategory,
    descriptionPreview: flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}…` : flat,
    priority: c.priority,
    status: c.status,
    solveDuration: c.solveDurationMinutes === null ? null : formatDuration(c.solveDurationMinutes),
    workStuckReason: c.workStuckReason,
    syncState: c.syncState,
  };
}

export interface ComplaintDetail {
  complaintId: string;
  userName: string;
  department: string;
  problemCategory: string;
  problemDescription: string;
  priority: ComplaintPriority;
  contactNumber: string | null;
  status: ComplaintStatus;
  receivedAt: string; // "18-Oct-2026 10:30 AM"
  solvedAt: string | null;
  solveDuration: string | null;
  workStuckReason: string | null;
  resolutionNotes: string | null;
  resolvedBy: string | null;
  updatedAt: string;
  version: number;
  syncState: SyncState;
  syncError: string | null;
  googleSheetSyncedAt: string | null;
}

const stamp = (d: Date) => `${formatDate(d)} ${formatTime(d)}`;

export function toDetail(c: ComplaintDoc, resolvedByName: string | null): ComplaintDetail {
  return {
    complaintId: c.complaintId,
    userName: c.userName,
    department: c.department,
    problemCategory: c.problemCategory,
    problemDescription: c.problemDescription,
    priority: c.priority,
    contactNumber: c.contactNumber,
    status: c.status,
    receivedAt: stamp(c.receivedAt),
    solvedAt: c.solvedAt ? stamp(c.solvedAt) : null,
    solveDuration: c.solveDurationMinutes === null ? null : formatDuration(c.solveDurationMinutes),
    workStuckReason: c.workStuckReason,
    resolutionNotes: c.resolutionNotes,
    resolvedBy: resolvedByName,
    updatedAt: stamp(c.updatedAt),
    version: c.version,
    syncState: c.syncState,
    syncError: c.syncError,
    googleSheetSyncedAt: c.googleSheetSyncedAt ? stamp(c.googleSheetSyncedAt) : null,
  };
}

const ACTION_LABELS: Record<string, string> = {
  "complaint.created": "Complaint submitted",
  "complaint.updated": "Details updated",
  "complaint.resolved": "Marked resolved",
  "sync.retried": "Spreadsheet sync retried",
};

const FIELD_LABELS: Record<string, string> = {
  priority: "Priority",
  department: "Department",
  problemCategory: "Category",
  workStuckReason: "Work stuck reason",
  resolutionNotes: "Resolution notes",
  status: "Status",
  solvedAt: "Solved at",
  solveDurationMinutes: "Solve duration (minutes)",
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (v instanceof Date) return stamp(v);
  const s = String(v);
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
};

export interface HistoryEntry {
  id: string;
  label: string;
  actor: string;
  at: string;
  changes: { field: string; from: string; to: string }[];
}

export function toHistoryEntry(a: AuditLogDoc, actorName: string): HistoryEntry {
  return {
    id: a._id.toHexString(),
    label: ACTION_LABELS[a.action] ?? a.action,
    actor: actorName,
    at: stamp(a.createdAt),
    changes: a.changes.map((c) => ({ field: FIELD_LABELS[c.field] ?? c.field, from: show(c.from), to: show(c.to) })),
  };
}

export interface SyncJobView {
  type: SyncJobDoc["type"];
  status: SyncJobDoc["status"];
  attempts: number;
  lastError: string | null;
  at: string;
}

export const toSyncJobView = (j: SyncJobDoc): SyncJobView => ({
  type: j.type,
  status: j.status,
  attempts: j.attempts,
  lastError: j.lastError,
  at: stamp(j.updatedAt),
});
