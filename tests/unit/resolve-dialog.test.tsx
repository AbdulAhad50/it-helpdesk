// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refresh, replace, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));

import { ResolveDialog } from "@/components/complaints/resolve-dialog";

const ID = "IT-20261018-A7K2";
const props = { complaintId: ID, userName: "Ayesha Khan", problemCategory: "Printer / Scanner", preview: "The printer shows a paper jam." };

beforeAll(() => {
  // jsdom doesn't implement the modal <dialog> API.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

async function openAndFill(notes = "Replaced the roller.") {
  await userEvent.click(screen.getByRole("button", { name: /^resolve$/i }));
  await userEvent.type(screen.getByLabelText(/resolution notes/i), notes);
}
const submit = () => fireEvent.submit(screen.getByRole("button", { name: new RegExp(`resolve ${ID}`, "i") }).closest("form")!);

describe("ResolveDialog", () => {
  it("shows the complaint ID and summary for confirmation before anything is sent", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<ResolveDialog {...props} />);
    await userEvent.click(screen.getByRole("button", { name: /^resolve$/i }));
    expect(screen.getByRole("heading", { name: /resolve complaint/i })).toBeTruthy();
    expect(screen.getAllByText(ID).length).toBeGreaterThan(0);
    expect(screen.getByText(/The printer shows a paper jam/)).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
  });

  it("sends exactly one request to this complaint's resolve endpoint, even if submitted twice quickly", async () => {
    let finish!: (r: Response) => void;
    const f = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    vi.stubGlobal("fetch", f);
    render(<ResolveDialog {...props} />);
    await openAndFill();
    const form = screen.getByRole("button", { name: new RegExp(`resolve ${ID}`, "i") }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form); // a second submit while the first is in flight
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/admin/complaints/${ID}/resolve`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ workStuckReason: "", resolutionNotes: "Replaced the roller." });
    finish(json(200, { ok: true, data: { solveDurationMinutes: 135 } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0]![1].description).toMatch(/2 hours 15 minutes/);
    expect(refresh).toHaveBeenCalled();
  });

  it("treats 'already resolved' as information, not an error, and refreshes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(409, { ok: false, error: { code: "ALREADY_RESOLVED", message: "x" } })));
    render(<ResolveDialog {...props} />);
    await openAndFill();
    submit();
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the dialog open with a message on failure, and allows another attempt", async () => {
    const f = vi.fn().mockResolvedValueOnce(json(503, { ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "The system is temporarily unavailable." } })).mockResolvedValueOnce(json(200, { ok: true, data: { solveDurationMinutes: 5 } }));
    vi.stubGlobal("fetch", f);
    render(<ResolveDialog {...props} />);
    await openAndFill();
    submit();
    expect(await screen.findByText(/temporarily unavailable/i)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    submit();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("sends the admin to sign in when the session has ended", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { ok: false, error: { code: "UNAUTHENTICATED", message: "x" } })));
    render(<ResolveDialog {...props} />);
    await openAndFill();
    submit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/login"));
  });

  it("explains a network failure without pretending anything was saved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    render(<ResolveDialog {...props} />);
    await openAndFill();
    submit();
    expect(await screen.findByText(/nothing was changed/i)).toBeTruthy();
  });
});
