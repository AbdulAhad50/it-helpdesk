import { ApiError } from "@/lib/api";
import { isValidComplaintId, isValidTransferId } from "@/lib/complaint-id";

/** Admin URLs use the human-readable complaint ID, never the internal database ID. */
export async function complaintIdParam(params: Promise<{ id: string }>): Promise<string> {
  const id = (await params).id.toUpperCase();
  if (!isValidComplaintId(id)) throw new ApiError(400, "INVALID_COMPLAINT_ID", "That doesn't look like a complaint ID.");
  return id;
}

export async function transferIdParam(params: Promise<{ id: string }>): Promise<string> {
  const id = (await params).id.toUpperCase();
  if (!isValidTransferId(id)) throw new ApiError(400, "INVALID_TRANSFER_ID", "That doesn't look like an item record ID.");
  return id;
}
