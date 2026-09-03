import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import Home from "./page";

vi.mock("next/image", () => ({
  default: (props: any) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

describe("Home page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] } as any);
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as Response)));
    // jsdom missing
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn() as any;
    } else {
      vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(vi.fn() as any);
    }
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders form with min/max and disabled submit initially", () => {
    render(<Home />);
    const input = screen.getByLabelText(/your birthdate/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.min).toBe("1900-01-01");
    expect(input.max).toBe("2024-06-15");
    expect(input.required).toBe(true);
    const button = screen.getByRole("button", { name: /show my photo/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Min 01\/01\/1900 — Max today/i)).toBeInTheDocument();
  });

  it("shows validationError for future date and keeps button disabled", () => {
    render(<Home />);
    const input = screen.getByLabelText(/your birthdate/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2024-06-16" } });
    expect(screen.getByText(/date cannot be in the future/i)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /show my photo/i });
    expect(button).toBeDisabled();
  });

  it("submit fetches and shows result", async () => {
    const mockSuccess = {
      imageUrl: "https://apod.nasa.gov/image/2401/test.jpg",
      title: "Galassia Test",
      caption: "Caption di test",
      source: "NASA APOD",
      creditedTo: "NASA",
      actualDate: "2024-01-15",
      isFallback: false,
      requestedDate: "2024-01-15",
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => mockSuccess,
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock as any);

    render(<Home />);
    const input = screen.getByLabelText(/your birthdate/i) as HTMLInputElement;
    const button = screen.getByRole("button", { name: /show my photo/i });

    fireEvent.change(input, { target: { value: "2024-01-15" } });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/astro?date=2024-01-15"),
        expect.any(Object)
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Galassia Test")).toBeInTheDocument();
    });
    expect(screen.getByText("Caption di test")).toBeInTheDocument();
  });
});
