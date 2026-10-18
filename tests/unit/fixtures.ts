import { ObjectId } from "mongodb";
import type { ComplaintDoc } from "@/models/Complaint";

export function sampleComplaint(over: Partial<ComplaintDoc> = {}): ComplaintDoc {
  const receivedAt = new Date("2026-10-18T05:30:00Z"); // 10:30 AM in Karachi
  return {
    _id: new ObjectId(),
    complaintId: "IT-20261018-A7K2",
    userName: "Ayesha Khan",
    department: "Finance & Accounts",
    problemCategory: "Printer / Scanner",
    problemDescription: "The printer shows a paper jam but the tray is empty.",
    priority: "High",
    priorityRank: 3,
    contactNumber: "ext 204",
    receivedAt,
    solvedAt: null,
    solveDurationMinutes: null,
    workStuckReason: null,
    resolutionNotes: null,
    status: "Pending",
    resolvedBy: null,
    createdAt: receivedAt,
    updatedAt: receivedAt,
    version: 1,
    googleSheetSynced: false,
    googleSheetSyncedAt: null,
    syncState: "pending",
    syncError: null,
    ...over,
  };
}
