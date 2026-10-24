import { ObjectId } from "mongodb";
import type { ComplaintDoc } from "@/models/Complaint";
import type { ItemTransferDoc } from "@/models/ItemTransfer";

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

export function sampleTransfer(over: Partial<ItemTransferDoc> = {}): ItemTransferDoc {
  const createdAt = new Date("2026-10-18T05:30:00Z"); // 10:30 AM in Karachi
  return {
    _id: new ObjectId(), transferId: "TR-20261018-B3M9", direction: "to_it", source: "public", name: "Ayesha Khan",
    email: "ayesha@example.com", contact: "0300 1234567", outlet: "Malir", description: "Receipt printer, model TM-T20, faulty cutter.",
    status: "In transit", createdAt, updatedAt: createdAt, receivedAt: null, receivedBy: null, receiptNotes: null, createdBy: "public",
    version: 1, history: [{ at: createdAt, action: "created", actor: "public", note: null }],
    googleSheetSynced: false, googleSheetSyncedAt: null, syncState: "pending", syncError: null, ...over,
  };
}

