// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ComplaintForm } from "@/components/forms/complaint-form";
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS } from "@/lib/constants";

const options = { departments: DEFAULT_DEPARTMENTS, categories: DEFAULT_CATEGORIES };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ComplaintForm", () => {
  it("shows field-level errors and sends nothing when submitted empty", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ComplaintForm options={options} />);

    await userEvent.click(screen.getByRole("button", { name: /submit complaint/i }));

    expect(await screen.findByText("Enter your name.")).toBeTruthy();
    expect(await screen.findByText("Choose your department.")).toBeTruthy();
    expect(await screen.findByText("Choose a problem category.")).toBeTruthy();
    expect(await screen.findByText("Describe the problem.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("defaults priority to Normal and offers all four levels with explanations", () => {
    render(<ComplaintForm options={options} />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(["Low", "Normal", "High", "Critical"]);
    expect(radios.find((r) => r.checked)?.value).toBe("Normal");
    expect(screen.getByText(/team or business-critical system is down/i)).toBeTruthy();
  });

  it("counts characters and warns when over the limit", async () => {
    render(<ComplaintForm options={options} />);
    expect(screen.getByText("3,000 characters left")).toBeTruthy();
    await userEvent.click(screen.getByLabelText(/what's the problem/i));
    await userEvent.paste("x".repeat(3005));
    await waitFor(() => expect(screen.getByText("5 over the limit")).toBeTruthy());
  });

  it("rejects a malformed contact number before submitting", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ComplaintForm options={options} />);
    await userEvent.type(screen.getByLabelText(/phone or extension/i), "abc");
    await userEvent.tab();
    expect(await screen.findByText(/enter a phone number or extension/i)).toBeTruthy();
  });
});

describe("ComplaintForm short description", () => {
  it("asks for more detail when the description is too short", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ComplaintForm options={options} />);
    await userEvent.type(screen.getByLabelText(/what's the problem/i), "broken");
    await userEvent.tab();
    expect(await screen.findByText(/at least 10 characters/i)).toBeTruthy();
  });
});
