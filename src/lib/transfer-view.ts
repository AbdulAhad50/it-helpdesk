import { DIRECTION_LABEL, type TransferDirection, type TransferStatus } from "@/lib/constants";
import { formatDate, formatTime } from "@/lib/time";
import type { SyncState } from "@/models/Complaint";
import type { ItemTransferDoc } from "@/models/ItemTransfer";

const stamp = (d: Date) => `${formatDate(d)} ${formatTime(d)}`;
const PREVIEW = 120;

export interface TransferListItem {
  transferId: string;
  direction: TransferDirection;
  directionLabel: string;
  outlet: string;
  name: string;
  contact: string | null;
  email: string | null;
  descriptionPreview: string;
  status: TransferStatus;
  date: string;
  time: string;
  receivedAt: string | null;
  receivedByName: string | null;
  syncState: SyncState;
}

export function toTransferListItem(t: ItemTransferDoc, names: Map<string, string>): TransferListItem {
  const flat = t.description.replace(/\s+/g, " ");
  return {
    transferId: t.transferId,
    direction: t.direction,
    directionLabel: DIRECTION_LABEL[t.direction],
    outlet: t.outlet,
    name: t.name,
    contact: t.contact,
    email: t.email,
    descriptionPreview: flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}…` : flat,
    status: t.status,
    date: formatDate(t.createdAt),
    time: formatTime(t.createdAt),
    receivedAt: t.receivedAt ? stamp(t.receivedAt) : null,
    receivedByName: t.receivedBy ? (names.get(t.receivedBy) ?? "Unknown administrator") : null,
    syncState: t.syncState,
  };
}

export interface TransferDetail extends Omit<TransferListItem, "descriptionPreview" | "date" | "time"> {
  description: string;
  createdAt: string;
  loggedBy: string;
  receiptNotes: string | null;
  version: number;
  syncError: string | null;
  googleSheetSyncedAt: string | null;
  history: { label: string; actor: string; at: string; note: string | null }[];
}

export function toTransferDetail(t: ItemTransferDoc, names: Map<string, string>): TransferDetail {
  const { descriptionPreview: _p, date: _d, time: _t, ...base } = toTransferListItem(t, names);
  void _p; void _d; void _t;
  const actor = (a: string) => (a === "public" ? "Outlet (public form)" : (names.get(a) ?? "Unknown administrator"));
  return {
    ...base,
    description: t.description,
    createdAt: stamp(t.createdAt),
    loggedBy: actor(t.createdBy),
    receiptNotes: t.receiptNotes,
    version: t.version,
    syncError: t.syncError,
    googleSheetSyncedAt: t.googleSheetSyncedAt ? stamp(t.googleSheetSyncedAt) : null,
    history: t.history.map((h) => ({
      label: h.action === "created" ? (t.direction === "to_it" ? "Item recorded as sent to IT" : "Item recorded as sent from IT") : t.direction === "to_it" ? "Item received by IT" : "Delivery confirmed",
      actor: actor(h.actor),
      at: stamp(h.at),
      note: h.note,
    })),
  };
}
