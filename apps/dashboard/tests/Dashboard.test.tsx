import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "../src/App";

const snapshot = {
  source: "LIVE",
  symbol: "SOL-PERP",
  collectedAt: new Date().toISOString(),
  venues: (["velocity", "phoenix"] as const).map((venue) => ({
    venue,
    status: "unavailable",
    state: null,
    risk: null,
    error: "Feed offline.",
  })),
  ecosystem: null,
  contagion: null,
  policy: {
    status: "unavailable",
    decision: null,
    reason: "Feeds unavailable.",
  },
};

function useFixtureResponse() {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(snapshot), { status: 200 }),
      ),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dashboard", () => {
  it("renders the live ecosystem overview and supported venues", async () => {
    useFixtureResponse();
    render(<App />);
    expect(screen.getByText("Sentinel")).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Ecosystem overview" }),
    ).toBeDefined();
    expect(await screen.findByText("Combined risk unavailable")).toBeDefined();
    expect(screen.getAllByText("Velocity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Phoenix").length).toBeGreaterThan(0);
  });

  it("navigates to the selected market detail view", () => {
    useFixtureResponse();
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: "Market" })[0]);
    expect(screen.getByRole("heading", { name: /SOL-PERP/ })).toBeDefined();
    expect(screen.getByText("Risk components")).toBeDefined();
    expect(screen.getByText("Top risk drivers")).toBeDefined();
  });

  it("navigates to contagion and shows unavailable state without inventing events", () => {
    useFixtureResponse();
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: "Contagion" })[0]);
    expect(
      screen.getByRole("heading", { name: "Contagion monitor" }),
    ).toBeDefined();
    expect(screen.getByText("Venue observations")).toBeDefined();
    expect(screen.getByText("Contagion assessment unavailable")).toBeDefined();
  });

  it("opens and closes market search", () => {
    useFixtureResponse();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open market search" }));
    expect(
      screen.getByPlaceholderText("Search markets, venues…"),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open market search" }));
    expect(screen.queryByPlaceholderText("Search markets, venues…")).toBeNull();
  });

  it("marks the active dashboard view accessibly", () => {
    useFixtureResponse();
    render(<App />);
    expect(
      screen.getByRole("navigation", { name: "Dashboard views" }),
    ).toBeDefined();
    expect(
      screen
        .getAllByRole("button", { name: "Ecosystem" })
        .some((button) => button.getAttribute("aria-current") === "page"),
    ).toBe(true);
  });
});
