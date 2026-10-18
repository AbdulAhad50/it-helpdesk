import { describe, expect, it } from "vitest";
import { SHEET_COLUMNS, buildSyncEvent, neutralizeCell, toSheetRow } from "@/lib/sheet-row";
import { sampleComplaint } from "./fixtures";

describe("toSheetRow", () => {
  it("has exactly the 16 required columns in the required order", () => {
    expect(SHEET_COLUMNS).toEqual([
      "Complaint ID", "User Name", "Department", "Problem Category", "Problem Description", "Priority",
      "Received Date", "Received Time", "Solved Date", "Resolve Time", "Solve Duration", "Work Stuck Reason",
      "Status", "Resolution Notes", "Resolved By", "Last Updated",
    ]);
    expect(Object.keys(toSheetRow(sampleComplaint()))).toEqual([...SHEET_COLUMNS]);
  });

  it("renders a new complaint: Karachi date/time, Pending, everything solved-related blank", () => {
    const row = toSheetRow(sampleComplaint());
    expect(row["Received Date"]).toBe("18-Oct-2026");
    expect(row["Received Time"]).toBe("10:30 AM");
    expect(row.Status).toBe("Pending");
    for (const c of ["Solved Date", "Resolve Time", "Solve Duration", "Work Stuck Reason", "Resolution Notes", "Resolved By"] as const) {
      expect(row[c]).toBe("");
    }
    expect(row["Last Updated"]).toBe("18-Oct-2026 10:30 AM");
  });

  it("renders a resolved complaint with a readable duration", () => {
    const solvedAt = new Date("2026-10-18T07:45:00Z");
    const row = toSheetRow(
      sampleComplaint({ status: "Resolved", solvedAt, solveDurationMinutes: 135, resolutionNotes: "Replaced the roller.", workStuckReason: "Waiting for parts", updatedAt: solvedAt }),
      "IT Admin",
    );
    expect(row["Solved Date"]).toBe("18-Oct-2026");
    expect(row["Resolve Time"]).toBe("12:45 PM");
    expect(row["Solve Duration"]).toBe("2 hours 15 minutes");
    expect(row.Status).toBe("Resolved");
    expect(row["Resolved By"]).toBe("IT Admin");
  });

  it("never includes the contact number or internal IDs", () => {
    const json = JSON.stringify(toSheetRow(sampleComplaint()));
    expect(json).not.toContain("ext 204");
    expect(json).not.toMatch(/_id|version|contact/i);
  });

  it("neutralises formula-looking text in every free-text column", () => {
    const row = toSheetRow(
      sampleComplaint({ userName: "=HYPERLINK(\"http://evil\")", problemDescription: "+cmd|' /C calc'!A0", workStuckReason: "@SUM(1+1)", resolutionNotes: "-2+3" }),
      "=admin",
    );
    for (const c of ["User Name", "Problem Description", "Work Stuck Reason", "Resolution Notes", "Resolved By"] as const) {
      expect(row[c].startsWith("'")).toBe(true);
    }
  });
});

describe("neutralizeCell", () => {
  it.each([["=1+1", "'=1+1"], ["+1", "'+1"], ["-1", "'-1"], ["@a", "'@a"], ["  =1", "'  =1"], ["\tx", "'\tx"]])("%j", (i, o) => expect(neutralizeCell(i)).toBe(o));
  it.each(["printer is broken", "Wi-Fi down", "a=b", "IT-20261018-A7K2", ""])("leaves %j alone", (i) => expect(neutralizeCell(i)).toBe(i));
});

describe("buildSyncEvent", () => {
  it("wraps the row with the idempotency key and event metadata", () => {
    const e = buildSyncEvent({ eventId: "complaint.created:IT-20261018-A7K2", type: "complaint.created", complaintId: "IT-20261018-A7K2" }, sampleComplaint(), null, new Date("2026-10-18T06:00:00Z"));
    expect(e).toMatchObject({ schemaVersion: 1, eventId: "complaint.created:IT-20261018-A7K2", eventType: "complaint.created", sentAt: "2026-10-18T06:00:00.000Z" });
    expect(e.row["Complaint ID"]).toBe(e.complaintId);
  });
});
