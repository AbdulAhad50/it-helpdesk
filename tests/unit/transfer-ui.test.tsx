// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { push, refresh, replace, toast } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace }) }));
vi.mock("sonner", () => ({ toast }));

import { AcceptTransferDialog } from "@/components/complaints/accept-transfer-dialog";
import { TransferForm } from "@/components/forms/transfer-form";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const OUTLETS = ["Malir", "Clifton", "Other"];

beforeAll(() => {
  // jsdom lacks the modal <dialog> API and some pointer APIs Radix Select uses.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function pickOutlet(name: string) {
  await userEvent.click(screen.getByRole("combobox", { name: /outlet/i }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

describe("TransferForm (public)", () => {
  it("shows exactly the requested fields and says the date is automatic", () => {
    render(<TransferForm mode="public" outlets={OUTLETS} />);
    for (const label of [/^outlet$/i, /your name/i, /^email/i, /phone or extension/i, /what is the item/i]) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.queryByLabelText(/direction/i)).toBeNull(); // the public form can only send TO IT
    expect(screen.getByText(/recorded automatically/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
  });

  it("sends nothing and shows a message under every empty required field", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<TransferForm mode="public" outlets={OUTLETS} />);
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    for (const msg of ["Enter the name.", "Enter an email address.", "Enter a phone number or extension.", "Choose an outlet.", "Describe the item."]) expect(await screen.findByText(msg)).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects a malformed email before sending", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<TransferForm mode="public" outlets={OUTLETS} />);
    await userEvent.type(screen.getByLabelText(/^email/i), "not-an-email");
    await userEvent.tab();
    expect(await screen.findByText(/valid email/i)).toBeTruthy();
  });

  it("submits once with the right payload and goes to the confirmation page", async () => {
    let finish!: (r: Response) => void;
    const f = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    vi.stubGlobal("fetch", f);
    render(<TransferForm mode="public" outlets={OUTLETS} />);
    await userEvent.type(screen.getByLabelText(/your name/i), "Ayesha Khan");
    await userEvent.type(screen.getByLabelText(/^email/i), "ayesha@example.com");
    await userEvent.type(screen.getByLabelText(/phone or extension/i), "0300 1234567");
    await pickOutlet("Malir");
    await userEvent.type(screen.getByLabelText(/what is the item/i), "Receipt printer with a faulty cutter");

    const form = screen.getByRole("button", { name: "Submit" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form); // a second submit while the first is in flight
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/transfers");
    expect(JSON.parse(init.body as string)).toMatchObject({ name: "Ayesha Khan", email: "ayesha@example.com", contact: "0300 1234567", outlet: "Malir", description: "Receipt printer with a faulty cutter" });
    finish(json(201, { ok: true, data: { transferId: "TR-20261018-B3M9" } }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/transfer/success?id=TR-20261018-B3M9"));
  });

  it("keeps what you typed and explains the problem when the server says no", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(503, { ok: false, error: { message: "The system is temporarily unavailable. Nothing was saved." } })));
    render(<TransferForm mode="public" outlets={OUTLETS} />);
    await userEvent.type(screen.getByLabelText(/your name/i), "Ayesha Khan");
    await userEvent.type(screen.getByLabelText(/^email/i), "ayesha@example.com");
    await userEvent.type(screen.getByLabelText(/phone or extension/i), "0300 1234567");
    await pickOutlet("Clifton");
    await userEvent.type(screen.getByLabelText(/what is the item/i), "Card reader");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(/nothing was saved/i)).toBeTruthy();
    expect((screen.getByLabelText(/your name/i) as HTMLInputElement).value).toBe("Ayesha Khan");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("TransferForm (admin)", () => {
  it("offers a direction (default From IT) and treats email and contact as optional", async () => {
    const f = vi.fn().mockResolvedValue(json(201, { ok: true, data: { transferId: "TR-20261018-B3M9" } }));
    vi.stubGlobal("fetch", f);
    render(<TransferForm mode="admin" outlets={OUTLETS} />);
    expect((screen.getByLabelText(/direction/i) as HTMLSelectElement).value).toBe("from_it");
    expect(screen.getByLabelText(/recipient name/i)).toBeTruthy(); // wording follows the direction
    await userEvent.type(screen.getByLabelText(/recipient name/i), "Bilal Ahmed");
    await pickOutlet("Clifton");
    await userEvent.type(screen.getByLabelText(/what is the item/i), "Repaired card reader, returning");
    await userEvent.click(screen.getByRole("button", { name: "Record item" }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/transfers");
    expect(JSON.parse(init.body as string)).toMatchObject({ direction: "from_it", name: "Bilal Ahmed", outlet: "Clifton" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/transfers/TR-20261018-B3M9"));
  });
});

describe("AcceptTransferDialog", () => {
  const base = { transferId: "TR-20261018-B3M9", name: "Ayesha Khan", outlet: "Malir", preview: "Receipt printer with a faulty cutter." };
  const open = () => userEvent.click(screen.getByRole("button", { name: /^(accept|confirm)$/i }));
  const form = () => screen.getByRole("button", { name: /accept as received|confirm delivered/i }).closest("form")!;

  it("asks for confirmation showing the record, and sends nothing until confirmed", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<AcceptTransferDialog {...base} direction="to_it" />);
    await open();
    expect(screen.getByRole("heading", { name: /accept item as received/i })).toBeTruthy();
    expect(screen.getAllByText(base.transferId).length).toBeGreaterThan(0);
    expect(screen.getByText(/Receipt printer/)).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
  });

  it("sends exactly one accept request with the notes, even if submitted twice", async () => {
    let finish!: (r: Response) => void;
    const f = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    vi.stubGlobal("fetch", f);
    render(<AcceptTransferDialog {...base} direction="to_it" />);
    await open();
    await userEvent.type(screen.getByLabelText(/notes/i), "Arrived intact.");
    const el = form();
    fireEvent.submit(el);
    fireEvent.submit(el);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/admin/transfers/${base.transferId}/accept`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ notes: "Arrived intact." });
    finish(json(200, { ok: true, data: {} }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0]![0]).toMatch(/received/);
    expect(refresh).toHaveBeenCalled();
  });

  it("uses delivery wording for items going out from IT", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { ok: true, data: {} })));
    render(<AcceptTransferDialog {...base} direction="from_it" />);
    await open();
    expect(screen.getByRole("heading", { name: /confirm item delivered/i })).toBeTruthy();
    expect(screen.getByText(/Malir has received the item/)).toBeTruthy();
    fireEvent.submit(form());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0]![0]).toMatch(/delivered/);
  });

  it("treats 'already received' as information, not an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(409, { ok: false, error: { code: "ALREADY_RECEIVED", message: "x" } })));
    render(<AcceptTransferDialog {...base} direction="to_it" />);
    await open();
    fireEvent.submit(form());
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the dialog open on failure and allows another attempt; sends expired sessions to sign in", async () => {
    const f = vi.fn().mockResolvedValueOnce(json(503, { ok: false, error: { message: "Temporarily unavailable." } })).mockResolvedValueOnce(json(401, { ok: false, error: {} }));
    vi.stubGlobal("fetch", f);
    render(<AcceptTransferDialog {...base} direction="to_it" />);
    await open();
    const el = form();
    fireEvent.submit(el);
    expect(await screen.findByText(/Temporarily unavailable/)).toBeTruthy();
    fireEvent.submit(el);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/login"));
  });
});
