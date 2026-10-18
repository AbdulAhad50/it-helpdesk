// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { EditComplaintForm } from "@/components/complaints/edit-form";
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS } from "@/lib/constants";

const ID = "IT-20261018-A7K2";
const base = { complaintId: ID, version: 3, initial: { priority: "Normal" as const, department: "Sales", problemCategory: "Other", workStuckReason: null, resolutionNotes: null }, departments: DEFAULT_DEPARTMENTS, categories: DEFAULT_CATEGORIES };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EditComplaintForm", () => {
  it("disables Save until something changes", async () => {
    render(<EditComplaintForm {...base} />);
    const save = screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/work stuck reason/i), "Waiting for parts");
    expect(save.disabled).toBe(false);
  });

  it("sends only the edited fields plus the version it was looking at", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { ok: true, data: { changed: true, version: 4 } }));
    vi.stubGlobal("fetch", f);
    render(<EditComplaintForm {...base} />);
    await userEvent.selectOptions(screen.getByLabelText(/priority/i), "Critical");
    await userEvent.type(screen.getByLabelText(/resolution notes/i), "Tried a restart.");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/admin/complaints/${ID}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ version: 3, priority: "Critical", resolutionNotes: "Tried a restart." });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("on a version conflict, blocks saving and offers to reload instead of overwriting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(409, { ok: false, error: { code: "STALE_VERSION", message: "Someone else changed this complaint." } })));
    render(<EditComplaintForm {...base} />);
    await userEvent.selectOptions(screen.getByLabelText(/priority/i), "High");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/someone else changed/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /reload latest/i }));
    expect(refresh).toHaveBeenCalled();
  });

  it("maps server field errors onto the fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(422, { ok: false, error: { code: "VALIDATION_FAILED", message: "Please fix the highlighted fields.", fieldErrors: { department: ["Choose a department from the list."] } } })));
    render(<EditComplaintForm {...base} />);
    await userEvent.selectOptions(screen.getByLabelText(/department/i), "HR");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Choose a department from the list.")).toBeTruthy();
  });

  it("keeps a since-removed department selectable so unrelated edits still work", () => {
    render(<EditComplaintForm {...base} initial={{ ...base.initial, department: "Legacy Dept" }} />);
    expect(screen.getByRole("option", { name: "Legacy Dept" })).toBeTruthy();
  });

  it("validates text length before sending", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<EditComplaintForm {...base} />);
    await userEvent.click(screen.getByLabelText(/work stuck reason/i));
    await userEvent.paste("x".repeat(1001));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/1000 characters or fewer/i)).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
  });
});
